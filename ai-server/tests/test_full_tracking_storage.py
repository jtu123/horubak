import hashlib
from pathlib import Path
from uuid import uuid4
from urllib.request import Request, urlopen

import pytest

from full_tracking_store import Conflict, GCSStore, LocalStore, create_store, source_key


def source_file(store, data=b"0123456789"):
    owner, project, upload = [str(uuid4()) for _ in range(3)]
    key = source_key(owner, project, upload)
    path = store.path(key)
    path.parent.mkdir(parents=True)
    path.write_bytes(data)
    return {"uploadId": upload, "objectKey": key, "size": len(data), "generation": str(path.stat().st_mtime_ns)}


def test_json_compare_and_swap_survives_new_store_instances(tmp_path):
    store = LocalStore(tmp_path)
    version = store.write_json("jobs/test/state.json", {"state": "queued"}, expected="0")
    with pytest.raises(Conflict):
        store.write_json("jobs/test/state.json", {}, expected="0")
    other = LocalStore(tmp_path)
    assert other.read_json("jobs/test/state.json") == ({"state": "queued"}, version)
    next_version = other.write_json("jobs/test/state.json", {"state": "running"}, expected=version)
    with pytest.raises(Conflict):
        store.write_json("jobs/test/state.json", {}, expected=version)
    assert next_version != version


@pytest.mark.parametrize("key", ["../secret", "/absolute", "a//b", "a/./b", "a/../b", "file?token=x"])
def test_storage_keys_cannot_escape_or_be_urls(tmp_path, key):
    with pytest.raises(ValueError):
        LocalStore(tmp_path).write_json(key, {})


def test_seekable_media_is_a_single_immutable_object(tmp_path):
    store = LocalStore(tmp_path)
    source = source_file(store)
    with store.source_url(source) as (url, metadata):
        assert metadata == source
        with urlopen(Request(url, headers={"Range": "bytes=3-6"})) as response:
            assert response.status == 206
            assert response.headers["Content-Range"] == "bytes 3-6/10"
            assert response.read() == b"3456"
        with urlopen(Request(url, method="HEAD")) as response:
            assert response.headers["Content-Length"] == "10"
    heartbeat = []
    assert store.source_sha256(source, lambda: heartbeat.append(True)) == hashlib.sha256(b"0123456789").hexdigest()
    assert heartbeat
    store.path(source["objectKey"]).write_bytes(b"different-generation")
    with pytest.raises(ValueError, match="generation"):
        store.source_sha256(source, lambda: None)


def test_local_driver_cannot_be_selected_in_cloud_run(tmp_path, monkeypatch):
    monkeypatch.setenv("TRACKING_STORAGE_DRIVER", "local")
    monkeypatch.setenv("TRACKING_LOCAL_DIRECTORY", str(tmp_path))
    monkeypatch.setenv("K_SERVICE", "production-service")
    with pytest.raises(ValueError, match="forbidden"):
        create_store()


def test_gcs_json_generation_preconditions_and_error_translation():
    from google.api_core.exceptions import NotFound, PreconditionFailed
    blobs = {}
    class Blob:
        def __init__(self, name):
            self.name, self.generation, self.size = name, None, None
        def reload(self, **_):
            if self.name not in blobs:
                raise NotFound("not present")
            self.generation, self.payload = blobs[self.name]
            self.size = len(self.payload)
        def download_as_bytes(self, **kw):
            assert kw["if_generation_match"] == self.generation
            return self.payload
        def upload_from_string(self, data, **kw):
            current = blobs.get(self.name, (0,))[0]
            expected = kw["if_generation_match"]
            if expected is not None and expected != current:
                raise PreconditionFailed("changed")
            self.generation = current + 1
            blobs[self.name] = (self.generation, data)
    class Client:
        def bucket(self, name):
            assert name == "private-test-bucket"
            return self
        def blob(self, name):
            return Blob(name)
    store = GCSStore("private-test-bucket", client=Client())
    assert store.read_json("jobs/id/state.json") == (None, None)
    assert store.write_json("jobs/id/state.json", {"value": 1}, expected="0") == "1"
    assert store.read_json("jobs/id/state.json") == ({"value": 1}, "1")
    with pytest.raises(Conflict):
        store.write_json("jobs/id/state.json", {}, expected="0")


@pytest.mark.parametrize("error_type", ["not-found", "precondition"])
def test_gcs_json_read_retries_when_generation_changes_after_metadata(error_type):
    from google.api_core.exceptions import NotFound, PreconditionFailed
    class Blob:
        def __init__(self, generation):
            self.generation, self.size = generation, 20
        def reload(self, **_):
            pass
        def download_as_bytes(self, **_):
            if self.generation == 1:
                error = NotFound if error_type == "not-found" else PreconditionFailed
                raise error("Overwritten between metadata and content read")
            return b'{"state":"running"}'
    class Client:
        count = 0
        def bucket(self, _):
            return self
        def blob(self, _):
            self.count += 1
            return Blob(self.count)
    store = GCSStore("private-test-bucket", client=Client())
    assert store.read_json("jobs/id/state.json") == ({"state": "running"}, "2")
