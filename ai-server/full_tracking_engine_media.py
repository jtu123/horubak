"""Bounded frame decoding from a server-owned, seekable loopback source."""
import math
import os
import queue
import subprocess
import threading
import time

from full_tracking_engine_process import process_options, terminate_tree
from tracking_worker import TrackingFailure, probe_source, trusted_loopback_source


def probe_full_source(url):
    return probe_source(url, max_duration=36000, trusted_http=True)


def scaled_dimensions(metadata):
    width, height = metadata['width'], metadata['height']
    factor = min(1., 960 / width, 960 / height)
    return max(1, round(width * factor)), max(1, round(height * factor))


def iter_frames(url, start, end, metadata, sample_fps, heartbeat):
    """Yield at most one frame per sample. Only two frames may queue in memory."""
    import numpy as np
    trusted_loopback_source(url)
    width, height = scaled_dimensions(metadata)
    count = math.ceil((end - start) * sample_fps)
    timeout = float(os.getenv('TRACKING_CHUNK_TIMEOUT_SECONDS', '180'))
    if not 5 <= timeout <= 600:
        raise TrackingFailure('CONFIG_INVALID', '추적 구간의 처리 제한 설정을 확인해 주세요.')
    command = [os.getenv('FFMPEG_BINARY', 'ffmpeg'), '-nostdin', '-v', 'error', '-max_alloc', '67108864', '-threads', '1',
               '-protocol_whitelist', 'http,tcp', '-f', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0',
               '-ss', str(start), '-i', url, '-map', '0:v:0', '-an', '-sn', '-dn',
               '-vf', f'fps=fps={sample_fps}:start_time=0:round=near:eof_action=pass,scale={width}:{height},setsar=1',
               '-frames:v', str(count), '-pix_fmt', 'bgr24', '-threads', '1', '-f', 'rawvideo', 'pipe:1']
    # The sample-count cap is the range boundary. A second output -t boundary
    # is rounded to rawvideo's coarse 1/fps time base and discards valid final
    # samples (e.g. timestamp 6.0 in a healthy 6.12-second B-frame source).
    try:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, **process_options())
    except FileNotFoundError as exc:
        raise TrackingFailure('TOOLS_UNAVAILABLE', '추적 서버의 FFmpeg가 준비되지 않았습니다.') from exc
    frames = queue.Queue(maxsize=2)
    stopped = threading.Event()

    def offer(value):
        while not stopped.is_set():
            try:
                frames.put(value, timeout=.2)
                return
            except queue.Full:
                pass

    def read():
        try:
            for _ in range(count):
                data = bytearray()
                while len(data) < width * height * 3 and not stopped.is_set():
                    block = process.stdout.read(width * height * 3 - len(data))
                    if not block:
                        break
                    data.extend(block)
                if not data:
                    break
                if len(data) != width * height * 3:
                    raise ValueError('Incomplete frame')
                offer(data)
        except (OSError, ValueError) as exc:
            offer(exc)
        finally:
            offer(None)

    reader = threading.Thread(target=read, name='tracking-frame-reader', daemon=True)
    reader.start()
    deadline = time.monotonic() + timeout
    index = 0
    try:
        while True:
            heartbeat()
            if time.monotonic() > deadline:
                raise TrackingFailure('TIMEOUT', '구간 추적 시간이 초과됐습니다. 저장된 지점부터 재개할 수 있습니다.')
            try:
                item = frames.get(timeout=.2)
            except queue.Empty:
                continue
            if item is None:
                break
            if isinstance(item, Exception):
                raise TrackingFailure('INVALID_VIDEO', '영상 화면을 끝까지 읽지 못했습니다.') from item
            stamp = start + index / sample_fps
            if stamp < end:
                yield stamp, np.frombuffer(item, np.uint8).reshape(height, width, 3)
            index += 1
        remaining = max(.1, deadline - time.monotonic())
        try:
            code = process.wait(timeout=remaining)
        except subprocess.TimeoutExpired as exc:
            raise TrackingFailure('TIMEOUT', '영상 추출 시간이 초과됐습니다.') from exc
        if code:
            raise TrackingFailure('INVALID_VIDEO', '영상 구간을 처리하지 못했습니다.')
        if index != count:
            raise TrackingFailure('INCOMPLETE_VIDEO', '원본 길이에 비해 영상 프레임이 부족합니다. 영상 트랙이 먼저 끝나거나 손상된 파일인지 확인해 주세요.')
    finally:
        stopped.set()
        if process.poll() is None:
            terminate_tree(process)
        reader.join(timeout=2)
        process.stdout.close()
