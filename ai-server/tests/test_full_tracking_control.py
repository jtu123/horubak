from fastapi import FastAPI
from fastapi.testclient import TestClient
from uuid import uuid4
import zlib

import pytest

import full_tracking_control as control
from full_tracking_store import LocalStore


@pytest.fixture
def setup(tmp_path, monkeypatch):
    store = LocalStore(tmp_path)
    monkeypatch.setenv("TRACKING_ALLOWED_ORIGINS", "http://127.0.0.1:5173")
    monkeypatch.setenv("TRACKING_LOCAL_PUBLIC_URL", "http://127.0.0.1:8000")
    monkeypatch.setattr(control, "configured_store", lambda: store)
    app = FastAPI()
    app.include_router(control.create_full_tracking_router())
    with TestClient(app) as client:
        yield client, store


def body(size=524288):
    return {"ownerId": str(uuid4()), "projectId": str(uuid4()), "uploadId": str(uuid4()),
            "filename": "original.mp4", "size": size, "contentType": "video/mp4", "origin": "http://127.0.0.1:5173"}


def path_from_session(value):
    return value["uploadUrl"].removeprefix("http://127.0.0.1:8000")


def test_resumable_upload_offset_origin_token_and_completed_bytes(setup):
    client, store = setup
    value = body()
    response = client.post("/api/full-tracking/uploads/init", json=value)
    assert response.status_code == 200
    path = path_from_session(response.json())
    assert response.json()["chunkBytes"] == 8388608
    response = client.put(path, headers={"Content-Range": "bytes */524288"})
    assert response.status_code == 308 and "Range" not in response.headers
    assert client.put(path, headers={"Content-Range": "bytes */524288", "Origin": "https://foreign.invalid"}).status_code == 403
    first = b"a" * 262144
    response = client.put(path, content=first, headers={"Content-Range": "bytes 0-262143/524288"})
    assert response.status_code == 308 and response.headers["Range"] == "bytes=0-262143"
    assert client.put(path + "wrong", headers={"Content-Range": "bytes */524288"}).status_code == 404
    assert client.put(path, content=first, headers={"Content-Range": "bytes 0-262143/524288"}).status_code == 409
    second = b"b" * 262144
    response = client.put(path, content=second, headers={"Content-Range": "bytes 262144-524287/524288"})
    assert response.status_code == 200
    record, _ = store.read_json(f"uploads/{value['uploadId']}.json")
    assert store.path(record["objectKey"]).read_bytes() == first + second
    assert record["crc32"] == zlib.crc32(first + second)
    assert client.put(path, headers={"Content-Range": "bytes */524288"}).status_code == 200


def test_partial_uncommitted_file_tail_can_be_retried(setup):
    client, store = setup
    value = body()
    path = path_from_session(client.post("/api/full-tracking/uploads/init", json=value).json())
    first = b"a" * 262144
    client.put(path, content=first, headers={"Content-Range": "bytes 0-262143/524288"})
    record, _ = store.read_json(f"uploads/{value['uploadId']}.json")
    # Simulate process death after writing bytes but before committing offset.
    with store.path(record["objectKey"]).open("ab") as output:
        output.write(b"uncommitted")
    second = b"b" * 262144
    response = client.put(path, content=second, headers={"Content-Range": "bytes 262144-524287/524288"})
    assert response.status_code == 200
    assert store.path(record["objectKey"]).read_bytes() == first + second


@pytest.mark.parametrize("size,expected", [(4294967296, 200), (4294967297, 422), (0, 422)])
def test_upload_size_bound_is_4gib_without_allocating_the_file(setup, size, expected):
    client, _ = setup
    assert client.post("/api/full-tracking/uploads/init", json=body(size)).status_code == expected


def test_upload_identity_cannot_be_rebound(setup):
    client, _ = setup
    value = body()
    assert client.post("/api/full-tracking/uploads/init", json=value).status_code == 200
    value["ownerId"] = str(uuid4())
    assert client.post("/api/full-tracking/uploads/init", json=value).status_code == 409


def test_source_schema_accepts_10_hours_and_rejects_larger():
    source = {"uploadId": str(uuid4()), "filename": "original.mp4", "size": 1, "duration": 36000, "width": 1920,
              "height": 1080, "objectKey": "placeholder", "generation": "1", "checksum": "value"}
    assert control.Source.model_validate(source).duration == 36000
    source["duration"] = 36000.01
    with pytest.raises(ValueError):
        control.Source.model_validate(source)
