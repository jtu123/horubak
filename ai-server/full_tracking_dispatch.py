"""One persistent queue runner, rather than one billed instance per waiting job."""
import copy
import os
import threading
import time
import uuid

from full_tracking_store import Conflict, create_store

QUEUE_KEY = "queues/tracking.json"
LEASE_SECONDS = 180
MAX_PENDING = 20


class QueueFull(Conflict):
    pass


def edit_queue(store, transform):
    for _ in range(20):
        queue, version = store.read_json(QUEUE_KEY)
        queue = copy.deepcopy(queue or {"pending": [], "current": None, "runner": None})
        outcome = transform(queue)
        try:
            store.write_json(QUEUE_KEY, queue, expected=version or "0")
            return outcome
        except Conflict:
            continue
    raise Conflict("Tracking queue changed concurrently")


def enqueue(store, job_id):
    if str(uuid.UUID(job_id)) != job_id:
        raise ValueError("Invalid job identity")
    def update(queue):
        if job_id != queue["current"] and job_id not in queue["pending"]:
            if len(queue["pending"]) >= MAX_PENDING:
                raise QueueFull("The tracking queue is full")
            queue["pending"].append(job_id)
        runner = queue["runner"]
        if runner and runner["expires"] > time.time():
            return None
        identity = str(uuid.uuid4())
        queue["runner"] = {"id": identity, "expires": time.time() + LEASE_SECONDS, "execution": None}
        return identity
    return edit_queue(store, update)


def set_execution(store, identity, execution):
    def update(queue):
        if not queue["runner"] or queue["runner"]["id"] != identity:
            raise Conflict("The queue runner was replaced")
        queue["runner"]["execution"] = execution
    edit_queue(store, update)


def execution_for(store, job_id):
    queue, _ = store.read_json(QUEUE_KEY)
    if queue and (queue["current"] == job_id or job_id in queue["pending"]):
        return (queue.get("runner") or {}).get("execution")
    return None


def drop_pending(store, job_id):
    def update(queue):
        if queue["current"] == job_id:
            return False
        if job_id in queue["pending"]:
            queue["pending"].remove(job_id)
        return True
    return edit_queue(store, update)


def abandon(store, identity):
    def update(queue):
        if queue["runner"] and queue["runner"]["id"] == identity:
            queue["runner"]["expires"] = 0
    edit_queue(store, update)


def next_job(store, identity):
    def update(queue):
        if not queue["runner"] or queue["runner"]["id"] != identity:
            raise Conflict("The queue runner was replaced")
        if queue["current"]:
            return queue["current"]  # Retry resumes the interrupted current job.
        if queue["pending"]:
            queue["current"] = queue["pending"].pop(0)
            return queue["current"]
        queue["runner"] = None
        return None
    return edit_queue(store, update)


def acknowledge(store, identity, job_id):
    def update(queue):
        if not queue["runner"] or queue["runner"]["id"] != identity or queue["current"] != job_id:
            raise Conflict("The queue runner was replaced")
        # Read state inside this CAS attempt. A concurrent resume also edits
        # this queue, so one loser retries and cannot silently drop that work.
        state, _ = store.read_json(f"jobs/{job_id}/state.json")
        if state and state["state"] == "queued" and job_id not in queue["pending"]:
            queue["pending"].append(job_id)
        queue["current"] = None
    edit_queue(store, update)


def run_pending(store, identity, analyze=None):
    from full_tracking_job import JobInterrupted, run_job
    analyze = analyze or run_job
    stopped = threading.Event()
    lost = threading.Event()

    def refresh():
        def update(queue):
            if not queue["runner"] or queue["runner"]["id"] != identity:
                raise Conflict("The queue runner was replaced")
            queue["runner"]["expires"] = time.time() + LEASE_SECONDS
        edit_queue(store, update)

    def heartbeat():
        while not stopped.wait(5):
            try:
                refresh()
            except Exception:
                lost.set()
                return

    def guard():
        if lost.is_set():
            raise JobInterrupted("The queue runner lost its lease")

    refresh()
    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()
    try:
        while True:
            guard()
            job_id = next_job(store, identity)
            if job_id is None:
                return
            execution = execution_for(store, job_id)
            if execution:
                store.write_json(f"jobs/{job_id}/execution.json", execution)
            result = analyze(store, job_id, external_guard=guard)
            guard()
            if result["state"] == "queued":
                continue  # A resume raced with this worker's terminal update.
            if result["state"] not in {"completed", "cancelled", "failed"}:
                # Leave current/checkpoint intact for the platform retry.
                raise RuntimeError("The tracking execution was interrupted")
            acknowledge(store, identity, job_id)
    finally:
        stopped.set()
        thread.join(timeout=2)


if __name__ == "__main__":
    run_pending(create_store(), os.environ["HORUBAK_TRACKING_RUNNER_ID"])
