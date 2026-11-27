"""Private analysis API behind the demo's authenticated project API."""
import hashlib
import json
import logging
import math
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import threading

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import Headers, UploadFile
from starlette.formparsers import MultiPartException

from highlight import router as highlight_router
from settings import FFMPEG_TIMEOUT_SECONDS, MAX_DURATION_SECONDS, MAX_UPLOAD_BYTES, STT_TIMEOUT_SECONDS, TRACKING_MAX_UPLOAD_BYTES
from tracking import create_tracking_router
from full_tracking_control import create_full_tracking_router

logger = logging.getLogger(__name__)
_analysis_lock = threading.Lock()


class ServiceBoundary:
    """Authenticate and bound streaming bodies before multipart parsing."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        if not scope["path"].startswith("/api/"):
            return await self.app(scope, receive, send)
        headers = Headers(scope=scope)
        configured = os.getenv("ANALYSIS_SERVICE_TOKEN", "")
        if len(configured) < 32:
            return await JSONResponse({"detail": "분석 서버 인증 설정이 준비되지 않았습니다."}, 503)(scope, receive, send)
        provided = headers.get("authorization", "")
        if not secrets.compare_digest(provided.encode(), f"Bearer {configured}".encode()):
            return await JSONResponse({"detail": "분석 서비스 인증이 필요합니다."}, 401)(scope, receive, send)
        upload = scope["path"] in {"/api/stt/transcribe", "/api/tracking/analyze"}
        upload_limit = TRACKING_MAX_UPLOAD_BYTES if scope["path"] == "/api/tracking/analyze" else MAX_UPLOAD_BYTES
        maximum = upload_limit + 1024 * 1024 if upload else 4 * 1024 * 1024
        length = headers.get("content-length")
        if length is not None:
            try:
                valid_length = 0 <= int(length) <= maximum
            except ValueError:
                valid_length = False
            if not valid_length:
                return await JSONResponse({"detail": "분석 요청 크기 제한을 초과했습니다."}, 413)(scope, receive, send)
        total = 0

        async def limited_receive():
            nonlocal total
            message = await receive()
            if message["type"] == "http.request":
                total += len(message.get("body", b""))
                if total > maximum:
                    # Starlette closes its already-spooled multipart files on this exception.
                    if upload:
                        raise MultiPartException("분석 요청 크기 제한을 초과했습니다.")
                    raise HTTPException(413, "분석 요청 크기 제한을 초과했습니다.")
            return message

        return await self.app(scope, limited_receive, send)


app = FastAPI(title="호루박 분석 서버", version="1.1.0", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(ServiceBoundary)
app.include_router(highlight_router)
app.include_router(create_tracking_router(_analysis_lock))
app.include_router(create_full_tracking_router())


@app.get("/health")
@app.get("/api/health")
def health():
    return {"status": "ok"}


def _command(arguments: list[str], timeout: int):
    try:
        return subprocess.run(arguments, check=True, capture_output=True, timeout=timeout)
    except FileNotFoundError as exc:
        raise HTTPException(503, "분석 서버의 미디어 처리 도구가 준비되지 않았습니다.") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(504, "미디어 처리 시간이 초과됐습니다.") from exc
    except subprocess.CalledProcessError as exc:
        raise HTTPException(422, "오디오가 포함된 지원 영상 또는 음성 파일을 선택해 주세요.") from exc


def _transcribe(file: UploadFile):
    if not _analysis_lock.acquire(blocking=False):
        raise HTTPException(503, "다른 영상의 전사를 처리 중입니다. 잠시 후 다시 시도해 주세요.", headers={"Retry-After": "15"})
    try:
        with tempfile.TemporaryDirectory(prefix="horubak-analysis-") as folder:
            directory = Path(folder)
            source, audio, output = directory / "source.bin", directory / "audio.wav", directory / "result.json"
            digest = hashlib.sha256()
            total = 0
            with source.open("wb") as target:
                while chunk := file.file.read(1024 * 1024):
                    total += len(chunk)
                    if total > MAX_UPLOAD_BYTES:
                        raise HTTPException(413, "영상 파일이 분석 서버의 업로드 제한을 초과했습니다.")
                    digest.update(chunk)
                    target.write(chunk)
            if not total:
                raise HTTPException(422, "빈 파일은 전사할 수 없습니다.")
            probe = _command([
                os.getenv("FFPROBE_BINARY", "ffprobe"), "-v", "error", "-protocol_whitelist", "file,pipe",
                "-format_whitelist", "mov,matroska,webm,wav,mp3,flac,ogg,aac",
                "-select_streams", "a:0", "-show_entries", "format=duration:stream=codec_type,duration", "-of", "json", str(source),
            ], 20)
            try:
                metadata = json.loads(probe.stdout)
                streams = metadata.get("streams", [])
                duration = float(metadata.get("format", {}).get("duration") or streams[0].get("duration"))
                if not streams or not math.isfinite(duration) or not 0 < duration <= MAX_DURATION_SECONDS:
                    raise ValueError("Invalid duration")
            except (ValueError, TypeError, IndexError, KeyError) as exc:
                raise HTTPException(422, "오디오가 있고 길이가 1시간 이하인 파일을 선택해 주세요.") from exc
            _command([
                os.getenv("FFMPEG_BINARY", "ffmpeg"), "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe",
                "-format_whitelist", "mov,matroska,webm,wav,mp3,flac,ogg,aac",
                "-i", str(source), "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
                "-t", str(MAX_DURATION_SECONDS + 1), str(audio),
            ], FFMPEG_TIMEOUT_SECONDS)
            try:
                subprocess.run(
                    [sys.executable, str(Path(__file__).with_name("stt_worker.py")), str(audio), str(output)],
                    check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=STT_TIMEOUT_SECONDS,
                )
            except subprocess.TimeoutExpired as exc:
                raise HTTPException(504, "전사 처리 시간이 초과됐습니다. 더 짧은 영상으로 다시 시도해 주세요.") from exc
            except subprocess.CalledProcessError as exc:
                logger.error("STT worker exited with code %s", exc.returncode)
                raise HTTPException(503, "음성 인식을 완료하지 못했습니다. 분석 서버의 모델 설정을 확인해 주세요.") from exc
            try:
                result = json.loads(output.read_text(encoding="utf-8"))
            except (OSError, ValueError) as exc:
                raise HTTPException(502, "전사 결과를 읽을 수 없습니다.") from exc
            return {**result, "sourceSha256": digest.hexdigest()}
    finally:
        _analysis_lock.release()


@app.post("/api/stt/transcribe")
async def transcribe_media(request: Request):
    async with request.form(max_files=1, max_fields=0, max_part_size=MAX_UPLOAD_BYTES) as form:
        file = form.get("file")
        if not isinstance(file, UploadFile):
            raise HTTPException(422, "전사할 영상 또는 음성 파일이 필요합니다.")
        return await run_in_threadpool(_transcribe, file)
