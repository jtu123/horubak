"""Fetch one public, pinned OpenCV Zoo model and verify it before installation."""
from pathlib import Path
import os
import tempfile
import urllib.request

from tracking_model import MODEL_BYTES, MODEL_URL, model_path, verify_model


def preload():
    destination = model_path()
    if verify_model(destination):
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    handle, name = tempfile.mkstemp(prefix=".nanodet-", suffix=".tmp", dir=destination.parent)
    os.close(handle)
    temporary = Path(name)
    try:
        with urllib.request.urlopen(MODEL_URL, timeout=90) as response, temporary.open("wb") as output:
            total = 0
            while chunk := response.read(256 * 1024):
                total += len(chunk)
                if total > MODEL_BYTES:
                    raise RuntimeError("Tracking model download exceeded the pinned size")
                output.write(chunk)
        if not verify_model(temporary):
            raise RuntimeError("Tracking model checksum did not match the pinned OpenCV Zoo model")
        os.replace(temporary, destination)
        return destination
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    preload()
    print("Pinned OpenCV Zoo NanoDet model is ready.")
