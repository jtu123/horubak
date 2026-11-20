"""Download public model files for the image without loading an inference model."""
import json
import os
from pathlib import Path

from faster_whisper.utils import download_model


def main():
    model = os.environ["WHISPER_MODEL"]
    cache = Path(os.environ["WHISPER_DOWNLOAD_ROOT"])
    cache.mkdir(parents=True, exist_ok=True)
    snapshot = Path(download_model(model, cache_dir=str(cache), use_auth_token=False))
    required = ("config.json", "model.bin", "tokenizer.json")
    if not all((snapshot / name).is_file() for name in required):
        raise RuntimeError("Whisper image model files are incomplete")
    (cache / "preloaded-model.json").write_text(
        json.dumps({"model": model, "snapshot": snapshot.name, "files": required}),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
