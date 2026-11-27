from types import SimpleNamespace
from uuid import uuid4

import pytest

import full_tracking_control as control
from full_tracking_store import GCSStore, source_key


def test_gcs_upload_session_is_one_create_only_object_with_exact_size_and_origin(monkeypatch):
    monkeypatch.setenv("TRACKING_ALLOWED_ORIGINS", "https://horubak.pages.dev")
    value = {"ownerId": str(uuid4()), "projectId": str(uuid4()), "uploadId": str(uuid4()), "filename": "source.mp4",
             "size": 4294967296, "origin": "https://horubak.pages.dev", "contentType": "video/mp4"}
    value["objectKey"] = source_key(value["ownerId"], value["projectId"], value["uploadId"])
    observed = []
    class Client:
        def bucket(self, name):
            return self
        def blob(self, key):
            assert key == value["objectKey"]
            return self
        def create_resumable_upload_session(self, **kwargs):
            observed.append(kwargs)
            return "https://storage.googleapis.com/upload/session-test"
    store = GCSStore("private-test-bucket", client=Client())
    monkeypatch.setattr(store, "read_json", lambda *_: (None, None))
    saved = []
    monkeypatch.setattr(store, "write_json", lambda *args, **kwargs: saved.append((args, kwargs)))
    result = control.initialize_upload(store, value)
    assert result["chunkBytes"] == 8388608
    assert observed == [{"content_type": "video/mp4", "size": 4294967296, "origin": "https://horubak.pages.dev", "if_generation_match": 0, "timeout": 30}]
    assert saved[0][1] == {"expected": "0"}
    value["origin"] = "https://foreign.invalid"
    with pytest.raises(control.HTTPException) as error:
        control.initialize_upload(store, value)
    assert error.value.status_code == 422 and len(observed) == 1


def test_cloud_run_launch_uses_fixed_resource_and_small_job_identity_overrides(monkeypatch):
    import google.auth.transport.requests
    credential = object()
    client = SimpleNamespace(bucket=lambda _: object(), _credentials=credential)
    store = GCSStore("private-test-bucket", client=client)
    resource = "projects/test-project/locations/asia-northeast3/jobs/horubak-tracking"
    execution = resource + "/executions/verification-001"
    monkeypatch.setenv("TRACKING_JOB_RESOURCE", resource)
    calls = []
    class Session:
        def __init__(self, credentials):
            assert credentials is credential
        def post(self, url, **kwargs):
            calls.append((url, kwargs))
            return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"metadata": {"name": execution}})
    monkeypatch.setattr(google.auth.transport.requests, "AuthorizedSession", Session)
    job, runner = str(uuid4()), str(uuid4())
    assert control.launch_runner(store, job, runner)["id"] == execution
    url, request = calls[0]
    assert url == "https://run.googleapis.com/v2/" + resource + ":run"
    assert request["allow_redirects"] is False and request["timeout"] == 30
    assert request["json"] == {"overrides": {"taskCount": 1, "containerOverrides": [{"env": [
        {"name": "HORUBAK_TRACKING_JOB_ID", "value": job}, {"name": "HORUBAK_TRACKING_RUNNER_ID", "value": runner}]}]}}


def test_execution_status_requires_actual_completion_not_just_a_created_execution(monkeypatch):
    import google.auth.transport.requests
    credential = object()
    store = GCSStore("private-test-bucket", client=SimpleNamespace(bucket=lambda _: object(), _credentials=credential))
    resource = {"runningCount": 1}
    class Session:
        def __init__(self, _):
            pass
        def get(self, url, **kwargs):
            assert url.startswith("https://run.googleapis.com/v2/projects/test-project/")
            assert kwargs["allow_redirects"] is False
            return SimpleNamespace(raise_for_status=lambda: None, json=lambda: dict(resource))
    monkeypatch.setattr(google.auth.transport.requests, "AuthorizedSession", Session)
    execution = {"id": "projects/test-project/locations/asia-northeast3/jobs/tracking/executions/run-1"}
    assert control.execution_active(store, execution) is True
    resource.update(completionTime="2026-11-27T00:00:00Z", runningCount=0)
    assert control.execution_active(store, execution) is False
