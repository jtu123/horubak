"""Private object storage with CAS and bounded, seekable media access.

GCS uses Application Default Credentials; local is an explicit development driver.
The loopback proxy exposes exactly one immutable object to FFmpeg, never a URL
chosen by the browser. Video bytes are streamed in bounded blocks.
"""
from contextlib import contextmanager
from datetime import timedelta
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import tempfile
import threading
import time
import uuid

BLOCK = 1024 * 1024
MAX_JSON_BYTES = 4 * 1024 * 1024


class Conflict(Exception):
    """The object changed since the caller read it."""


def safe_key(key):
    if not isinstance(key, str) or len(key) > 500 or not re.fullmatch(r"[A-Za-z0-9_./-]+", key) or any(part in {"", ".", ".."} for part in key.split("/")):
        raise ValueError("Invalid storage key")
    return key


def source_key(owner, project, upload):
    for value in (owner, project, upload):
        if str(uuid.UUID(value)) != value:
            raise ValueError("Invalid source identity")
    return f"originals/{owner}/{project}/{upload}"


def checked_source(source):
    key = safe_key(source["objectKey"])
    parts = key.split("/")
    if len(parts) != 4 or parts[0] != "originals" or source_key(*parts[1:]) != key or parts[3] != source["uploadId"]:
        raise ValueError("Invalid source object")
    if not isinstance(source.get("generation"), str) or not re.fullmatch(r"[0-9]{1,30}", source["generation"]):
        raise ValueError("Invalid source generation")
    return key


def encoded(value):
    payload = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
    if len(payload) > MAX_JSON_BYTES:
        raise ValueError("Storage JSON exceeds its limit")
    return payload


@contextmanager
def file_lock(path):
    """A cross-process local lock, including independent job processes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as stream:
        # Windows permits locking a byte beyond EOF. Do not initialize byte0:
        # another process may already hold that byte while this handle opens.
        stream.seek(0)
        if os.name == "nt":
            import msvcrt
            # LK_LOCK only retries ten times; explicitly wait with a deadline.
            deadline = time.monotonic() + 20
            while True:
                try:
                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError:
                    if time.monotonic() > deadline:
                        raise Conflict("Local store lock timeout")
                    time.sleep(.02)
            try:
                yield
            finally:
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


class SeekableSource:
    @contextmanager
    def source_url(self, source):
        checked_source(source)
        size = int(source["size"])
        token = secrets.token_urlsafe(32)
        store = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_HEAD(self):
                self.serve(head=True)

            def do_GET(self):
                self.serve(head=False)

            def serve(self, head):
                if not secrets.compare_digest(self.path, "/" + token):
                    self.send_error(404)
                    return
                begin, end, partial = 0, size - 1, False
                header = self.headers.get("Range")
                if header:
                    match = re.fullmatch(r"bytes=(\d*)-(\d*)", header)
                    if not match or not any(match.groups()):
                        self.send_error(416)
                        return
                    if not match[1]:
                        begin = max(0, size - int(match[2]))
                    else:
                        begin = int(match[1])
                        end = min(size - 1, int(match[2])) if match[2] else size - 1
                    partial = True
                    if not 0 <= begin <= end < size:
                        self.send_error(416)
                        return
                try:
                    # Opening verifies the immutable generation before headers.
                    with store.open_source(source, begin, end) as reader:
                        self.send_response(206 if partial else 200)
                        self.send_header("Content-Type", "application/octet-stream")
                        self.send_header("Accept-Ranges", "bytes")
                        self.send_header("Content-Length", str(end - begin + 1))
                        if partial:
                            self.send_header("Content-Range", f"bytes {begin}-{end}/{size}")
                        self.end_headers()
                        if not head:
                            remaining = end - begin + 1
                            while remaining:
                                block = reader.read(min(BLOCK, remaining))
                                if not block:
                                    break
                                self.wfile.write(block)
                                remaining -= len(block)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                except Exception:
                    self.close_connection = True

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            # Surface a missing/replaced source before launching native tools.
            with self.open_source(source, 0, 0):
                pass
            yield f"http://127.0.0.1:{server.server_port}/{token}", dict(source)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def source_sha256(self, source, heartbeat):
        digest = hashlib.sha256()
        with self.open_source(source, 0, int(source["size"]) - 1) as reader:
            while block := reader.read(BLOCK):
                digest.update(block)
                heartbeat()
        return digest.hexdigest()


class LocalStore(SeekableSource):
    def __init__(self, directory):
        self.root = Path(directory).resolve()
        if os.name == "nt" and not str(self.root).startswith("\\\\?\\"):
            value = str(self.root)
            self.root = Path("\\\\?\\UNC\\" + value[2:] if value.startswith("\\\\") else "\\\\?\\" + value)
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, key):
        path = (self.root / safe_key(key)).resolve()
        if not path.is_relative_to(self.root) or path == self.root:
            raise ValueError("Storage path escaped its root")
        return path

    def read_json(self, key):
        path = self.path(key)
        try:
            if path.stat().st_size > MAX_JSON_BYTES + 200:
                raise ValueError("Storage JSON exceeds its limit")
            envelope = json.loads(path.read_text(encoding="utf-8"))
            return envelope["value"], envelope["version"]
        except FileNotFoundError:
            return None, None

    def write_json(self, key, value, expected=None):
        path = self.path(key)
        with file_lock(self.root / ".store-lock"):
            _, current = self.read_json(key)
            if expected == "0" and current is not None or expected not in (None, "0") and current != expected:
                raise Conflict("Object version changed")
            version = str(uuid.uuid4())
            payload = encoded({"version": version, "value": value})
            path.parent.mkdir(parents=True, exist_ok=True)
            handle, name = tempfile.mkstemp(prefix=".write-", dir=path.parent)
            try:
                with os.fdopen(handle, "wb") as output:
                    output.write(payload)
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(name, path)
            finally:
                Path(name).unlink(missing_ok=True)
            return version

    @contextmanager
    def open_source(self, source, start, end):
        path = self.path(checked_source(source))
        with path.open("rb") as stream:
            stat = os.fstat(stream.fileno())
            if str(stat.st_mtime_ns) != source["generation"] or stat.st_size != source["size"]:
                raise ValueError("Source generation changed")
            stream.seek(start)
            yield stream


class GCSStore(SeekableSource):
    def __init__(self, bucket_name, client=None):
        if not re.fullmatch(r"[a-z0-9][a-z0-9_.-]{1,220}[a-z0-9]", bucket_name or ""):
            raise ValueError("A private GCS bucket must be configured")
        if client is None:
            from google.cloud import storage
            client = storage.Client()
        self.client = client
        self.bucket = client.bucket(bucket_name)

    def read_json(self, key):
        from google.api_core.exceptions import NotFound, PreconditionFailed
        key = safe_key(key)
        for _ in range(3):
            # A new unpinned Blob is necessary: reload on the old Blob would
            # keep requesting its previous generation after an overwrite.
            blob = self.bucket.blob(key)
            try:
                blob.reload(timeout=10, retry=None)
            except NotFound:
                return None, None
            if blob.size > MAX_JSON_BYTES:
                raise ValueError("Storage JSON exceeds its limit")
            version = str(blob.generation)
            try:
                payload = blob.download_as_bytes(if_generation_match=int(version), timeout=10, retry=None)
                return json.loads(payload), version
            except (NotFound, PreconditionFailed):
                continue  # A writer replaced it between metadata and download.
        raise Conflict("Object kept changing during a bounded read")

    def write_json(self, key, value, expected=None):
        from google.api_core.exceptions import Conflict as GoogleConflict, PreconditionFailed
        blob = self.bucket.blob(safe_key(key))
        try:
            blob.upload_from_string(encoded(value), content_type="application/json", if_generation_match=int(expected) if expected is not None else None, timeout=15, retry=None)
            return str(blob.generation)
        except (PreconditionFailed, GoogleConflict) as error:
            raise Conflict("Object version changed") from error

    @contextmanager
    def open_source(self, source, start, end):
        # BlobReader performs bounded HTTP range reads and pins the generation.
        blob = self.bucket.blob(checked_source(source), generation=int(source["generation"]))
        blob.reload(if_generation_match=int(source["generation"]), timeout=15, retry=None)
        if blob.size != source["size"]:
            raise ValueError("Source size changed")
        with blob.open("rb", chunk_size=8 * BLOCK, if_generation_match=int(source["generation"]), timeout=15, retry=None) as reader:
            reader.seek(start)
            yield reader

    def playback(self, source):
        from google.auth.transport.requests import Request
        credentials = self.client._credentials
        credentials.refresh(Request())
        email = os.getenv("TRACKING_SIGNER_SERVICE_ACCOUNT") or getattr(credentials, "service_account_email", None)
        if not email or email == "default":
            raise ValueError("Playback URL signer service account is not configured")
        blob = self.bucket.blob(checked_source(source), generation=int(source["generation"]))
        return blob.generate_signed_url(version="v4", expiration=timedelta(hours=12), method="GET",
                                        generation=source["generation"], service_account_email=email,
                                        access_token=credentials.token)


def create_store():
    driver = os.getenv("TRACKING_STORAGE_DRIVER", "disabled")
    if driver == "local":
        directory = os.getenv("TRACKING_LOCAL_DIRECTORY")
        if not directory:
            raise ValueError("Local tracking storage directory is required")
        if os.getenv("K_SERVICE") or os.getenv("CLOUD_RUN_JOB"):
            raise ValueError("Local tracking storage is forbidden in Cloud Run")
        return LocalStore(directory)
    if driver == "gcs":
        return GCSStore(os.getenv("TRACKING_GCS_BUCKET", ""))
    raise ValueError("Full-video tracking storage is not configured")
