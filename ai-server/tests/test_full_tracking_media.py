import json
import io
import hashlib
import os
import shutil
import subprocess
from types import SimpleNamespace
import uuid

import pytest

from full_tracking_engine_media import iter_frames, probe_full_source, scaled_dimensions
import full_tracking_engine_media as media
import tracking_worker
from full_tracking_store import LocalStore, source_key


@pytest.mark.parametrize('source', [
    'https://storage.googleapis.com/untrusted-user-choice',
    'http://example.com/source', 'http://169.254.169.254/source',
    'http://127.0.0.1:8000/', 'http://user:secret@127.0.0.1:8000/source',
    'http://127.0.0.1:8000/source?redirect=http://example.com', 'file:///etc/passwd',
])
def test_full_media_rejects_arbitrary_or_credential_urls_before_native_work(source, monkeypatch):
    monkeypatch.setattr(tracking_worker, 'run_command', lambda *_: pytest.fail('Untrusted URL reached native tools'))
    with pytest.raises(tracking_worker.TrackingFailure, match='서버에 저장한 원본'):
        probe_full_source(source)


@pytest.mark.parametrize('duration,accepted', [(36000, True), (36000.001, False)])
def test_full_probe_ten_hour_boundary_and_embedded_reference_protection(monkeypatch, duration, accepted):
    def probe(arguments, timeout):
        assert arguments[arguments.index('-protocol_whitelist') + 1] == 'http,tcp'
        assert arguments[arguments.index('-enable_drefs') + 1] == '0'
        assert arguments[arguments.index('-use_absolute_path') + 1] == '0'
        assert arguments[arguments.index('-f') + 1] == 'mov'
        payload = {'format': {'duration': str(duration)}, 'streams': [{'width': 1920, 'height': 1080, 'sample_aspect_ratio': '1:1'}]}
        return SimpleNamespace(stdout=json.dumps(payload).encode())
    monkeypatch.setattr(tracking_worker, 'run_command', probe)
    if accepted:
        assert probe_full_source('http://127.0.0.1:8000/server-capability')['duration'] == duration
    else:
        with pytest.raises(tracking_worker.TrackingFailure, match='10시간'):
            probe_full_source('http://127.0.0.1:8000/server-capability')


def test_scaled_frame_memory_is_bounded_and_orientation_is_preserved():
    assert scaled_dimensions({'width': 3840, 'height': 2160}) == (960, 540)
    assert scaled_dimensions({'width': 2160, 'height': 3840}) == (540, 960)
    assert scaled_dimensions({'width': 320, 'height': 240}) == (320, 240)


@pytest.mark.parametrize('duration,decoded,accepted', [(4, 2, False), (4, 0, False), (.2, 1, True)])
def test_zero_exit_cannot_claim_undecoded_time_as_complete(monkeypatch, duration, decoded, accepted):
    class Process:
        stdout = io.BytesIO(bytes(2 * 2 * 3 * decoded))
        def poll(self):
            return 0
        def wait(self, timeout=None):
            return 0
    monkeypatch.setattr(media.subprocess, 'Popen', lambda *args, **kwargs: Process())
    iterator = iter_frames('http://127.0.0.1:8000/opaque-capability', 0, duration,
                           {'width': 2, 'height': 2}, 2, lambda: None)
    if accepted:
        assert [stamp for stamp, _ in iterator] == [0]
    else:
        with pytest.raises(tracking_worker.TrackingFailure, match='프레임이 부족'):
            list(iterator)


@pytest.mark.parametrize('video_start,container_start,accepted', [
    (2., 0., False), (.251, 0., False), (2., 2., True), (.03, 0., True), (-.08, -.08, True),
])
def test_late_video_start_is_rejected_before_frame_padding(monkeypatch, video_start, container_start, accepted):
    payload = {'format': {'duration': '4', 'start_time': str(container_start)},
               'streams': [{'width': 64, 'height': 64, 'start_time': str(video_start), 'sample_aspect_ratio': '1:1'}]}
    monkeypatch.setattr(tracking_worker, 'run_command', lambda *_: SimpleNamespace(stdout=json.dumps(payload).encode()))
    if accepted:
        assert probe_full_source('http://127.0.0.1:8000/source')['duration'] == 4
    else:
        with pytest.raises(tracking_worker.TrackingFailure) as caught:
            probe_full_source('http://127.0.0.1:8000/source')
        assert caught.value.code == 'UNSUPPORTED_TIMELINE'


def test_real_offset_mp4_is_rejected_before_source_becomes_ready(tmp_path):
    ffmpeg = os.getenv('FFMPEG_BINARY') or shutil.which('ffmpeg')
    ffprobe = os.getenv('FFPROBE_BINARY') or shutil.which('ffprobe')
    if not ffmpeg or not ffprobe:
        pytest.skip('Native media regression requires FFmpeg and FFprobe')
    media_path = tmp_path / 'offset.mp4'
    subprocess.run([ffmpeg, '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=64x64:r=25:d=2',
                    '-f', 'lavfi', '-i', 'sine=frequency=400:duration=4', '-filter_complex', '[0:v]setpts=PTS+2/TB[v]',
                    '-map', '[v]', '-map', '1:a', '-fps_mode:v', 'passthrough', '-c:v', 'libx264', '-preset', 'ultrafast',
                    '-pix_fmt', 'yuv420p', '-c:a', 'aac', str(media_path)], check=True, timeout=30,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    native = json.loads(subprocess.check_output([ffprobe, '-v', 'error', '-show_entries',
                                                'format=start_time:stream=codec_type,start_time', '-of', 'json', str(media_path)]))
    video = next(item for item in native['streams'] if item['codec_type'] == 'video')
    assert float(video['start_time']) - float(native['format']['start_time']) > .25
    store = LocalStore(tmp_path / 'objects')
    owner, project, upload = (str(uuid.uuid4()) for _ in range(3))
    name = source_key(owner, project, upload)
    target = store.path(name)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(media_path, target)
    source = {'uploadId': upload, 'filename': 'offset.mp4', 'objectKey': name,
              'generation': str(target.stat().st_mtime_ns), 'size': target.stat().st_size,
              'checksum': hashlib.sha256(target.read_bytes()).hexdigest()}
    with store.source_url(source) as (url, _):
        with pytest.raises(tracking_worker.TrackingFailure) as caught:
            probe_full_source(url)
    assert caught.value.code == 'UNSUPPORTED_TIMELINE'


def test_fractional_window_uses_sample_count_instead_of_muxer_duration(monkeypatch):
    class Process:
        stdout = io.BytesIO(bytes(2 * 2 * 3 * 3))
        def poll(self):
            return 0
        def wait(self, timeout=None):
            return 0
    def spawn(arguments, **_kwargs):
        assert '-t' not in arguments, 'Output duration is rounded to the coarse rawvideo time base and can discard the last valid sample'
        assert arguments[arguments.index('-frames:v') + 1] == '3'
        return Process()
    monkeypatch.setattr(media.subprocess, 'Popen', spawn)
    assert [stamp for stamp, _ in iter_frames('http://127.0.0.1:8000/source', 0, 1.12,
                                              {'width': 2, 'height': 2}, 2, lambda: None)] == [0, .5, 1.]


def test_real_fractional_b_frame_video_preserves_last_actual_sample(tmp_path):
    ffmpeg = os.getenv('FFMPEG_BINARY') or shutil.which('ffmpeg')
    ffprobe = os.getenv('FFPROBE_BINARY') or shutil.which('ffprobe')
    if not ffmpeg or not ffprobe:
        pytest.skip('Native media regression requires FFmpeg and FFprobe')
    media_path = tmp_path / 'fractional-b-frames.mp4'
    subprocess.run([ffmpeg, '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=64x64:r=25:d=6.12',
                    '-c:v', 'libx264', '-bf', '2', '-g', '25', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
                    str(media_path)], check=True, timeout=30, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    store = LocalStore(tmp_path / 'objects')
    owner, project, upload = (str(uuid.uuid4()) for _ in range(3))
    name = source_key(owner, project, upload)
    target = store.path(name)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(media_path, target)
    source = {'uploadId': upload, 'filename': 'fractional-b-frames.mp4', 'objectKey': name,
              'generation': str(target.stat().st_mtime_ns), 'size': target.stat().st_size,
              'checksum': hashlib.sha256(target.read_bytes()).hexdigest()}
    with store.source_url(source) as (url, _):
        source.update(probe_full_source(url))
        assert 6.1 < source['duration'] < 6.2
        stamps = [stamp for stamp, _ in iter_frames(url, 0, source['duration'], source, 2, lambda: None)]
    assert stamps == [index / 2 for index in range(13)]
