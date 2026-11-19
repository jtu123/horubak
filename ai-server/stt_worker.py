"""Isolated inference process: killed by its parent on the hard deadline."""
import json
import math
import os
import sys
from pathlib import Path

from settings import MAX_SEGMENTS, integer
from subtitles import split_subtitles

_model = None


def get_model():
    global _model
    if _model is None:
        # Lazy import/load: starting the API and health checks never download a model.
        from faster_whisper import WhisperModel
        _model = WhisperModel(
            os.getenv("WHISPER_MODEL", "small"),
            device=os.getenv("WHISPER_DEVICE", "cpu"),
            compute_type=os.getenv("WHISPER_COMPUTE_TYPE", "int8"),
            cpu_threads=integer("WHISPER_CPU_THREADS", 2, 1, 32),
            num_workers=1,
            download_root=os.getenv("WHISPER_DOWNLOAD_ROOT", None),
            local_files_only=os.getenv("WHISPER_LOCAL_FILES_ONLY", "false").lower() == "true",
        )
    return _model


def main():
    audio, output = Path(sys.argv[1]), Path(sys.argv[2])
    segments, info = get_model().transcribe(
        str(audio), language=os.getenv("WHISPER_LANGUAGE", "ko") or None,
        vad_filter=True, condition_on_previous_text=False, word_timestamps=True,
    )
    results = []
    for segment in segments:
        for subtitle in split_subtitles(segment):
            if (math.isfinite(subtitle["start"]) and math.isfinite(subtitle["end"])
                    and 0 <= subtitle["start"] < subtitle["end"]):
                results.append(subtitle)
        if len(results) > MAX_SEGMENTS:
            raise ValueError("Transcript exceeds segment limit")
    output.write_text(json.dumps({"language": info.language, "segments": results}, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
