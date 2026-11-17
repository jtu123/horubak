from fastapi import FastAPI, UploadFile, File, HTTPException
from faster_whisper import WhisperModel

import os
import tempfile

app = FastAPI(
    title="Moment AI Server",
    description="AI 영상 하이라이트 분석 서버",
    version="1.0.0"
)

# Whisper 모델은 CPU에서 실행
# 최초 실행 시 모델 파일이 다운로드될 수 있음
model = WhisperModel(
    "small",
    device="cpu",
    compute_type="int8"
)


@app.get("/")
def root():
    return {
        "message": "Moment AI Server 실행 성공"
    }


@app.get("/health")
def health():
    return {
        "status": "ok"
    }


@app.post("/api/stt/transcribe")
def transcribe_audio(file: UploadFile = File(...)):

    if not file.filename or not file.filename.lower().endswith(".wav"):
        raise HTTPException(
            status_code=400,
            detail="WAV 파일만 업로드할 수 있습니다."
        )

    temp_path = None

    try:
        # 업로드된 WAV 파일을 임시 파일로 저장
        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=".wav"
        ) as temp_file:
            temp_path = temp_file.name

            while chunk := file.file.read(1024 * 1024):
                temp_file.write(chunk)

        # Whisper 음성 인식
        segments, info = model.transcribe(
            temp_path,
            language=None,
            vad_filter=True,
            condition_on_previous_text=False
        )

        # 문장별 시간 정보와 텍스트 추출
        results = []

        for segment in segments:
            results.append({
                "start": round(segment.start, 2),
                "end": round(segment.end, 2),
                "text": segment.text.strip()
            })

        return {
            "language": info.language,
            "segments": results
        }

    except Exception as e:
        import traceback
        traceback.print_exc()

        raise HTTPException(
        status_code=500,
        detail=f"음성 인식 실패: {str(e)}"
    )

    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
