import logging
import os
import tempfile

from fastapi import FastAPI, UploadFile, File, HTTPException
from faster_whisper import WhisperModel
from highlight import router as highlight_router

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Moment AI Server",
    description="AI 영상 하이라이트 분석 서버",
    version="1.0.0",
)

app.include_router(highlight_router)

model = WhisperModel(
    "small",
    device="cpu",
    compute_type="int8",
)

# 자막 묶음의 첫 테스트용 기준
MAX_SUBTITLE_SECONDS = 3.0
MAX_SUBTITLE_CHARACTERS = 28
MAX_WORD_GAP_SECONDS = 0.6


def make_subtitle(words):
    """단어 목록을 기존 Spring 응답 형식으로 변환한다."""
    return {
        "start": round(words[0].start, 3),
        "end": round(words[-1].end, 3),
        "text": "".join(word.word for word in words).strip(),
    }


def split_subtitles(segment):
    """단어 시간, 길이, 문장부호를 기준으로 자막을 나눈다."""
    words = segment.words or []

    if not words:
        # 단어 시간이 없는 경우 기존 발화 시간을 사용
        text = segment.text.strip()
        start = round(segment.start, 3)
        end = round(segment.end, 3)

        if text and end > start:
            return [{"start": start, "end": end, "text": text}]

        return []

    subtitles = []
    current_words = []

    for word in words:
        if current_words:
            text = "".join(
                item.word for item in current_words
            ) + word.word

            duration = word.end - current_words[0].start
            gap = word.start - current_words[-1].end

            if (
                duration > MAX_SUBTITLE_SECONDS
                or len(text.strip()) > MAX_SUBTITLE_CHARACTERS
                or gap > MAX_WORD_GAP_SECONDS
            ):
                subtitles.append(make_subtitle(current_words))
                current_words = []

        current_words.append(word)

        if word.word.rstrip().endswith((".", "?", "!", "。", "？", "！")):
            subtitles.append(make_subtitle(current_words))
            current_words = []

    if current_words:
        subtitles.append(make_subtitle(current_words))

    # 문장부호 등에 시간이 배정되지 않은 결과는 이웃 자막에 합침
    results = []

    for subtitle in subtitles:
        if not subtitle["text"]:
            continue

        if subtitle["end"] <= subtitle["start"]:
            if results:
                results[-1]["text"] += subtitle["text"]
            continue

        results.append(subtitle)

    return results


@app.get("/")
def root():
    return {"message": "Moment AI Server 실행 성공"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/stt/transcribe")
def transcribe_audio(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".wav"):
        raise HTTPException(
            status_code=400,
            detail="WAV 파일만 업로드할 수 있습니다.",
        )

    temp_path = None

    try:
        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=".wav",
        ) as temp_file:
            temp_path = temp_file.name

            while chunk := file.file.read(1024 * 1024):
                temp_file.write(chunk)

        segments, info = model.transcribe(
            temp_path,
            language=None,
            vad_filter=True,
            condition_on_previous_text=False,
            word_timestamps=True,
        )

        results = []

        for segment in segments:
            results.extend(split_subtitles(segment))

        return {
            "language": info.language,
            "segments": results,
        }

    except Exception:
        logger.exception("음성 인식 실패")
        raise HTTPException(
            status_code=500,
            detail="음성 인식에 실패했습니다. FastAPI 로그를 확인하세요.",
        )

    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                logger.warning(
                    "임시 음성 파일 삭제 실패",
                    exc_info=True,
                )