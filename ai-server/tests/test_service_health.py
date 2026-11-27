"""Public liveness stays separate from authenticated, side-effect-free connectivity."""
from fastapi.testclient import TestClient

import main
import full_tracking_control
import tracking


def test_public_liveness_remains_available_without_service_configuration(monkeypatch):
    monkeypatch.delenv('ANALYSIS_SERVICE_TOKEN', raising=False)
    with TestClient(main.app) as client:
        assert client.get('/health').json() == {'status': 'ok'}
        assert client.get('/api/health').status_code == 503


def test_authenticated_health_rejects_missing_or_incorrect_bearer(monkeypatch):
    monkeypatch.setenv('ANALYSIS_SERVICE_TOKEN', 'test-only-service-health-token-123456')
    with TestClient(main.app) as client:
        assert client.get('/api/health').status_code == 401
        assert client.get('/api/health', headers={'Authorization': 'Bearer incorrect'}).status_code == 401


def test_authenticated_health_does_not_initialize_models_storage_or_jobs(monkeypatch):
    token = 'test-only-service-health-token-123456'
    monkeypatch.setenv('ANALYSIS_SERVICE_TOKEN', token)
    def unexpected(*args, **kwargs):
        raise AssertionError('Connectivity must not perform analysis or access storage')
    monkeypatch.setattr(tracking, 'verify_model', unexpected)
    monkeypatch.setattr(full_tracking_control, 'configured_store', unexpected)
    monkeypatch.setattr(main.subprocess, 'run', unexpected)
    with TestClient(main.app) as client:
        response = client.get('/api/health', headers={'Authorization': 'Bearer ' + token})
        assert response.status_code == 200
        assert response.json() == {'status': 'ok'}
