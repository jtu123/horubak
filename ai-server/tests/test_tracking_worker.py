import json
from types import SimpleNamespace

import pytest

import tracking_worker
from tracking_model import verify_model


def metadata(width=1920, height=1080, sar="1:1", rotation=0):
    return {"streams": [{"width": width, "height": height, "sample_aspect_ratio": sar,
                         "side_data_list": [{"rotation": rotation}]}], "format": {"duration": "30"}}


@pytest.mark.parametrize("sar,rotation,expected", [("1:1", 0, (1920, 1080)), ("1:1", 90, (1080, 1920)),
                                                  ("2:1", -90, (1080, 3840)), ("0:1", 0, (1920, 1080))])
def test_display_dimensions_and_local_decoder_allowlist(monkeypatch, sar, rotation, expected):
    def probe(arguments, timeout):
        assert arguments[arguments.index("-protocol_whitelist") + 1] == "file,pipe"
        assert arguments[arguments.index("-format_whitelist") + 1] == "mov,matroska,webm"
        assert arguments[arguments.index("-max_alloc") + 1] == "67108864"
        assert timeout <= 15
        return SimpleNamespace(stdout=json.dumps(metadata(sar=sar, rotation=rotation)).encode())
    monkeypatch.setattr(tracking_worker, "run_command", probe)
    result = tracking_worker.probe_source("local.bin")
    assert (result["width"], result["height"]) == expected


@pytest.mark.parametrize("payload", [metadata(width=0), metadata(sar="100:1"), metadata(rotation=45), {"streams": []}])
def test_invalid_media_metadata_is_an_explicit_failure(monkeypatch, payload):
    monkeypatch.setattr(tracking_worker, "run_command", lambda *_: SimpleNamespace(stdout=json.dumps(payload).encode()))
    with pytest.raises(tracking_worker.TrackingFailure, match="1시간 이하"):
        tracking_worker.probe_source("local.bin")


def test_corrupt_model_is_not_accepted(tmp_path):
    checkpoint = tmp_path / "nanodet.onnx"
    checkpoint.write_bytes(b"invalid checkpoint")
    assert verify_model(checkpoint) is False


@pytest.mark.parametrize("width,height", [(7680, 4320), (16384, 16384), (8192, 2160)])
def test_oversized_decoded_frames_are_rejected_before_native_detection(monkeypatch, width, height):
    monkeypatch.setattr(tracking_worker, "run_command", lambda *_: SimpleNamespace(stdout=json.dumps(metadata(width=width, height=height)).encode()))
    with pytest.raises(tracking_worker.TrackingFailure, match="16메가픽셀"):
        tracking_worker.probe_source("local.bin")


def test_4k_frames_fit_the_decoder_budget(monkeypatch):
    monkeypatch.setattr(tracking_worker, "run_command", lambda *_: SimpleNamespace(stdout=json.dumps(metadata(width=3840, height=2160)).encode()))
    result = tracking_worker.probe_source("local.bin")
    assert (result["width"], result["height"]) == (3840, 2160)
