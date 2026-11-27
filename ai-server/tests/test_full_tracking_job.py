import copy
from contextlib import contextmanager
import hashlib
import json
import time
import uuid

import numpy as np
import pytest

import full_tracking_job as jobs
from full_tracking_store import Conflict


class MemoryStore:
    def __init__(self):
        self.objects = {}
        self.revision = 0

    def read_json(self, key):
        value = self.objects.get(key)
        return (copy.deepcopy(value[0]), value[1]) if value else (None, None)

    def write_json(self, key, value, expected=None):
        previous = self.objects.get(key)
        version = previous[1] if previous else None
        if expected is not None and (expected == '0' and previous is not None or expected != '0' and version != expected):
            raise Conflict('Changed')
        self.revision += 1
        self.objects[key] = (copy.deepcopy(value), str(self.revision))
        return str(self.revision)

    @contextmanager
    def source_url(self, source):
        yield 'http://127.0.0.1:18000/server-generated-test-capability', dict(source)

    def source_sha256(self, source, heartbeat):
        heartbeat()
        return hashlib.sha256(b'unit-test-only-source').hexdigest()


def source(duration=130):
    owner, project, upload = (str(uuid.uuid4()) for _ in range(3))
    return {'uploadId': upload, 'filename': 'source.mp4', 'size': 1000, 'duration': duration,
            'width': 640, 'height': 360, 'objectKey': f'originals/{owner}/{project}/{upload}',
            'generation': '123456', 'checksum': 'unit-test-only-checksum'}


@pytest.fixture
def store():
    return MemoryStore()


@pytest.fixture
def engine(monkeypatch):
    class Detector:
        def detect(self, frame):
            stamp = float(frame[0, 0, 0])
            return [{'classId': 0, 'label': 'person', 'confidence': .9,
                     'bbox': [.1 + stamp / 10000, .1, .2, .4], 'appearance': [1., 0.]}]
    def frames(url, start, end, metadata, sample_fps, heartbeat):
        for stamp in np.arange(start, end, 1 / sample_fps):
            heartbeat()
            frame = np.zeros((8, 8, 3), dtype=np.float32)
            frame[0, 0, 0] = stamp
            yield float(stamp), frame
    monkeypatch.setattr(jobs, 'make_detector', Detector)
    monkeypatch.setattr(jobs, 'iter_frames', frames)
    monkeypatch.setattr(jobs, 'frame_histogram', lambda _: [1.] + [0.] * 127)


def test_full_job_commits_entire_duration_and_keeps_ids_across_windows(store, engine):
    identity = str(uuid.uuid4())
    created = jobs.create_job(store, identity, source())
    assert created['state'] == 'queued'
    assert created['totalChunks'] == 3
    result = jobs.run_job(store, identity)
    assert result['state'] == 'completed'
    assert result['processedSeconds'] == 130
    assert result['completedChunks'] == 3
    for stamp in [0, 60, 120, 129.9]:
        window = jobs.read_window(store, identity, stamp)
        assert [track['id'] for track in window['tracks']] == ['t1']
        assert all(window['range']['start'] <= item['time'] < window['range']['end']
                   for item in window['tracks'][0]['observations'])
    assert jobs.run_job(store, identity)['state'] == 'completed'
    assert len([key for key in store.objects if '/chunks/' in key]) == 3


def test_interruption_resumes_from_committed_checkpoint_without_repeating_previous_window(store, engine, monkeypatch):
    identity = str(uuid.uuid4())
    jobs.create_job(store, identity, source())
    original = jobs.iter_frames
    calls = []
    def fail_second(url, start, *args):
        calls.append(start)
        if start == 60:
            raise RuntimeError('Injected independent worker failure')
        yield from original(url, start, *args)
    monkeypatch.setattr(jobs, 'iter_frames', fail_second)
    failed = jobs.run_job(store, identity)
    assert failed['state'] == 'failed'
    assert failed['processedSeconds'] == 60
    assert calls == [0, 60]
    monkeypatch.setattr(jobs, 'iter_frames', original)
    jobs.resume_job(store, identity)
    completed = jobs.run_job(store, identity)
    assert completed['state'] == 'completed'
    assert jobs.read_window(store, identity, 61)['tracks'][0]['id'] == 't1'
    assert len([key for key in store.objects if '/chunks/' in key]) == 3


def test_cancel_is_acknowledged_after_generator_cleanup_and_can_resume(store, engine, monkeypatch):
    identity = str(uuid.uuid4())
    jobs.create_job(store, identity, source())
    original = jobs.iter_frames
    cleaned = []
    def cancelling(url, start, *args):
        try:
            for stamp, frame in original(url, start, *args):
                if stamp == 62:
                    jobs.cancel_job(store, identity)
                yield stamp, frame
        finally:
            cleaned.append(start)
    monkeypatch.setattr(jobs, 'iter_frames', cancelling)
    result = jobs.run_job(store, identity)
    assert result['state'] == 'cancelled'
    assert result['processedSeconds'] == 60
    assert cleaned[-1] == 60
    monkeypatch.setattr(jobs, 'iter_frames', original)
    jobs.resume_job(store, identity)
    assert jobs.run_job(store, identity)['state'] == 'completed'


def test_empty_detections_still_cover_every_window(store, engine, monkeypatch):
    monkeypatch.setattr(jobs, 'make_detector', lambda: type('Empty', (), {'detect': lambda self, frame: []})())
    identity = str(uuid.uuid4())
    jobs.create_job(store, identity, source(121))
    assert jobs.run_job(store, identity)['processedSeconds'] == 121
    assert jobs.read_window(store, identity, 120)['tracks'] == []
    assert any(item['code'] == 'NO_DETECTIONS' for item in jobs.read_window(store, identity, 0)['warnings'])


def test_global_lease_is_cas_fenced_and_duplicate_runner_cannot_commit(store):
    first = jobs.Lease(store, str(uuid.uuid4()))
    second = jobs.Lease(store, str(uuid.uuid4()))
    assert first.acquire()
    assert not second.acquire()
    row, version = store.read_json('locks/tracking.json')
    row['expiresAt'] = 0
    store.write_json('locks/tracking.json', row, expected=version)
    assert second.acquire()
    with pytest.raises(jobs.LeaseLost):
        first.heartbeat(force=True)
    first.release()
    assert store.read_json('locks/tracking.json')[0]['runId'] == second.run_id
    second.release()


@pytest.mark.parametrize('duration,accepted', [(36000, True), (36000.01, False), (0, False)])
def test_ten_hour_boundary(store, duration, accepted):
    if accepted:
        assert jobs.create_job(store, str(uuid.uuid4()), source(duration))['totalChunks'] == 600
    else:
        with pytest.raises(ValueError):
            jobs.create_job(store, str(uuid.uuid4()), source(duration))


def test_changed_source_and_model_checkpoint_cannot_mix_results(store, engine):
    identity = str(uuid.uuid4())
    original = source(60)
    jobs.create_job(store, identity, original)
    with pytest.raises(ValueError):
        jobs.create_job(store, identity, {**original, 'generation': '999'})
    jobs.run_job(store, identity)
    checkpoint, version = store.read_json(f'jobs/{identity}/checkpoint.json')
    checkpoint['model']['sha256'] = '0' * 64
    store.write_json(f'jobs/{identity}/checkpoint.json', checkpoint, expected=version)
    with pytest.raises(ValueError):
        jobs.read_window(store, identity, 0)


def test_dispatch_failure_is_durable_and_does_not_overwrite_running_work(store):
    identity = str(uuid.uuid4())
    jobs.create_job(store, identity, source())
    jobs.mark_dispatch_failed(store, identity, 'DISPATCH_FAILED', '작업을 시작하지 못했습니다.')
    assert jobs.job_status(store, identity)['state'] == 'failed'
    jobs.resume_job(store, identity)
    row, version = store.read_json(f'jobs/{identity}/state.json')
    row['state'] = 'running'
    store.write_json(f'jobs/{identity}/state.json', row, expected=version)
    jobs.mark_dispatch_failed(store, identity, 'DISPATCH_FAILED', '지연 응답')
    assert jobs.job_status(store, identity)['state'] == 'running'


def test_queued_cancellation_is_acknowledged_without_starting_media(store, engine):
    identity = str(uuid.uuid4())
    jobs.create_job(store, identity, source())
    assert jobs.cancel_job(store, identity)['state'] == 'cancelling'
    assert jobs.run_job(store, identity)['state'] == 'cancelled'
    assert not any('/chunks/' in key for key in store.objects)


def test_dispatcher_guard_interrupts_owned_job_and_releases_resource(store, engine):
    identity = str(uuid.uuid4())
    jobs.create_job(store, identity, source())
    def lost_queue_lease():
        raise jobs.JobInterrupted('Dispatch ownership changed')
    result = jobs.run_job(store, identity, external_guard=lost_queue_lease)
    assert result['state'] == 'interrupted'
    assert store.read_json('locks/tracking.json')[0]['runId'] is None
    assert not any('/chunks/' in key for key in store.objects)


def test_incomplete_video_never_commits_requested_but_undecoded_coverage(store, engine, monkeypatch):
    identity = str(uuid.uuid4())
    jobs.create_job(store, identity, source(4))
    original = jobs.iter_frames
    def truncated(url, start, *args):
        for stamp, frame in original(url, start, *args):
            if stamp >= 1:
                raise jobs.TrackingFailure('INCOMPLETE_VIDEO', '영상 프레임이 부족합니다.')
            yield stamp, frame
    monkeypatch.setattr(jobs, 'iter_frames', truncated)
    result = jobs.run_job(store, identity)
    assert result['state'] == 'failed'
    assert result['processedSeconds'] == result['completedChunks'] == 0
    assert result['error']['code'] == 'INCOMPLETE_VIDEO'
    assert jobs.read_window(store, identity, 0) is None


def test_ten_hour_simulation_covers_600_windows_with_bounded_tracking_checkpoint(engine, monkeypatch):
    class ObservedStore(MemoryStore):
        def __init__(self):
            super().__init__()
            self.max_active = self.max_history = self.max_tracker_bytes = 0
            self.window_count = self.observations = 0
            self.identities = set()

        def write_json(self, key, value, expected=None):
            version = super().write_json(key, value, expected)
            if key.endswith('/checkpoint.json'):
                active = value['tracker']['active']
                self.max_active = max(self.max_active, len(active))
                self.max_history = max(self.max_history, sum(len(item['track']['observations']) for item in active))
                self.max_tracker_bytes = max(self.max_tracker_bytes, len(json.dumps(value['tracker']).encode()))
            elif '/chunks/' in key:
                self.window_count += 1
                self.observations += sum(len(track['observations']) for track in value['tracks'])
                self.identities.update(track['id'] for track in value['tracks'])
            return version

    class TenHourDetector:
        def detect(self, frame):
            stamp = float(frame[0, 0, 0])
            return [{'classId': 0, 'label': 'person', 'confidence': .9,
                     'bbox': [.1 + stamp / 1_000_000, .1, .2, .4], 'appearance': [1., 0.]}]

    monkeypatch.setattr(jobs, 'make_detector', TenHourDetector)
    store = ObservedStore()
    identity = str(uuid.uuid4())
    jobs.create_job(store, identity, source(36000))
    started = time.perf_counter()
    completed = jobs.run_job(store, identity)
    assert completed['state'] == 'completed'
    assert completed['processedSeconds'] == completed['duration'] == 36000
    assert completed['completedChunks'] == completed['totalChunks'] == store.window_count == 600
    assert store.observations == 72000
    assert store.identities == {'t1'}
    assert store.max_active == 1
    assert store.max_history <= 2
    assert store.max_tracker_bytes < 4000
    checkpoint, _ = store.read_json(f'jobs/{identity}/checkpoint.json')
    assert [(entry['start'], entry['end']) for entry in checkpoint['manifest']] == [
        (index * 60, (index + 1) * 60) for index in range(600)]
    last = jobs.read_window(store, identity, 35999.5)
    assert last['range'] == {'start': 35940, 'end': 36000, 'sampleFps': 2}
    assert last['tracks'][0]['id'] == 't1'
    assert last['tracks'][0]['observations'][-1]['time'] == 35999.5
    print(json.dumps({'simulationDurationSeconds': 36000, 'windows': store.window_count,
                      'observations': store.observations, 'maxActiveTracks': store.max_active,
                      'maxCheckpointObservations': store.max_history,
                      'maxTrackerCheckpointBytes': store.max_tracker_bytes,
                      'executionSeconds': round(time.perf_counter() - started, 2)}))
