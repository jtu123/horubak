"""Boundary failures are tested independently from real-model integration."""
import subprocess

from fastapi.testclient import TestClient
import pytest

import main
import tracking


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ANALYSIS_SERVICE_TOKEN", "local-only-tracking-boundary-test-token")
    with TestClient(main.app) as instance:
        instance.headers["Authorization"] = "Bearer local-only-tracking-boundary-test-token"
        yield instance


def upload(client, query="start=0&end=2&sampleFps=2", content=b"video"):
    return client.post(f"/api/tracking/analyze?{query}", files={"file": ("source.mp4", content, "video/mp4")})


def test_health_does_not_require_cv_model_or_authentication(client, monkeypatch):
    monkeypatch.setenv("TRACKING_MODEL_PATH", "/missing-tracking-model.onnx")
    assert client.get("/health", headers={"Authorization": ""}).json() == {"status": "ok"}
    assert upload(client).status_code == 503


def test_tracking_requires_private_service_bearer(client):
    client.headers.pop("Authorization")
    assert upload(client).status_code == 401


@pytest.mark.parametrize("query", [
    "start=-1&end=2", "start=2&end=1", "start=0&end=121", "start=0&end=100&sampleFps=4",
    "start=nan&end=2", "start=0&end=inf", "start=0&end=2&sampleFps=0", "start=0&end=2&sampleFps=5",
])
def test_invalid_ranges_are_rejected_before_model_work(client, query):
    assert upload(client, query).status_code == 422


def test_missing_and_multiple_files_are_rejected(client):
    assert client.post("/api/tracking/analyze?start=0&end=2").status_code == 422
    response = client.post("/api/tracking/analyze?start=0&end=2", files=[("file", ("a.mp4", b"a")), ("file", ("b.mp4", b"b"))])
    assert response.status_code == 400


def test_large_announced_body_is_rejected_before_multipart(client):
    assert client.post("/api/tracking/analyze?start=0&end=2", content=b"", headers={"Content-Length": str(27 * 1024 * 1024)}).status_code == 413


def test_empty_upload_releases_analysis_lock(client, monkeypatch):
    monkeypatch.setattr(tracking, "verify_model", lambda _: True)
    assert upload(client, content=b"").status_code == 422
    assert not main._analysis_lock.locked()


def test_shared_stt_tracking_lock_reports_busy(client, monkeypatch):
    monkeypatch.setattr(tracking, "verify_model", lambda _: True)
    main._analysis_lock.acquire()
    try:
        response = upload(client)
        assert response.status_code == 503
        assert response.headers["Retry-After"] == "15"
    finally:
        main._analysis_lock.release()


def test_native_worker_timeout_releases_lock_and_returns_retryable_error(client, monkeypatch):
    monkeypatch.setattr(tracking, "verify_model", lambda _: True)
    def timeout(*args, **kwargs):
        assert kwargs["timeout"] <= 120
        raise subprocess.TimeoutExpired(args[0], kwargs["timeout"])
    monkeypatch.setattr(tracking, "run_managed", timeout)
    response = upload(client)
    assert response.status_code == 504
    assert not main._analysis_lock.locked()


def test_worker_missing_output_is_an_explicit_failure(client, monkeypatch):
    monkeypatch.setattr(tracking, "verify_model", lambda _: True)
    monkeypatch.setattr(tracking, "run_managed", lambda *_, **__: subprocess.CompletedProcess([], 2))
    assert upload(client).status_code == 502
    assert not main._analysis_lock.locked()
