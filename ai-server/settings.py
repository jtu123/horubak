"""Operator-controlled settings. Secrets never originate in browser requests."""
import os


def integer(name: str, default: int, minimum: int, maximum: int) -> int:
    value = int(os.getenv(name, str(default)))
    if not minimum <= value <= maximum:
        raise ValueError(f"Invalid {name}")
    return value


MAX_UPLOAD_BYTES = integer("MAX_UPLOAD_BYTES", 90 * 1024 * 1024, 1024, 94 * 1024 * 1024)
MAX_DURATION_SECONDS = integer("MAX_DURATION_SECONDS", 3600, 30, 3600)
STT_TIMEOUT_SECONDS = integer("STT_TIMEOUT_SECONDS", 600, 30, 720)
FFMPEG_TIMEOUT_SECONDS = integer("FFMPEG_TIMEOUT_SECONDS", 90, 10, 300)
GEMINI_TIMEOUT_MS = integer("GEMINI_TIMEOUT_MS", 60000, 1000, 90000)
MAX_SEGMENTS = 20000
TRACKING_MAX_UPLOAD_BYTES = min(MAX_UPLOAD_BYTES, 25 * 1024 * 1024)
TRACKING_TIMEOUT_SECONDS = integer("TRACKING_TIMEOUT_SECONDS", 100, 30, 120)


def gemini_settings() -> tuple[str, str]:
    from fastapi import HTTPException

    key = os.getenv("GEMINI_API_KEY", "").strip()
    model = os.getenv("GEMINI_MODEL", "").strip()
    if not key or not model:
        raise HTTPException(503, "분석 서버의 Gemini 연결 설정이 준비되지 않았습니다.")
    return key, model
