FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    HF_HOME=/home/analysis/.cache/huggingface WHISPER_DOWNLOAD_ROOT=/home/analysis/.cache/whisper \
    WHISPER_MODEL=small WHISPER_CPU_THREADS=1 WHISPER_LOCAL_FILES_ONLY=true HF_HUB_DISABLE_TELEMETRY=1

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 analysis

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=analysis:analysis preload_model.py ./
COPY --chown=analysis:analysis tracking_model.py preload_tracking_model.py ./
RUN mkdir -p /app/models && chown analysis:analysis /app/models
USER analysis
# Fetch public weights during image creation; this does not run transcription.
RUN python preload_model.py
RUN python preload_tracking_model.py
ENV HF_HUB_OFFLINE=1
COPY --chown=analysis:analysis main.py highlight.py settings.py subtitles.py stt_worker.py ./
COPY --chown=analysis:analysis tracking*.py full_tracking*.py LICENSE-NANODET.txt NOTICE-NANODET.txt ./
EXPOSE 8000
# Exactly one process owns the single-inference lock. PORT supports managed hosts.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --no-access-log --limit-concurrency 8 --timeout-keep-alive 5"]
