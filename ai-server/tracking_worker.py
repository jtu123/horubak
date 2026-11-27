"""Isolated CV worker: bounded local media decoding and observed object tracks."""
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlsplit

from tracking_core import TrackAssembler
from tracking_model import MODEL_NAME, MODEL_SHA256, MODEL_VERSION, NanoDetDetector


class TrackingFailure(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message


def run_command(arguments, timeout):
    try:
        return subprocess.run(arguments, check=True, capture_output=True, timeout=timeout)
    except FileNotFoundError as exc:
        raise TrackingFailure("TOOLS_UNAVAILABLE", "추적 서버의 영상 처리 도구가 준비되지 않았습니다.") from exc
    except subprocess.TimeoutExpired as exc:
        raise TrackingFailure("TIMEOUT", "영상 처리 시간이 초과됐습니다. 더 짧은 구간으로 다시 시도해 주세요.") from exc
    except subprocess.CalledProcessError as exc:
        raise TrackingFailure("INVALID_VIDEO", "읽을 수 있는 MP4, MOV 또는 WebM 영상 파일을 선택해 주세요.") from exc


def trusted_loopback_source(source):
    value = urlsplit(str(source))
    if value.scheme != 'http' or value.hostname != '127.0.0.1' or value.username or value.password or value.query or value.fragment or not value.port or not value.path or value.path == '/':
        raise TrackingFailure('INVALID_SOURCE', '서버에 저장한 원본만 분석할 수 있습니다.')
    return str(source)


def probe_source(source, max_duration=3600, trusted_http=False):
    if trusted_http:
        source = trusted_loopback_source(source)
    protocol = 'http,tcp' if trusted_http else 'file,pipe'
    source_options = ['-f', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0'] if trusted_http else []
    result = run_command([os.getenv("FFPROBE_BINARY", "ffprobe"), "-v", "error", "-max_alloc", "67108864", "-protocol_whitelist", protocol,
                          "-format_whitelist", "mov,matroska,webm", "-select_streams", "v:0", "-show_streams", "-show_entries",
                          "format=duration,start_time:stream=width,height,duration,start_time,sample_aspect_ratio:stream_tags=rotate",
                          "-of", "json", *source_options, str(source)], 15)
    try:
        metadata = json.loads(result.stdout)
        stream = metadata["streams"][0]
        duration = float(metadata.get("format", {}).get("duration") or stream["duration"])
        if trusted_http:
            # Compare presentation origins, not codec DTS/B-frame offsets. If
            # all streams start at the same nonzero/negative origin it remains
            # a normal zero-based displayed timeline after demuxer rebasing.
            container_start = metadata.get("format", {}).get("start_time")
            container_start = float(container_start) if container_start not in (None, '', 'N/A') else 0.
            video_start = stream.get("start_time")
            video_start = float(video_start) if video_start not in (None, '', 'N/A') else container_start
            if not math.isfinite(container_start) or not math.isfinite(video_start):
                raise ValueError("Invalid presentation origin")
            if video_start - container_start > .25 + 1e-6:
                raise TrackingFailure('UNSUPPORTED_TIMELINE', '원본 시작 구간에 영상 프레임이 없습니다. 앞부분을 임의로 채우지 않고 추적할 수 있는 영상을 선택해 주세요.')
        width, height = int(stream["width"]), int(stream["height"])
        if not math.isfinite(duration) or not 0 < duration <= max_duration or not 0 < width <= 16384 or not 0 < height <= 16384:
            raise ValueError("Invalid media dimensions")
        # Bound allocations before FFmpeg decodes the full-resolution frame.
        # 4K/UHD fit; an inexpensive highly-compressed 8K upload must not exhaust
        # the 2 GiB analysis service before the downscale filter can execute.
        if width * height > 16777216:
            raise ValueError("Media pixel count exceeds the decoder limit")
        sar = stream.get("sample_aspect_ratio", "1:1").split(":")
        ratio = float(sar[0]) / float(sar[1]) if len(sar) == 2 and float(sar[0]) and float(sar[1]) else 1
        if not math.isfinite(ratio) or not 0.1 <= ratio <= 10:
            raise ValueError("Invalid aspect ratio")
        width = max(1, round(width * ratio))
        rotation = float(stream.get("tags", {}).get("rotate", 0))
        for item in stream.get("side_data_list", []):
            if "rotation" in item:
                rotation = float(item["rotation"])
        if not math.isfinite(rotation) or abs(rotation % 90) > 0.01:
            raise ValueError("Unsupported rotation")
        if round(rotation) % 180:
            width, height = height, width
        return {"duration": duration, "width": width, "height": height}
    except (ValueError, TypeError, IndexError, KeyError, ZeroDivisionError) as exc:
        raise TrackingFailure("INVALID_VIDEO", f"길이를 확인할 수 있는 {max_duration // 3600}시간 이하·최대 16메가픽셀(4K 포함) 영상이 필요합니다.") from exc


def analyze_file(source, start, end, sample_fps):
    import cv2
    import numpy as np
    source = Path(source)
    metadata = probe_source(source)
    if not (all(math.isfinite(value) for value in (start, end, sample_fps)) and 0 <= start < end <= metadata["duration"]
            and end - start <= 120 and 0.5 <= sample_fps <= 4 and math.ceil((end - start) * sample_fps) <= 240):
        raise TrackingFailure("INVALID_RANGE", "원본 안의 최대 120초·240프레임 범위를 선택해 주세요.")
    detector = NanoDetDetector()
    frame_directory = source.parent / "frames"
    frame_directory.mkdir()
    # FFmpeg autorotates display metadata. Correct non-square pixels before
    # downscaling. Resampled output PTS starts at zero and maps to start+i/fps.
    filters = f"fps=fps={sample_fps}:start_time=0:round=near,scale=trunc(iw*sar):ih,setsar=1,scale=1280:1280:force_original_aspect_ratio=decrease"
    run_command([os.getenv("FFMPEG_BINARY", "ffmpeg"), "-nostdin", "-v", "error", "-max_alloc", "67108864", "-threads", "1",
                 "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm",
                 "-ss", str(start), "-i", str(source), "-t", str(end - start), "-map", "0:v:0", "-an", "-sn", "-dn",
                 "-vf", filters, "-frames:v", "240", "-threads", "1", str(frame_directory / "%05d.png")], 35)
    frames = sorted(frame_directory.glob("*.png"))
    if not frames:
        raise TrackingFailure("INVALID_VIDEO", "선택한 구간에서 영상 화면을 읽을 수 없습니다.")
    tracker = TrackAssembler(start, end, sample_fps)
    previous_histogram = None
    for index, frame_file in enumerate(frames):
        time = start + index / sample_fps
        if time >= end:
            break
        frame = cv2.imdecode(np.frombuffer(frame_file.read_bytes(), dtype=np.uint8), cv2.IMREAD_COLOR)
        if frame is None:
            raise TrackingFailure("INVALID_VIDEO", "분석 중 화면을 읽지 못했습니다.")
        hsv = cv2.cvtColor(cv2.resize(frame, (96, 54)), cv2.COLOR_BGR2HSV)
        histogram = cv2.calcHist([hsv], [0, 1, 2], None, [8, 4, 4], [0, 180, 0, 256, 0, 256]).ravel()
        histogram = (histogram / max(float(histogram.sum()), 1)).astype(np.float32)
        cut = previous_histogram is not None and cv2.compareHist(previous_histogram, histogram, cv2.HISTCMP_BHATTACHARYYA) > 0.55
        tracker.update(time, detector.detect(frame), scene_cut=cut)
        previous_histogram = histogram
    result = tracker.finish()
    if not result["tracks"]:
        result["warnings"].append({"code": "NO_DETECTIONS", "message": "지원하는 인물·물체를 찾지 못했습니다. 다른 구간을 선택하거나 수동 구도를 사용해 주세요."})
    result["warnings"].append({"code": "SAMPLED_TRACKING", "message": f"초당 {sample_fps:g}개 화면을 관측했습니다. 가림·빠른 움직임·장면 변화에서는 번호가 끊길 수 있습니다."})
    result["warnings"].append({"code": "SUPPORTED_CLASSES", "message": "COCO 80개 클래스의 인물·물체 검출을 지원합니다. 지원 밖의 대상이나 작은 물체는 놓칠 수 있습니다."})
    return {"schemaVersion": 1, "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(), "source": metadata,
            "range": {"start": start, "end": end, "sampleFps": sample_fps},
            "model": {"name": MODEL_NAME, "version": MODEL_VERSION, "sha256": MODEL_SHA256}, **result}


if __name__ == "__main__":
    input_path, output_path = Path(sys.argv[1]), Path(sys.argv[2])
    try:
        arguments = json.loads(input_path.read_text(encoding="utf-8"))
        result = analyze_file(arguments["source"], arguments["start"], arguments["end"], arguments["sampleFps"])
        encoded = json.dumps(result, ensure_ascii=False, allow_nan=False)
        if len(encoded.encode("utf-8")) > 1536 * 1024:
            raise TrackingFailure("RESULT_LIMIT", "추적 결과가 너무 큽니다. 더 짧은 구간을 선택해 주세요.")
        output_path.write_text(encoded, encoding="utf-8")
    except TrackingFailure as exc:
        output_path.write_text(json.dumps({"error": exc.code, "message": exc.message}, ensure_ascii=False), encoding="utf-8")
        sys.exit(2)
    except (ImportError, RuntimeError) as exc:
        code = "MODEL_UNAVAILABLE" if str(exc) == "TRACKING_MODEL_UNAVAILABLE" else "ENGINE_UNAVAILABLE"
        output_path.write_text(json.dumps({"error": code, "message": "추적 모델 또는 CPU 분석 환경이 준비되지 않았습니다."}, ensure_ascii=False), encoding="utf-8")
        sys.exit(2)
    except Exception:
        output_path.write_text(json.dumps({"error": "ENGINE_ERROR", "message": "추적 분석을 완료하지 못했습니다."}, ensure_ascii=False), encoding="utf-8")
        sys.exit(2)
