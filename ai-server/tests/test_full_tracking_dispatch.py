from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from uuid import uuid4
import time

import pytest

import full_tracking_control as control
from full_tracking_dispatch import abandon, acknowledge, drop_pending, enqueue, next_job, run_pending
from full_tracking_store import Conflict, LocalStore


def test_durable_queue_drains_in_order_without_spawning_waiting_instances(tmp_path):
    store = LocalStore(tmp_path)
    first, second = str(uuid4()), str(uuid4())
    runner = enqueue(store, first)
    assert runner and enqueue(store, second) is None
    visited = []
    def analyze(_store, identity, external_guard):
        external_guard()
        visited.append(identity)
        return {"state": "completed"}
    run_pending(LocalStore(tmp_path), runner, analyze=analyze)
    assert visited == [first, second]
    queue, _ = store.read_json("queues/tracking.json")
    assert queue == {"pending": [], "current": None, "runner": None}


def test_duplicate_job_enqueues_only_once_and_unclaimed_cancel_is_immediate(tmp_path):
    store = LocalStore(tmp_path)
    first, second = str(uuid4()), str(uuid4())
    runner = enqueue(store, first)
    enqueue(store, first)
    enqueue(store, second)
    assert next_job(store, runner) == first
    assert drop_pending(store, first) is False
    assert drop_pending(store, second) is True
    acknowledge(store, runner, first)
    assert next_job(store, runner) is None


def test_crashed_runner_retains_current_for_platform_retry(tmp_path):
    store = LocalStore(tmp_path)
    job = str(uuid4())
    runner = enqueue(store, job)
    def interrupted(*_, **__):
        return {"state": "interrupted"}
    with pytest.raises(RuntimeError, match="interrupted"):
        run_pending(store, runner, analyze=interrupted)
    assert next_job(store, runner) == job
    visited = []
    def resumed(_store, identity, **_):
        visited.append(identity)
        return {"state": "completed"}
    run_pending(store, runner, analyze=resumed)
    assert visited == [job]


def test_queue_has_a_bounded_pending_count(tmp_path):
    store = LocalStore(tmp_path)
    for _ in range(20):
        enqueue(store, str(uuid4()))
    with pytest.raises(Conflict, match="full"):
        enqueue(store, str(uuid4()))


def test_resume_racing_with_acknowledgement_remains_queued(tmp_path):
    store = LocalStore(tmp_path)
    job = str(uuid4())
    runner = enqueue(store, job)
    assert next_job(store, runner) == job
    # User resumed after worker finished, before runner acknowledged the job.
    store.write_json(f"jobs/{job}/state.json", {"state": "queued"})
    assert enqueue(store, job) is None
    acknowledge(store, runner, job)
    assert next_job(store, runner) == job


def test_concurrent_dispatch_launches_one_runner(tmp_path, monkeypatch):
    store = LocalStore(tmp_path)
    job = str(uuid4())
    monkeypatch.setattr(control, "job_functions", lambda: SimpleNamespace(job_status=lambda *_: {"state": "queued"}))
    launches = []
    def launch(*args, **kwargs):
        launches.append((args, kwargs))
        time.sleep(.05)
        return SimpleNamespace(pid=12345)
    monkeypatch.setattr(control.subprocess, "Popen", launch)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: control.execute_job(store, job), range(2)))
    assert len(launches) == 1
    assert all(result["executionId"] for result in results)
    assert launches[0][1]["env"]["HORUBAK_TRACKING_RUNNER_ID"]


def test_fast_completed_execution_is_still_a_successful_dispatch(tmp_path, monkeypatch):
    store = LocalStore(tmp_path)
    job = str(uuid4())
    state = {"state": "queued"}
    monkeypatch.setattr(control, "job_functions", lambda: SimpleNamespace(job_status=lambda *_: dict(state)))
    def very_fast(_store, identity, runner):
        assert next_job(store, runner) == identity
        state["state"] = "completed"
        acknowledge(store, runner, identity)
        assert next_job(store, runner) is None
        return {"id": "already-completed"}
    monkeypatch.setattr(control, "launch_runner", very_fast)
    assert control.execute_job(store, job) == {"executionId": "already-completed"}


def queued_job(store):
    owner, project, upload, identity = [str(uuid4()) for _ in range(4)]
    control.job_functions().create_job(store, identity, {
        "uploadId": upload, "filename": "source.mp4", "size": 1000, "duration": 60,
        "width": 640, "height": 360, "objectKey": f"originals/{owner}/{project}/{upload}",
        "generation": "1", "checksum": "crc32-12345678",
    })
    state, version = store.read_json(f"jobs/{identity}/state.json")
    state["updatedAt"] = control.iso(time.time() - 60)
    store.write_json(f"jobs/{identity}/state.json", state, expected=version)
    return identity


def test_status_recovers_other_pending_job_after_initial_launch_fails(tmp_path, monkeypatch):
    store = LocalStore(tmp_path)
    first, second = queued_job(store), queued_job(store)
    launches = []
    def launch(_store, identity, _runner):
        launches.append(identity)
        if identity == first:
            assert control.execute_job(store, second)["executionId"] == "queued-" + second
            raise RuntimeError("Cloud execution creation rejected")
        return {"id": "recovered-second"}
    monkeypatch.setattr(control, "launch_runner", launch)
    with pytest.raises(RuntimeError):
        control.execute_job(store, first)
    assert control.reconcile_job(store, second)["state"] == "queued"
    queue, _ = store.read_json("queues/tracking.json")
    assert launches == [first, second]
    assert queue["runner"]["execution"] == {"id": "recovered-second"}


def test_failed_recovery_is_explicit_instead_of_an_eternal_queue(tmp_path, monkeypatch):
    store = LocalStore(tmp_path)
    job = queued_job(store)
    abandon(store, enqueue(store, job))
    def rejected(*_):
        raise RuntimeError("Execution provider is unavailable")
    monkeypatch.setattr(control, "launch_runner", rejected)
    result = control.reconcile_job(store, job)
    assert result["state"] == "failed"
    assert result["error"]["code"] == "DISPATCH_FAILED"
    assert job not in store.read_json("queues/tracking.json")[0]["pending"]


def test_unreturned_but_live_reservation_is_not_replaced_by_status(tmp_path, monkeypatch):
    store = LocalStore(tmp_path)
    job = queued_job(store)
    runner = enqueue(store, job)
    store.write_json(f"jobs/{job}/execution.json", {"id": "old-execution"})
    def unexpected(*_):
        raise AssertionError("A live dispatch reservation must not be replaced or use an old execution")
    monkeypatch.setattr(control, "launch_runner", unexpected)
    monkeypatch.setattr(control, "execution_active", unexpected)
    assert control.reconcile_job(store, job)["state"] == "queued"
    assert store.read_json("queues/tracking.json")[0]["runner"]["id"] == runner


def test_active_analysis_lease_protects_a_launch_with_lost_response(tmp_path, monkeypatch):
    store = LocalStore(tmp_path)
    job = queued_job(store)
    runner = enqueue(store, job)
    abandon(store, runner)
    store.write_json("locks/tracking.json", {"jobId": str(uuid4()), "runId": str(uuid4()), "expiresAt": time.time() + 60})
    monkeypatch.setattr(control, "launch_runner", lambda *_: pytest.fail("An active analysis must not be superseded"))
    assert control.reconcile_job(store, job)["state"] == "queued"
    assert store.read_json("queues/tracking.json")[0]["runner"]["id"] == runner


def test_concurrent_recovery_status_checks_launch_one_replacement(tmp_path, monkeypatch):
    store = LocalStore(tmp_path)
    job = queued_job(store)
    abandon(store, enqueue(store, job))
    launches = []
    def launch(*_):
        launches.append(True)
        time.sleep(.05)
        return {"id": "one-recovery"}
    monkeypatch.setattr(control, "launch_runner", launch)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: control.reconcile_job(store, job), range(2)))
    assert all(result["state"] == "queued" for result in results)
    assert launches == [True]


def test_recovery_fences_a_late_runner_after_its_launch_response_was_lost(tmp_path, monkeypatch):
    store = LocalStore(tmp_path)
    job = queued_job(store)
    previous_runner = enqueue(store, job)
    abandon(store, previous_runner)
    monkeypatch.setattr(control, "launch_runner", lambda *_: {"id": "replacement-execution"})
    control.reconcile_job(store, job)
    assert store.read_json("queues/tracking.json")[0]["runner"]["id"] != previous_runner
    with pytest.raises(Conflict, match="replaced"):
        run_pending(store, previous_runner, analyze=lambda *_: pytest.fail("The old execution must not analyze"))


def test_local_store_supports_nested_source_paths_over_windows_legacy_limit(tmp_path):
    store = LocalStore(tmp_path / ("long-directory-" * 8))
    owner, project, upload = [str(uuid4()) for _ in range(3)]
    source = store.path(f"originals/{owner}/{project}/{upload}")
    source.parent.mkdir(parents=True)
    source.write_bytes(b"source")
    assert source.read_bytes() == b"source"
