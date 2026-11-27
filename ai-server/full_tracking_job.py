"""Durable full-video tracking with bounded windows and resumable identities.

The HTTP service only dispatches this program. Object-store CAS leases fence
separate job executions; checkpoints are the sole commit record for results.
"""
import copy
from datetime import datetime, timezone
import hashlib
import json
import math
import os
import signal
import threading
import time
import uuid

from full_tracking_engine_media import iter_frames
from full_tracking_store import Conflict, checked_source
from tracking_core import TrackAssembler
from tracking_model import MODEL_NAME, MODEL_SHA256, MODEL_VERSION
from tracking_worker import TrackingFailure

SAMPLE_FPS = 2
CHUNK_SECONDS = 60
MODEL = {'name': MODEL_NAME, 'version': MODEL_VERSION, 'sha256': MODEL_SHA256}
PUBLIC_FIELDS = ('id', 'state', 'source', 'processedSeconds', 'duration', 'sampleFps', 'chunkSeconds',
                 'completedChunks', 'totalChunks', 'sourceSha256', 'error', 'createdAt', 'updatedAt')
TERMINAL = {'completed', 'failed', 'cancelled', 'interrupted'}


class LeaseLost(Exception):
    pass


class JobCancelled(Exception):
    pass


class JobInterrupted(Exception):
    pass


def now():
    return datetime.now(timezone.utc).isoformat()


def key(job_id, name):
    if str(uuid.UUID(job_id)) != job_id:
        raise ValueError('Invalid job identity')
    return f'jobs/{job_id}/{name}'


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def validate_source(source):
    checked_source(source)
    if not isinstance(source.get('filename'), str) or len(source['filename']) > 500 or not source['filename'].lower().endswith(('.mp4', '.mov')):
        raise ValueError('Invalid source filename')
    size, duration, width, height = (source.get(item) for item in ('size', 'duration', 'width', 'height'))
    if not isinstance(size, int) or isinstance(size, bool) or not 0 < size <= 4 * 1024 ** 3:
        raise ValueError('Source size exceeds 4 GiB')
    if not isinstance(duration, (int, float)) or isinstance(duration, bool) or not math.isfinite(duration) or not 0 < duration <= 36000:
        raise ValueError('Source duration exceeds 10 hours')
    if not all(isinstance(item, int) and not isinstance(item, bool) and 0 < item <= 16384 for item in (width, height)) or width * height > 16777216:
        raise ValueError('Source resolution exceeds its decoder budget')
    if not isinstance(source.get('checksum'), str) or not 1 <= len(source['checksum']) <= 256:
        raise ValueError('Missing source checksum')


def create_job(store, job_id, source):
    validate_source(source)
    plan_key = key(job_id, 'plan.json')
    created = now()
    plan = {'id': job_id, 'source': copy.deepcopy(source), 'sampleFps': SAMPLE_FPS,
            'chunkSeconds': CHUNK_SECONDS, 'model': MODEL, 'createdAt': created}
    try:
        store.write_json(plan_key, plan, expected='0')
    except Conflict:
        existing, _ = store.read_json(plan_key)
        if not existing or existing['source'] != source or existing['model'] != MODEL:
            raise ValueError('Job identity belongs to another source or analysis configuration')
        plan = existing
    state = {'id': job_id, 'state': 'queued', 'source': copy.deepcopy(source), 'processedSeconds': 0,
             'duration': source['duration'], 'sampleFps': SAMPLE_FPS, 'chunkSeconds': CHUNK_SECONDS,
             'completedChunks': 0, 'totalChunks': math.ceil(source['duration'] / CHUNK_SECONDS),
             'sourceSha256': None, 'error': None, 'createdAt': plan['createdAt'], 'updatedAt': plan['createdAt']}
    try:
        store.write_json(key(job_id, 'state.json'), state, expected='0')
    except Conflict:
        pass
    return job_status(store, job_id)


def plan_for(store, job_id):
    plan, _ = store.read_json(key(job_id, 'plan.json'))
    if not plan or plan.get('id') != job_id:
        raise ValueError('Tracking job not found')
    validate_source(plan['source'])
    if plan.get('model') != MODEL or plan.get('sampleFps') != SAMPLE_FPS or plan.get('chunkSeconds') != CHUNK_SECONDS:
        raise ValueError('Tracking configuration changed; create a new analysis')
    return plan


def checked_checkpoint(plan, checkpoint):
    if checkpoint is None:
        return None
    if checkpoint.get('version') != 1 or checkpoint.get('sourceIdentity') != digest(plan['source']) or checkpoint.get('model') != plan['model']:
        raise ValueError('Checkpoint source or model does not match the analysis')
    manifest = checkpoint.get('manifest')
    if not isinstance(manifest, list) or len(manifest) > math.ceil(plan['source']['duration'] / CHUNK_SECONDS):
        raise ValueError('Invalid tracking manifest')
    for index, entry in enumerate(manifest):
        expected_start = index * CHUNK_SECONDS
        expected_end = min(plan['source']['duration'], expected_start + CHUNK_SECONDS)
        if entry.get('index') != index or entry.get('start') != expected_start or entry.get('end') != expected_end:
            raise ValueError('Tracking coverage has a gap or duplicate window')
        expected_key = key(plan['id'], f'chunks/{index}-{entry.get("sha256")}.json')
        if len(entry.get('sha256', '')) != 64 or entry.get('key') != expected_key:
            raise ValueError('Invalid result object identity')
    sha = checkpoint.get('sourceSha256')
    if sha is not None and (not isinstance(sha, str) or len(sha) != 64 or any(char not in '0123456789abcdef' for char in sha)):
        raise ValueError('Invalid source hash')
    return checkpoint


def job_status(store, job_id):
    plan = plan_for(store, job_id)
    state, _ = store.read_json(key(job_id, 'state.json'))
    if not state:
        raise ValueError('Tracking state not found')
    result = {field: copy.deepcopy(state[field]) for field in PUBLIC_FIELDS}
    checkpoint, _ = store.read_json(key(job_id, 'checkpoint.json'))
    checked_checkpoint(plan, checkpoint)
    if checkpoint:
        manifest = checkpoint['manifest']
        result.update(completedChunks=len(manifest), processedSeconds=manifest[-1]['end'] if manifest else 0,
                      sourceSha256=checkpoint['sourceSha256'])
    if result['state'] == 'completed' and result['processedSeconds'] != result['duration']:
        raise ValueError('Completed analysis does not cover the entire source')
    return result


def update_state(store, job_id, changes, run_id=None, allowed=None):
    for _ in range(8):
        state, version = store.read_json(key(job_id, 'state.json'))
        if not state:
            raise ValueError('Tracking state not found')
        if run_id is not None and state.get('_runId') != run_id:
            raise LeaseLost('Tracking execution was superseded')
        if allowed is not None and state['state'] not in allowed:
            return False
        state.update(changes, updatedAt=now())
        try:
            store.write_json(key(job_id, 'state.json'), state, expected=version)
            return True
        except Conflict:
            continue
    raise Conflict('Tracking state was modified concurrently')


def mark_dispatch_failed(store, job_id, code='DISPATCH_FAILED', message='분석 작업을 시작하지 못했습니다.'):
    update_state(store, job_id, {'state': 'failed', 'error': {'code': code, 'message': message}}, allowed={'queued'})
    return job_status(store, job_id)


def mark_interrupted(store, job_id, message='분석 실행이 중단됐습니다. 저장된 지점부터 재개할 수 있습니다.'):
    update_state(store, job_id, {'state': 'interrupted', 'error': {'code': 'EXECUTION_INTERRUPTED', 'message': message}},
                 allowed={'queued', 'running', 'cancelling'})
    return job_status(store, job_id)


def cancel_job(store, job_id):
    current = job_status(store, job_id)
    if current['state'] in TERMINAL:
        return current
    store.write_json(key(job_id, 'command.json'), {'cancelRequested': True, 'requestedAt': now()})
    update_state(store, job_id, {'state': 'cancelling'}, allowed={'queued', 'running', 'cancelling'})
    return job_status(store, job_id)


def resume_job(store, job_id):
    current = job_status(store, job_id)
    if current['state'] == 'completed':
        return current
    if current['state'] not in {'failed', 'interrupted', 'cancelled'}:
        raise ValueError('Only a stopped analysis can be resumed')
    store.write_json(key(job_id, 'command.json'), {'cancelRequested': False, 'requestedAt': now()})
    update_state(store, job_id, {'state': 'queued', 'error': None, '_runId': None}, allowed={'failed', 'interrupted', 'cancelled'})
    return job_status(store, job_id)


def read_window(store, job_id, start):
    plan = plan_for(store, job_id)
    duration = plan['source']['duration']
    if not isinstance(start, (int, float)) or not math.isfinite(start) or not 0 <= start <= duration:
        raise ValueError('Window is outside the source')
    checkpoint, _ = store.read_json(key(job_id, 'checkpoint.json'))
    checked_checkpoint(plan, checkpoint)
    index = min(math.floor(start / CHUNK_SECONDS), math.ceil(duration / CHUNK_SECONDS) - 1)
    if checkpoint is None or index >= len(checkpoint['manifest']):
        return None
    entry = checkpoint['manifest'][index]
    result, _ = store.read_json(entry['key'])
    if not result or digest(result) != entry['sha256'] or result.get('sourceSha256') != checkpoint['sourceSha256']:
        raise ValueError('Tracking result integrity check failed')
    return result


class Lease:
    TTL = 45
    def __init__(self, store, job_id):
        self.store, self.job_id = store, job_id
        self.run_id = str(uuid.uuid4())
        self.last_beat = 0

    def acquire(self):
        lease, version = self.store.read_json('locks/tracking.json')
        current = time.time()
        if lease and lease.get('expiresAt', 0) > current:
            return False
        try:
            self.store.write_json('locks/tracking.json', {'jobId': self.job_id, 'runId': self.run_id, 'expiresAt': current + self.TTL},
                                  expected=version or '0')
        except Conflict:
            return False
        self.last_beat = current
        return True

    def heartbeat(self, force=False):
        current = time.time()
        if not force and current - self.last_beat < 5:
            return
        lease, version = self.store.read_json('locks/tracking.json')
        if not lease or lease.get('runId') != self.run_id or lease.get('expiresAt', 0) <= current:
            raise LeaseLost('Tracking execution no longer owns its lease')
        lease['expiresAt'] = current + self.TTL
        try:
            self.store.write_json('locks/tracking.json', lease, expected=version)
        except Conflict as exc:
            raise LeaseLost('Tracking lease was superseded') from exc
        self.last_beat = current

    def release(self):
        lease, version = self.store.read_json('locks/tracking.json')
        if lease and lease.get('runId') == self.run_id:
            try:
                self.store.write_json('locks/tracking.json', {'jobId': None, 'runId': None, 'expiresAt': 0}, expected=version)
            except Conflict:
                pass


def make_detector():
    from tracking_model import NanoDetDetector
    return NanoDetDetector()


def frame_histogram(frame):
    import cv2
    import numpy as np
    hsv = cv2.cvtColor(cv2.resize(frame, (96, 54)), cv2.COLOR_BGR2HSV)
    values = cv2.calcHist([hsv], [0, 1, 2], None, [8, 4, 4], [0, 180, 0, 256, 0, 256]).ravel()
    return (values / max(float(values.sum()), 1)).astype(np.float32).tolist()


def scene_cut(previous, current):
    if previous is None:
        return False
    coefficient = min(1., sum(math.sqrt(max(0., left * right)) for left, right in zip(previous, current)))
    return math.sqrt(max(0., 1 - coefficient)) > .55


def initial_checkpoint(plan, run_id):
    tracker = TrackAssembler(0, plan['source']['duration'], SAMPLE_FPS, maximum_tracks=None)
    return {'version': 1, 'sourceIdentity': digest(plan['source']), 'model': MODEL, 'sourceSha256': None,
            'manifest': [], 'tracker': tracker.checkpoint(), 'histogram': None, 'runId': run_id}


def run_job(store, job_id, external_guard=None):
    plan = plan_for(store, job_id)
    current = job_status(store, job_id)
    if current['state'] in {'completed', 'cancelled'}:
        return current
    lease = Lease(store, job_id)
    last_check = 0
    last_status = 0
    old_handler = None
    owns = False
    def interrupted(_number, _frame):
        raise JobInterrupted('The job process is stopping')
    if threading.current_thread() is threading.main_thread():
        old_handler = signal.signal(signal.SIGTERM, interrupted)

    def command_check(force=False):
        nonlocal last_check
        stamp = time.monotonic()
        if force or stamp - last_check >= .5:
            if external_guard is not None:
                external_guard()
            command, _ = store.read_json(key(job_id, 'command.json'))
            last_check = stamp
            if command and command.get('cancelRequested'):
                raise JobCancelled()

    def heartbeat():
        nonlocal last_status
        command_check()
        lease.heartbeat()
        stamp = time.monotonic()
        if stamp - last_status >= 10:
            update_state(store, job_id, {'_heartbeat': time.time()}, run_id=lease.run_id)
            last_status = stamp

    try:
        deadline = time.monotonic() + 86400
        while not lease.acquire():
            command_check(force=True)
            active, _ = store.read_json('locks/tracking.json')
            if active and active.get('jobId') == job_id and active.get('expiresAt', 0) > time.time():
                return job_status(store, job_id)  # An idempotent duplicate execution.
            if time.monotonic() > deadline:
                raise TrackingFailure('ANALYSIS_BUSY', '다른 전체 영상 분석이 실행 중입니다. 다시 시도해 주세요.')
            time.sleep(1)
        owns = True
        update_state(store, job_id, {'state': 'running', 'error': None, '_runId': lease.run_id, '_heartbeat': time.time()})
        command_check(force=True)
        checkpoint, checkpoint_version = store.read_json(key(job_id, 'checkpoint.json'))
        checked_checkpoint(plan, checkpoint)
        checkpoint = checkpoint or initial_checkpoint(plan, lease.run_id)
        checkpoint['runId'] = lease.run_id
        # Re-fence the checkpoint before reading frames. A previous worker's CAS
        # commit can no longer publish into this execution's manifest.
        checkpoint_version = store.write_json(key(job_id, 'checkpoint.json'), checkpoint, expected=checkpoint_version or '0')
        detector = make_detector()
        if checkpoint['sourceSha256'] is None:
            checkpoint['sourceSha256'] = store.source_sha256(plan['source'], heartbeat)
            checkpoint_version = store.write_json(key(job_id, 'checkpoint.json'), checkpoint, expected=checkpoint_version)
        tracker = TrackAssembler.from_checkpoint(checkpoint['tracker'])
        previous_histogram = checkpoint['histogram']
        source = plan['source']
        with store.source_url(source) as (url, _metadata):
            for index in range(len(checkpoint['manifest']), current['totalChunks']):
                heartbeat()
                start, end = index * CHUNK_SECONDS, min(source['duration'], (index + 1) * CHUNK_SECONDS)
                frames = iter_frames(url, start, end, source, SAMPLE_FPS, heartbeat)
                try:
                    for stamp, frame in frames:
                        heartbeat()
                        histogram = frame_histogram(frame)
                        tracker.update(stamp, detector.detect(frame), scene_cut=scene_cut(previous_histogram, histogram))
                        previous_histogram = histogram
                finally:
                    close = getattr(frames, 'close', None)
                    if close:
                        close()  # Reap FFmpeg before reporting cancel/failure.
                if end == source['duration']:
                    tracker.finish()
                window = tracker.window_result(start, end)
                if not window['tracks']:
                    window['warnings'].append({'code': 'NO_DETECTIONS', 'message': '이 구간에서 지원하는 피사체를 찾지 못했습니다.'})
                window['warnings'].extend([
                    {'code': 'SAMPLED_TRACKING', 'message': '초당 2개 화면을 관측했습니다. 가림·빠른 움직임·장면 변화에서는 번호가 끊길 수 있습니다.'},
                    {'code': 'SUPPORTED_CLASSES', 'message': 'COCO 80개 종류를 지원하며 작은 물체나 지원 밖의 대상은 놓칠 수 있습니다.'}])
                result = {'schemaVersion': 1, 'sourceSha256': checkpoint['sourceSha256'],
                          'source': {field: source[field] for field in ('duration', 'width', 'height')},
                          'range': {'start': start, 'end': end, 'sampleFps': SAMPLE_FPS}, 'model': MODEL, **window}
                payload = json.dumps(result, ensure_ascii=False, allow_nan=False).encode()
                if len(payload) > 1536 * 1024 or sum(len(track['observations']) for track in result['tracks']) > 1440:
                    raise TrackingFailure('RESULT_LIMIT', '추적 구간의 결과가 저장 한도를 초과했습니다.')
                result_hash = digest(result)
                chunk_key = key(job_id, f'chunks/{index}-{result_hash}.json')
                try:
                    store.write_json(chunk_key, result, expected='0')
                except Conflict:
                    existing, _ = store.read_json(chunk_key)
                    if not existing or digest(existing) != result_hash:
                        raise ValueError('Immutable result object changed')
                entry = {'index': index, 'start': start, 'end': end, 'key': chunk_key, 'sha256': result_hash}
                next_checkpoint = {**checkpoint, 'manifest': [*checkpoint['manifest'], entry],
                                   'tracker': tracker.checkpoint(), 'histogram': previous_histogram}
                heartbeat()
                command_check(force=True)
                lease.heartbeat(force=True)
                checkpoint_version = store.write_json(key(job_id, 'checkpoint.json'), next_checkpoint, expected=checkpoint_version)
                checkpoint = next_checkpoint
                update_state(store, job_id, {'processedSeconds': end, 'completedChunks': index + 1,
                                             'sourceSha256': checkpoint['sourceSha256'], '_heartbeat': time.time()}, run_id=lease.run_id)
                tracker = TrackAssembler.from_checkpoint(checkpoint['tracker'])
        checked_checkpoint(plan, checkpoint)
        if not checkpoint['manifest'] or checkpoint['manifest'][-1]['end'] != source['duration']:
            raise ValueError('The entire source was not processed')
        command_check(force=True)
        update_state(store, job_id, {'state': 'completed'}, run_id=lease.run_id)
    except JobCancelled:
        try:
            update_state(store, job_id, {'state': 'cancelled', 'error': None}, run_id=lease.run_id if owns else None,
                         allowed={'queued', 'running', 'cancelling'})
        except LeaseLost:
            pass
    except (JobInterrupted, KeyboardInterrupt):
        if owns:
            try:
                update_state(store, job_id, {'state': 'interrupted', 'error': {'code': 'EXECUTION_INTERRUPTED', 'message': '실행이 중단됐습니다. 저장된 지점부터 재개할 수 있습니다.'}}, run_id=lease.run_id)
            except LeaseLost:
                pass
    except LeaseLost:
        pass  # A replacement worker owns the state; never overwrite it.
    except Exception as exc:
        if isinstance(exc, TrackingFailure):
            code, message = exc.code, exc.message
        elif isinstance(exc, RuntimeError) and str(exc) == 'TRACKING_MODEL_UNAVAILABLE':
            code, message = 'MODEL_UNAVAILABLE', '피사체 추적 모델이 준비되지 않았습니다.'
        else:
            code, message = 'TRACKING_FAILED', '전체 영상 추적을 완료하지 못했습니다. 저장된 지점부터 재개할 수 있습니다.'
        try:
            update_state(store, job_id, {'state': 'failed', 'error': {'code': code, 'message': message}}, run_id=lease.run_id if owns else None,
                         allowed={'queued', 'running', 'cancelling'})
        except LeaseLost:
            pass
    finally:
        if owns:
            try:
                lease.release()
            except (OSError, Conflict):
                pass  # A failed cleanup lease expires; never hide a committed result.
        if old_handler is not None:
            signal.signal(signal.SIGTERM, old_handler)
    return job_status(store, job_id)


if __name__ == '__main__':
    from full_tracking_store import create_store
    result = run_job(create_store(), os.environ['HORUBAK_TRACKING_JOB_ID'])
    raise SystemExit(1 if result['state'] in {'failed', 'interrupted'} else 0)
