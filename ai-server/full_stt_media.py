"""Bounded audio windows in original video time, including stream offsets."""
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
import time
import wave

from full_tracking_engine_process import process_options, terminate_tree
from tracking_worker import TrackingFailure, trusted_loopback_source

SAMPLE_RATE = 16000


def wait_process(process, timeout, heartbeat):
    deadline = time.monotonic() + timeout
    try:
        while process.poll() is None:
            heartbeat()
            if time.monotonic() > deadline:
                raise TrackingFailure('STT_TIMEOUT', '전사 구간 처리 시간이 초과됐습니다. 저장된 지점부터 재개해 주세요.')
            time.sleep(.05)
        heartbeat()
        if process.wait(timeout=5):
            raise TrackingFailure('INVALID_AUDIO', '원본의 오디오 구간을 처리하지 못했습니다.')
    except BaseException:
        terminate_tree(process)
        raise


def _probe(url, selector, heartbeat):
    with tempfile.TemporaryFile() as output:
        command = [os.getenv('FFPROBE_BINARY', 'ffprobe'), '-v', 'error', '-protocol_whitelist', 'http,tcp',
                   '-f', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0', '-select_streams', selector,
                   '-show_entries', 'format=start_time:stream=codec_type,start_time,duration', '-of', 'json', url]
        try:
            process = subprocess.Popen(command, stdout=output, stderr=subprocess.DEVNULL, **process_options())
        except FileNotFoundError as error:
            raise TrackingFailure('TOOLS_UNAVAILABLE', '전사 서버의 FFprobe가 준비되지 않았습니다.') from error
        wait_process(process, 30, heartbeat)
        if output.tell() > 32768:
            raise TrackingFailure('INVALID_AUDIO', '오디오 정보를 확인하지 못했습니다.')
        output.seek(0)
        return json.loads(output.read())


def probe_audio(url, duration, heartbeat=lambda: None):
    trusted_loopback_source(url)
    audio = _probe(url, 'a:0', heartbeat)
    if not audio.get('streams'):
        raise TrackingFailure('NO_AUDIO', '원본에 오디오 트랙이 없어 한국어 전사를 생성할 수 없습니다.')
    video = _probe(url, 'v:0', heartbeat)
    try:
        origin = float(video['streams'][0]['start_time'])
        stream = audio['streams'][0]
        start = float(stream['start_time'])
        length = float(stream['duration'])
        if not all(math.isfinite(value) for value in (origin, start, length)) or not 0 < length <= 36001:
            raise ValueError('Unsupported audio duration')
        if start - origin > duration or start + length <= origin:
            raise ValueError('Audio does not intersect video timeline')
        return {'origin': origin, 'audioStart': start, 'audioEnd': start + length}
    except (KeyError, IndexError, TypeError, ValueError) as error:
        raise TrackingFailure('UNSUPPORTED_TIMELINE', '원본과 오디오의 시작 시각·길이를 확인할 수 없습니다.') from error


def extract_audio(url, metadata, start, end, target, heartbeat):
    """Return extraction origin; never decode more than 304 seconds of PCM."""
    trusted_loopback_source(url)
    if not 0 <= start < end <= 36000 or end - start > 304.001:
        raise ValueError('Unbounded audio extraction')
    target = Path(target)
    samples = math.ceil((end - start) * SAMPLE_RATE)
    origin = metadata['origin'] + start
    if metadata['audioStart'] >= metadata['origin'] + end or metadata['audioEnd'] <= origin:
        with wave.open(str(target), 'wb') as output:
            output.setparams((1, 2, SAMPLE_RATE, 0, 'NONE', 'not compressed'))
            remaining = samples
            while remaining:
                heartbeat()
                count = min(remaining, 32768)
                output.writeframesraw(bytes(count * 2))
                remaining -= count
        return start
    # copyts keeps absolute input PTS. Subtract the displayed video origin,
    # not the audio stream origin, before resampling/padding missing samples.
    filters = (f'atrim=start={origin}:end={metadata["origin"] + end},'
               f'asetpts=PTS-({origin})/TB,aresample={SAMPLE_RATE}:async=1:first_pts=0,'
               f'apad,atrim=end_sample={samples}')
    command = [os.getenv('FFMPEG_BINARY', 'ffmpeg'), '-nostdin', '-y', '-v', 'error', '-max_alloc', '67108864',
               '-threads', '1', '-protocol_whitelist', 'http,tcp', '-f', 'mov', '-enable_drefs', '0',
               '-use_absolute_path', '0', '-copyts', '-ss', str(max(0, start - 2)), '-i', url,
               '-map', '0:a:0', '-vn', '-sn', '-dn', '-af', filters, '-ac', '1', '-ar', str(SAMPLE_RATE),
               '-c:a', 'pcm_s16le', str(target)]
    try:
        process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **process_options())
    except FileNotFoundError as error:
        raise TrackingFailure('TOOLS_UNAVAILABLE', '전사 서버의 FFmpeg가 준비되지 않았습니다.') from error
    wait_process(process, 180, heartbeat)
    if target.stat().st_size > samples * 2 + 4096:
        raise TrackingFailure('INVALID_AUDIO', '오디오 구간이 크기 제한을 초과했습니다.')
    with wave.open(str(target), 'rb') as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getnframes()) != (1, 2, SAMPLE_RATE, samples):
            raise TrackingFailure('INCOMPLETE_AUDIO', '오디오 구간을 끝까지 읽지 못했습니다.')
    return start
