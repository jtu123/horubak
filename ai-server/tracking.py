"""Authenticated tracking endpoint; native inference runs in a bounded child."""
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile

from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from settings import TRACKING_MAX_UPLOAD_BYTES, TRACKING_TIMEOUT_SECONDS
from tracking_model import model_path, verify_model
from full_tracking_engine_process import run_managed


def create_tracking_router(analysis_lock):
    router = APIRouter()

    def analyze(file, start, end, sample_fps):
        if not verify_model(model_path()):
            raise HTTPException(503, {"code": "MODEL_UNAVAILABLE", "message": "추적 모델이 준비되지 않았습니다. 서버의 모델 준비 설정을 확인해 주세요."})
        if not analysis_lock.acquire(blocking=False):
            raise HTTPException(503, "다른 영상 분석을 처리 중입니다. 잠시 후 다시 시도해 주세요.", headers={"Retry-After": "15"})
        try:
            with tempfile.TemporaryDirectory(prefix="horubak-tracking-") as folder:
                directory = Path(folder)
                source, request_path, output = directory / "source.bin", directory / "request.json", directory / "result.json"
                total = 0
                with source.open("wb") as target:
                    while chunk := file.file.read(1024 * 1024):
                        total += len(chunk)
                        if total > TRACKING_MAX_UPLOAD_BYTES:
                            raise HTTPException(413, "추적 분석은 최대 25 MiB 파일을 지원합니다.")
                        target.write(chunk)
                if not total:
                    raise HTTPException(422, "빈 영상은 분석할 수 없습니다.")
                request_path.write_text(json.dumps({"source": str(source), "start": start, "end": end, "sampleFps": sample_fps}), encoding="utf-8")
                try:
                    process = run_managed([sys.executable, str(Path(__file__).with_name("tracking_worker.py")), str(request_path), str(output)],
                                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=TRACKING_TIMEOUT_SECONDS)
                except subprocess.TimeoutExpired as exc:
                    raise HTTPException(504, "피사체 추적 시간이 초과됐습니다. 더 짧은 구간으로 다시 시도해 주세요.") from exc
                try:
                    if output.stat().st_size > 1536 * 1024:
                        raise ValueError("Result too large")
                    result = json.loads(output.read_text(encoding="utf-8"))
                except (OSError, ValueError) as exc:
                    raise HTTPException(502, "추적 결과를 읽을 수 없습니다.") from exc
                if process.returncode or result.get("error"):
                    statuses = {"INVALID_VIDEO": 422, "INVALID_RANGE": 422, "TIMEOUT": 504,
                                "MODEL_UNAVAILABLE": 503, "ENGINE_UNAVAILABLE": 503, "TOOLS_UNAVAILABLE": 503, "RESULT_LIMIT": 422}
                    raise HTTPException(statuses.get(result.get("error"), 502), result.get("message", "추적 분석을 완료하지 못했습니다."))
                return result
        finally:
            analysis_lock.release()

    @router.post("/api/tracking/analyze")
    async def analyze_media(request: Request, start: float, end: float, sampleFps: float = 2):
        if not (all(math.isfinite(value) for value in (start, end, sampleFps)) and 0 <= start < end
                and end - start <= 120 and 0.5 <= sampleFps <= 4 and math.ceil((end - start) * sampleFps) <= 240):
            raise HTTPException(422, "최대 120초·240프레임 범위와 초당 0.5~4개 관측을 선택해 주세요.")
        async with request.form(max_files=1, max_fields=0, max_part_size=TRACKING_MAX_UPLOAD_BYTES) as form:
            file = form.get("file")
            if not isinstance(file, UploadFile) or len(form) != 1:
                raise HTTPException(422, "추적할 원본 영상 파일 하나가 필요합니다.")
            return await run_in_threadpool(analyze, file, start, end, sampleFps)

    return router
