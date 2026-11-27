"""Exercise the real storage/auth SDKs without credentials or outbound HTTP."""
import base64
import json
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import google.auth
from google.auth.compute_engine.credentials import Credentials
import google.auth.transport.requests
from google.cloud import storage
import pytest
import requests

import full_tracking_control as control
from full_tracking_store import GCSStore, source_key

CLOUD_PLATFORM = "https://www.googleapis.com/auth/cloud-platform"
STORAGE_ONLY = "https://www.googleapis.com/auth/devstorage.read_write"
SERVICE_ACCOUNT = "tracking-test@scope-test-project.iam.gserviceaccount.com"


class MetadataTransport:
    def __init__(self):
        self.requested_scopes = []
        self.sign_blob_calls = []

    def __call__(self, url, method="GET", headers=None, **kwargs):
        address = urlsplit(url)
        if address.hostname in {"metadata.google.internal", "169.254.169.254"}:
            if address.path.endswith("/token"):
                scopes = parse_qs(address.query).get("scopes", [""])[0].split(",")
                self.requested_scopes.append(scopes)
                value = {"access_token": "test-cloud-token" if CLOUD_PLATFORM in scopes else "test-storage-token", "expires_in": 3600, "token_type": "Bearer"}
            else:
                assert "/instance/service-accounts/" in address.path
                value = {"email": SERVICE_ACCOUNT, "scopes": [STORAGE_ONLY], "aliases": ["default"]}
            return SimpleNamespace(status=200, data=json.dumps(value).encode(), headers={"content-type": "application/json"})
        assert address.hostname == "iamcredentials.googleapis.com"
        assert address.path.endswith(":signBlob") and method == "POST"
        authorization = (headers or {}).get("Authorization")
        self.sign_blob_calls.append(authorization)
        status = 200 if authorization == "Bearer test-cloud-token" else 403
        value = {"signedBlob": base64.b64encode(b"test-signature").decode()} if status == 200 else {"error": "insufficient test scope"}
        return SimpleNamespace(status=status, data=json.dumps(value).encode(), headers={"content-type": "application/json"})


@pytest.fixture
def adc(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "scope-test-project")
    monkeypatch.delenv("STORAGE_EMULATOR_HOST", raising=False)
    monkeypatch.delenv("API_ENDPOINT_OVERRIDE", raising=False)
    requested = []

    def identity(scopes=None, **_):
        requested.append(tuple(scopes or ()))
        return Credentials(universe_domain="googleapis.com"), "scope-test-project"

    def no_network(*_, **__):
        raise AssertionError("Unexpected network request in an auth scope test")

    metadata = MetadataTransport()
    monkeypatch.setattr(google.auth, "default", identity)
    monkeypatch.setattr(google.auth.transport.requests, "Request", lambda *_, **__: metadata)
    monkeypatch.setattr(requests.sessions.Session, "request", no_network)
    return SimpleNamespace(requested=requested, metadata=metadata)


def test_default_storage_client_explicitly_requests_cloud_platform_adc_scope(adc):
    store = GCSStore("scope-test-bucket")
    assert isinstance(store.client, storage.Client)
    assert isinstance(store.client._credentials, Credentials)
    assert adc.requested == [(CLOUD_PLATFORM,)]


def test_effective_compute_credentials_refresh_requests_cloud_platform_token(adc):
    store = GCSStore("scope-test-bucket")
    store.client._credentials.refresh(adc.metadata)
    assert adc.metadata.requested_scopes == [[CLOUD_PLATFORM]]


def test_injected_real_client_bypasses_adc_and_preserves_its_credentials(adc):
    credentials = Credentials(scopes=[CLOUD_PLATFORM], universe_domain="googleapis.com")
    client = storage.Client(project="scope-test-project", credentials=credentials)
    store = GCSStore("scope-test-bucket", client=client)
    assert store.client is client
    assert store.client._credentials is credentials
    assert adc.requested == []


@pytest.mark.parametrize("operation", ["launch", "status"])
def test_job_authorized_session_uses_the_shared_cloud_platform_credentials(adc, monkeypatch, operation):
    store = GCSStore("scope-test-bucket")
    resource = "projects/scope-test-project/locations/asia-northeast3/jobs/tracking-test"
    execution = resource + "/executions/test-execution"
    monkeypatch.setenv("TRACKING_JOB_RESOURCE", resource)
    calls = []

    def run_http(_session, method, url, **kwargs):
        assert method == ("POST" if operation == "launch" else "GET")
        assert url == "https://run.googleapis.com/v2/" + (resource + ":run" if operation == "launch" else execution)
        authorization = kwargs["headers"].get("authorization")
        calls.append(authorization)
        response = requests.Response()
        response.status_code = 200 if authorization == "Bearer test-cloud-token" else 403
        response.url = url
        response._content = json.dumps({"metadata": {"name": execution}} if operation == "launch" else {"runningCount": 1}).encode()
        return response

    monkeypatch.setattr(requests.sessions.Session, "request", run_http)
    if operation == "launch":
        assert control.launch_runner(store, str(uuid4()), str(uuid4()))["id"] == execution
    else:
        assert control.execution_active(store, {"id": execution}) is True
    assert adc.metadata.requested_scopes == [[CLOUD_PLATFORM]]
    assert calls == ["Bearer test-cloud-token"]


def test_signed_playback_refreshes_the_same_credential_before_iam_sign_blob(adc, monkeypatch):
    store = GCSStore("scope-test-bucket")
    owner, project, upload = (str(uuid4()) for _ in range(3))
    source = {"uploadId": upload, "objectKey": source_key(owner, project, upload), "generation": "123"}
    monkeypatch.setenv("TRACKING_SIGNER_SERVICE_ACCOUNT", SERVICE_ACCOUNT)
    signed = store.playback(source)
    assert urlsplit(signed).hostname == "storage.googleapis.com"
    assert adc.metadata.requested_scopes == [[CLOUD_PLATFORM]]
    assert adc.metadata.sign_blob_calls == ["Bearer test-cloud-token"]
