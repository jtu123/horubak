"""Small authenticated control requests; originals bypass the API request body."""
from datetime import datetime, timezone
import hashlib
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time
from urllib.parse import urlsplit
from uuid import UUID
import zlib

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from full_tracking_store import BLOCK, Conflict, LocalStore, checked_source, create_store, file_lock, source_key

CHUNK_BYTES = 8 * BLOCK
MAX_SOURCE_BYTES = 4 * 1024 ** 3


def iso(value=None):
    return datetime.fromtimestamp(value if value is not None else time.time(), timezone.utc).isoformat().replace("+00:00", "Z")


def failure(code, message, status=503):
    raise HTTPException(status, {"code": code, "message": message})


def configured_store():
    try:
        return create_store()
    except (ValueError, ImportError):
        failure("FULL_TRACKING_NOT_CONFIGURED", "전체 영상 추적 저장소 설정이 준비되지 않았습니다.")


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class UploadInput(Input):
    ownerId: UUID
    projectId: UUID
    uploadId: UUID
    filename: str = Field(min_length=1, max_length=500)
    size: int = Field(gt=0, le=MAX_SOURCE_BYTES)
    contentType: str = Field(default="video/mp4", max_length=100)
    origin: str = Field(default="", max_length=300)


class Source(Input):
    uploadId: UUID
    filename: str = Field(min_length=1, max_length=500)
    size: int = Field(gt=0, le=MAX_SOURCE_BYTES)
    duration: float = Field(gt=0, le=36000)
    width: int = Field(gt=0, le=163840)
    height: int = Field(gt=0, le=163840)
    objectKey: str = Field(max_length=500)
    generation: str = Field(max_length=30)
    checksum: str = Field(min_length=1, max_length=200)


class SourceInput(Input):
    source: Source


class JobInput(Input):
    jobId: UUID


class CreateInput(JobInput):
    source: Source


class WindowInput(JobInput):
    start: float = Field(ge=0, le=36000)


def upload_values(value):
    body = value.model_dump(mode="json")
    if any(ord(c) < 32 or ord(c) == 127 for c in body["filename"]) or not re.search(r"\.(mp4|mov|webm)$", body["filename"], re.I):
        failure("INVALID_SOURCE", "MP4·MOV 원본 파일을 확인해 주세요.", 422)
    if body["contentType"] not in {"video/mp4", "video/quicktime", "video/webm", "application/octet-stream"}:
        failure("INVALID_SOURCE", "지원되는 영상 파일 형식이 필요합니다.", 422)
    body["objectKey"] = source_key(body["ownerId"], body["projectId"], body["uploadId"])
    return body


def allowed_origin(origin):
    configured = [value.strip().rstrip("/") for value in os.getenv("TRACKING_ALLOWED_ORIGINS", "").split(",") if value.strip()]
    if origin not in configured:
        failure("UPLOAD_ORIGIN_INVALID", "원본 업로드 출처 설정을 확인해 주세요.", 422)
    url = urlsplit(origin)
    if url.username or url.password or url.path or url.query or url.fragment or not (url.scheme == "https" or url.scheme == "http" and url.hostname in {"localhost", "127.0.0.1"}):
        failure("UPLOAD_ORIGIN_INVALID", "원본 업로드 출처 설정을 확인해 주세요.", 422)
    return origin


def local_base():
    value = os.getenv("TRACKING_LOCAL_PUBLIC_URL", "").rstrip("/")
    url = urlsplit(value)
    if url.scheme != "http" or url.hostname not in {"127.0.0.1", "localhost"} or url.username or url.password or url.path or url.query or url.fragment:
        failure("FULL_TRACKING_NOT_CONFIGURED", "로컬 저장소 주소는 명시적인 localhost HTTP 주소여야 합니다.")
    return value


def initialize_upload(store, body):
    allowed_origin(body["origin"])
    key = f"uploads/{body['uploadId']}.json"
    existing, _ = store.read_json(key)
    if existing:
        if any(existing.get(name) != body[name] for name in ("ownerId", "projectId", "size", "filename", "objectKey")):
            failure("SOURCE_CHANGED", "업로드 원본 정보가 변경됐습니다.", 409)
        if existing["expires"] > time.time():
            return {"uploadUrl": existing["uploadUrl"], "chunkBytes": CHUNK_BYTES, "expiresAt": iso(existing["expires"])}
        failure("UPLOAD_EXPIRED", "업로드 세션이 만료됐습니다. 새로 업로드해 주세요.", 409)
    expires = time.time() + 86400
    token = secrets.token_urlsafe(32)
    if isinstance(store, LocalStore):
        url = f"{local_base()}/resumable/{body['uploadId']}/{token}"
    else:
        blob = store.bucket.blob(body["objectKey"])
        url = blob.create_resumable_upload_session(content_type=body["contentType"], size=body["size"], origin=body["origin"], if_generation_match=0, timeout=30)
        if not url.startswith("https://storage.googleapis.com/"):
            raise ValueError("Unexpected Google upload session")
    record = {**body, "expires": expires, "uploadUrl": url, "tokenHash": hashlib.sha256(token.encode()).hexdigest(), "offset": 0, "crc32": 0}
    store.write_json(key, record, expected="0")
    return {"uploadUrl": url, "chunkBytes": CHUNK_BYTES, "expiresAt": iso(expires)}


def complete_upload(store, body):
    record, version = store.read_json(f"uploads/{body['uploadId']}.json")
    if not record or any(record.get(name) != body[name] for name in ("ownerId", "projectId", "size", "filename", "objectKey")):
        failure("UPLOAD_NOT_FOUND", "업로드 원본을 찾을 수 없습니다.", 404)
    if record.get("source"):
        return record["source"]
    if isinstance(store, LocalStore):
        path = store.path(body["objectKey"])
        if record["offset"] != body["size"] or not path.is_file() or path.stat().st_size != body["size"]:
            failure("UPLOAD_INCOMPLETE", "원본 업로드가 아직 완료되지 않았습니다.", 409)
        generation = str(path.stat().st_mtime_ns)
        checksum = f"crc32-{record['crc32']:08x}"
    else:
        blob = store.bucket.blob(body["objectKey"])
        blob.reload(timeout=20)
        if blob.size != body["size"]:
            failure("UPLOAD_INCOMPLETE", "원본 크기가 등록 정보와 다릅니다.", 409)
        generation, checksum = str(blob.generation), blob.crc32c
    source = {"uploadId": body["uploadId"], "filename": body["filename"], "size": body["size"], "objectKey": body["objectKey"], "generation": generation, "checksum": checksum}
    from full_tracking_engine_media import probe_full_source
    with store.source_url(source) as (url, _):
        media = probe_full_source(url)
    source.update({name: media[name] for name in ("duration", "width", "height")})
    Source.model_validate(source)
    job_functions().validate_source(source)
    record["source"] = source
    store.write_json(f"uploads/{body['uploadId']}.json", record, expected=version)
    return source


def job_functions():
    import full_tracking_job
    return full_tracking_job


def process_info(pid):
    """Query only a child PID; never use os.kill(pid, 0) on Windows."""
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return (None if ctypes.get_last_error() == 5 else False), None
        try:
            exit_code = wintypes.DWORD()
            kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
            kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
            created, exited, system, user = [wintypes.FILETIME() for _ in range(4)]
            if not kernel.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
                return None, None
            birth = None
            if kernel.GetProcessTimes(handle, ctypes.byref(created), ctypes.byref(exited), ctypes.byref(system), ctypes.byref(user)):
                birth = str((created.dwHighDateTime << 32) | created.dwLowDateTime)
            return exit_code.value == 259, birth
        finally:
            kernel.CloseHandle.argtypes = [wintypes.HANDLE]
            kernel.CloseHandle(handle)
    try:
        fields = Path(f"/proc/{int(pid)}/stat").read_text().rsplit(")", 1)[1].split()
        return fields[0] != "Z", fields[19]
    except FileNotFoundError:
        return False, None
    except (OSError, IndexError, ValueError):
        return None, None


def execution_active(store, execution):
    if isinstance(store, LocalStore):
        alive, birth = process_info(int(execution["pid"]))
        if alive and execution.get("birth") and birth != execution["birth"]:
            return False
        return alive
    from google.auth.transport.requests import AuthorizedSession
    identity = execution["id"]
    if not re.fullmatch(r"projects/[A-Za-z0-9_-]+/locations/[a-z0-9-]+/(?:jobs/[a-z0-9-]+/executions|operations)/[A-Za-z0-9_-]+", identity):
        return None
    response = AuthorizedSession(store.client._credentials).get("https://run.googleapis.com/v2/" + identity, timeout=15, allow_redirects=False)
    response.raise_for_status()
    resource = response.json()
    if "/operations/" in identity:
        return False if resource.get("done") else True
    return False if resource.get("completionTime") else True


def reconcile_job(store, job_id):
    from full_tracking_dispatch import QUEUE_KEY, abandon
    job = job_functions().job_status(store, job_id)
    if job["state"] not in {"queued", "running", "cancelling"}:
        return job
    state, _ = store.read_json(f"jobs/{job_id}/state.json")
    updated = state.get("_heartbeat") or datetime.fromisoformat(job["updatedAt"].replace("Z", "+00:00")).timestamp()
    if time.time() - updated < 30:
        return job
    queue, _ = store.read_json(QUEUE_KEY)
    reserved = queue and (queue["current"] == job_id or job_id in queue["pending"])
    runner = queue.get("runner") if reserved else None
    execution = (runner or {}).get("execution")
    if reserved and not execution:
        # A pending launch may not have returned its execution ID yet. Do not
        # replace that reservation or consult an execution from a prior attempt.
        if job["state"] != "queued" or runner and runner["expires"] > time.time():
            return job
        lease, _ = store.read_json("locks/tracking.json")
        if lease and lease.get("expiresAt", 0) > time.time():
            return job  # Launch succeeded but its response may have been lost.
        try:
            execute_job(store, job_id)  # enqueue CAS elects one recovery runner.
        except Conflict:
            raise
        except Exception:
            job_functions().mark_dispatch_failed(store, job_id, "DISPATCH_FAILED", "추적 작업을 시작하지 못했습니다. 다시 시작해 주세요.")
        return job_functions().job_status(store, job_id)
    if not execution and not reserved:
        execution, _ = store.read_json(f"jobs/{job_id}/execution.json")
    if execution and execution_active(store, execution) is False:
        if job["state"] == "cancelling":
            job_functions().update_state(store, job_id, {"state": "cancelled", "error": None}, allowed={"cancelling"})
        else:
            job_functions().mark_interrupted(store, job_id)
        queue, _ = store.read_json("queues/tracking.json")
        if queue and queue.get("runner") and queue["runner"].get("execution") == execution:
            abandon(store, queue["runner"]["id"])
        job = job_functions().job_status(store, job_id)
    return job


def launch_runner(store, job_id, identity):
    if isinstance(store, LocalStore):
        environment = {**os.environ, "HORUBAK_TRACKING_JOB_ID": job_id, "HORUBAK_TRACKING_RUNNER_ID": identity, "PYTHONUNBUFFERED": "1"}
        options = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {"start_new_session": True}
        process = subprocess.Popen([sys.executable, str(Path(__file__).with_name("full_tracking_dispatch.py"))], cwd=Path(__file__).parent,
                                   env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **options)
        return {"id": f"local-{process.pid}-{secrets.token_hex(6)}", "pid": process.pid, "birth": process_info(process.pid)[1], "startedAt": iso()}
    from google.auth.transport.requests import AuthorizedSession
    resource = os.getenv("TRACKING_JOB_RESOURCE", "")
    if not re.fullmatch(r"projects/[A-Za-z0-9_-]+/locations/[a-z0-9-]+/jobs/[a-z0-9-]+", resource):
        failure("FULL_TRACKING_NOT_CONFIGURED", "Cloud Run Jobs 실행 대상이 설정되지 않았습니다.")
    session = AuthorizedSession(store.client._credentials)
    response = session.post("https://run.googleapis.com/v2/" + resource + ":run", json={"overrides": {"taskCount": 1, "containerOverrides": [{"env": [{"name": "HORUBAK_TRACKING_JOB_ID", "value": job_id}, {"name": "HORUBAK_TRACKING_RUNNER_ID", "value": identity}]}]}}, timeout=30, allow_redirects=False)
    response.raise_for_status()
    operation = response.json()
    return {"id": operation.get("metadata", {}).get("name") or operation["name"], "startedAt": iso()}


def execute_job(store, job_id):
    from full_tracking_dispatch import QueueFull, abandon, enqueue, execution_for, set_execution
    state = job_functions().job_status(store, job_id)
    if state["state"] == "completed":
        return {"executionId": "completed-" + job_id}
    try:
        identity = enqueue(store, job_id)
    except QueueFull:
        job_functions().mark_dispatch_failed(store, job_id, "QUEUE_FULL", "분석 대기열이 가득 찼습니다. 잠시 후 다시 시작해 주세요.")
        raise HTTPException(503, {"code": "ANALYSIS_BUSY", "message": "분석 대기열이 가득 찼습니다."}, headers={"Retry-After": "15"})
    if identity is None:
        existing = execution_for(store, job_id)
        return {"executionId": existing["id"] if existing else "queued-" + job_id}
    try:
        execution = launch_runner(store, job_id, identity)
    except Exception:
        from full_tracking_dispatch import drop_pending
        abandon(store, identity)
        drop_pending(store, job_id)
        raise
    store.write_json(f"jobs/{job_id}/execution.json", execution)
    try:
        set_execution(store, identity, execution)
    except Conflict:
        if job_functions().job_status(store, job_id)["state"] not in {"completed", "cancelled", "failed"}:
            raise
    return {"executionId": execution["id"]}


def public_error(error):
    if isinstance(error, HTTPException):
        raise error
    if isinstance(error, Conflict):
        failure("TRACKING_BUSY", "다른 작업이 상태를 변경했습니다. 다시 확인해 주세요.", 409)
    if isinstance(error, (KeyError, ValueError)):
        failure("FULL_TRACKING_INVALID", "원본 또는 작업 정보를 확인해 주세요.", 422)
    if getattr(error, "code", None) in {"INVALID_VIDEO", "INVALID_RANGE", "INCOMPLETE_VIDEO", "UNSUPPORTED_TIMELINE", "TOOLS_UNAVAILABLE"}:
        failure(error.code, str(error), 422 if error.code != "TOOLS_UNAVAILABLE" else 503)
    failure("FULL_TRACKING_STORAGE_FAILED", "전체 추적 저장소 또는 실행 서비스에 연결하지 못했습니다.")


def create_full_tracking_router():
    router = APIRouter()

    @router.post("/api/full-tracking/uploads/init")
    def initialize(value: UploadInput):
        try:
            return initialize_upload(configured_store(), upload_values(value))
        except Exception as error:
            return public_error(error)

    @router.post("/api/full-tracking/uploads/complete")
    def complete(value: UploadInput):
        try:
            return complete_upload(configured_store(), upload_values(value))
        except Exception as error:
            return public_error(error)

    @router.post("/api/full-tracking/source/playback")
    def playback(value: SourceInput):
        try:
            source = value.source.model_dump(mode="json")
            checked_source(source)
            store = configured_store()
            if isinstance(store, LocalStore):
                record, version = store.read_json(f"uploads/{source['uploadId']}.json")
                if not record or record.get("source") != source:
                    failure("SOURCE_NOT_FOUND", "원본 재생 세션을 다시 연결해 주세요.", 404)
                # A completed local source outlives the upload session. Only an
                # authenticated private playback request renews this capability.
                record["expires"] = time.time() + 43200
                store.write_json(f"uploads/{source['uploadId']}.json", record, expected=version)
                token = record["uploadUrl"].rsplit("/", 1)[1]
                url = f"{local_base()}/tracking-media/{source['uploadId']}/{token}"
            else:
                url = store.playback(source)
            return {"url": url, "expiresAt": iso(time.time() + 43200)}
        except Exception as error:
            return public_error(error)

    @router.post("/api/full-tracking/jobs/create")
    def create(value: CreateInput):
        try:
            source = value.source.model_dump(mode="json")
            checked_source(source)
            return job_functions().create_job(configured_store(), str(value.jobId), source)
        except Exception as error:
            return public_error(error)

    @router.post("/api/full-tracking/jobs/dispatch")
    def dispatch(value: JobInput):
        store = configured_store()
        job_id = str(value.jobId)
        try:
            return execute_job(store, job_id)
        except Conflict as error:
            return public_error(error)
        except Exception as error:
            # Persist an explicit dispatch failure instead of an eternal queue.
            helper = getattr(job_functions(), "mark_dispatch_failed", None)
            if helper:
                helper(store, job_id, "DISPATCH_FAILED", "추적 작업을 시작하지 못했습니다. 다시 시작해 주세요.")
            return public_error(error)

    @router.post("/api/full-tracking/jobs/status")
    def status(value: JobInput):
        try:
            return reconcile_job(configured_store(), str(value.jobId))
        except Exception as error:
            return public_error(error)

    @router.post("/api/full-tracking/jobs/cancel")
    def cancel(value: JobInput):
        try:
            from full_tracking_dispatch import drop_pending
            store = configured_store()
            job_id = str(value.jobId)
            job = job_functions().cancel_job(store, job_id)
            if job["state"] == "cancelling" and drop_pending(store, job_id):
                job_functions().update_state(store, job_id, {"state": "cancelled", "error": None}, allowed={"queued", "cancelling"})
            return job_functions().job_status(store, job_id)
        except Exception as error:
            return public_error(error)

    @router.post("/api/full-tracking/jobs/resume")
    def resume(value: JobInput):
        try:
            store = configured_store()
            job = job_functions().resume_job(store, str(value.jobId))
            if job["state"] != "completed":
                execute_job(store, str(value.jobId))
            return job_functions().job_status(store, str(value.jobId))
        except Exception as error:
            return public_error(error)

    @router.post("/api/full-tracking/jobs/window")
    def window(value: WindowInput):
        try:
            return {"result": job_functions().read_window(configured_store(), str(value.jobId), value.start)}
        except Exception as error:
            return public_error(error)

    # Local development storage emulates the GCS resumable wire protocol. These
    # are capability URLs, not app APIs; each binds one upload/size/origin/expiry.
    @router.options("/resumable/{upload_id}/{token}")
    async def upload_options(upload_id: UUID, token: str, request: Request):
        store, record, _ = local_upload(upload_id, token)
        return Response(headers=cors_headers(record, request))

    @router.put("/resumable/{upload_id}/{token}")
    async def upload_part(upload_id: UUID, token: str, request: Request):
        store, record, _ = local_upload(upload_id, token)
        headers = cors_headers(record, request)
        specification = request.headers.get("content-range", "")
        size = record["size"]
        if specification == f"bytes */{size}":
            headers.update(offset_headers(record["offset"]))
            return Response(status_code=200 if record["offset"] == size else 308, headers=headers)
        match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", specification)
        if not match:
            failure("UPLOAD_RANGE_INVALID", "업로드 구간이 올바르지 않습니다.", 422)
        begin, end, total = map(int, match.groups())
        if total != size or not 0 <= begin <= end < size or end - begin + 1 > CHUNK_BYTES or end + 1 < size and (end - begin + 1) % (256 * 1024):
            failure("UPLOAD_RANGE_INVALID", "업로드 구간이 올바르지 않습니다.", 422)
        announced = request.headers.get("content-length")
        if announced and (not announced.isdecimal() or int(announced) != end - begin + 1):
            failure("UPLOAD_RANGE_INVALID", "업로드 크기가 구간과 다릅니다.", 422)
        data = bytearray()
        async for block in request.stream():
            data.extend(block)
            if len(data) > end - begin + 1:
                failure("UPLOAD_TOO_LARGE", "업로드 조각 크기를 초과했습니다.", 413)
        if len(data) != end - begin + 1:
            failure("UPLOAD_INCOMPLETE", "업로드 조각이 완전하지 않습니다.", 422)
        with file_lock(store.root / f".upload-{upload_id}.lock"):
            record, version = store.read_json(f"uploads/{upload_id}.json")
            if record.get("source") or record["offset"] != begin:
                return Response(status_code=409, headers={**headers, **offset_headers(record["offset"])})
            path = store.path(record["objectKey"])
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("r+b" if path.exists() else "w+b") as output:
                output.seek(0, 2)
                if output.tell() < begin:
                    failure("UPLOAD_INCOMPLETE", "업로드 파일 위치를 다시 확인해 주세요.", 409)
                # Only metadata-committed bytes are durable upload progress.
                # Discard a tail left by an interrupted write, then retry it.
                output.truncate(begin)
                output.seek(begin)
                output.write(data)
                output.flush()
                os.fsync(output.fileno())
            record["offset"] = end + 1
            record["crc32"] = zlib.crc32(data, record["crc32"])
            store.write_json(f"uploads/{upload_id}.json", record, expected=version)
        return Response(status_code=200 if end + 1 == size else 308, headers={**headers, **offset_headers(end + 1)})

    @router.get("/tracking-media/{upload_id}/{token}")
    async def local_media(upload_id: UUID, token: str, request: Request):
        store, record, _ = local_upload(upload_id, token)
        source = record.get("source")
        if not source:
            failure("SOURCE_NOT_FOUND", "원본 업로드를 완료해 주세요.", 404)
        checked_source(source)
        path = store.path(source["objectKey"])
        if not path.is_file() or str(path.stat().st_mtime_ns) != source["generation"]:
            failure("SOURCE_CHANGED", "원본 파일이 변경됐습니다.", 409)
        return FileResponse(path, media_type=record["contentType"], headers={**cors_headers(record, request), "Cache-Control": "private,no-store"})

    return router


def local_upload(upload_id, token):
    store = configured_store()
    if not isinstance(store, LocalStore) or len(token) > 100:
        failure("NOT_FOUND", "업로드 세션을 찾을 수 없습니다.", 404)
    record, version = store.read_json(f"uploads/{upload_id}.json")
    if not record or record["expires"] <= time.time() or not secrets.compare_digest(record["tokenHash"], hashlib.sha256(token.encode()).hexdigest()):
        failure("UPLOAD_EXPIRED", "업로드 세션을 찾을 수 없거나 만료됐습니다.", 404)
    return store, record, version


def cors_headers(record, request):
    origin = request.headers.get("origin")
    if origin and origin != record["origin"]:
        failure("UPLOAD_ORIGIN_INVALID", "허용하지 않는 업로드 출처입니다.", 403)
    return {"Access-Control-Allow-Origin": record["origin"], "Access-Control-Allow-Methods": "PUT,GET,HEAD,OPTIONS",
            "Access-Control-Allow-Headers": "content-type,content-range", "Access-Control-Expose-Headers": "Range,Content-Range", "Vary": "Origin"}


def offset_headers(offset):
    return {"Range": f"bytes=0-{offset - 1}"} if offset else {}
