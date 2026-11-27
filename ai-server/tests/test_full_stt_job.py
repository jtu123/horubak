import copy
import json
import uuid

import pytest

import full_stt_job as jobs
from full_tracking_job import JobInterrupted, Lease
from test_full_tracking_job import MemoryStore, source


@pytest.fixture
def engine(monkeypatch):
    calls = []
    class Session:
        def __enter__(self):
            return self
        def __exit__(self, *_):
            calls.append('closed')
        def transcribe(self, url, metadata, start, end, base, heartbeat):
            calls.append(start)
            heartbeat()
            return [{'segmentIndex': base, 'startSeconds': start, 'endSeconds': min(start + 1, end), 'text': '검증 전사'}]
    monkeypatch.setattr(jobs, 'InferenceSession', Session)
    monkeypatch.setattr(jobs, 'probe_audio', lambda *_: {'origin': 0, 'audioStart': 0, 'audioEnd': 36000})
    return calls


@pytest.mark.parametrize('size,duration,accepted', [(4*1024**3,36000,True),(4*1024**3+1,36000,False),(1,36000.01,False)])
def test_input_bounds_match_original_registration(size,duration,accepted):
    original = source(duration); original['size'] = size
    if accepted:
        job = jobs.create_job(MemoryStore(), str(uuid.uuid4()), original)
        assert job['totalChunks'] == 120 and job['chunkSeconds'] == 300
    else:
        with pytest.raises(ValueError):
            jobs.create_job(MemoryStore(), str(uuid.uuid4()), original)


def test_full_transcript_commits_continuous_windows_and_global_segment_indices(engine):
    store = MemoryStore(); identity = str(uuid.uuid4()); original = source(602.25)
    jobs.create_job(store, identity, original)
    result = jobs.run_job(store, identity)
    assert result['state'] == 'completed'
    assert (result['completedChunks'], result['processedSeconds'], result['segmentCount']) == (3,602.25,3)
    for index, stamp in enumerate([0,300,602]):
        window = jobs.read_window(store, identity, stamp)
        assert window['index'] == index and window['source'] == original
        assert window['segments'][0]['segmentIndex'] == index
        assert window['start'] <= window['segments'][0]['startSeconds'] < window['segments'][0]['endSeconds'] <= window['end']
    assert engine == [0,300,600,'closed']
    assert jobs.run_job(store, identity) == result


def test_interruption_resumes_committed_windows_without_repeating_or_reindexing(engine,monkeypatch):
    store = MemoryStore(); identity = str(uuid.uuid4()); jobs.create_job(store,identity,source(601))
    real = jobs.InferenceSession.transcribe
    def fail(self,url,metadata,start,*args):
        if start == 300:
            raise JobInterrupted('test interruption')
        return real(self,url,metadata,start,*args)
    monkeypatch.setattr(jobs.InferenceSession,'transcribe',fail)
    result = jobs.run_job(store,identity)
    assert result['state'] == 'interrupted' and result['completedChunks'] == 1
    first = copy.deepcopy(jobs.read_window(store,identity,0))
    jobs.resume_job(store,identity)
    monkeypatch.setattr(jobs.InferenceSession,'transcribe',real)
    assert jobs.run_job(store,identity)['state'] == 'completed'
    assert jobs.read_window(store,identity,0) == first
    assert jobs.read_window(store,identity,600)['segments'][0]['segmentIndex'] == 2


def test_cancel_does_not_commit_current_window_and_cleans_session(engine,monkeypatch):
    store = MemoryStore(); identity = str(uuid.uuid4()); jobs.create_job(store,identity,source(600))
    real = jobs.InferenceSession.transcribe
    def cancel(self,*args):
        result = real(self,*args)
        jobs.cancel_job(store,identity)
        return result
    monkeypatch.setattr(jobs.InferenceSession,'transcribe',cancel)
    result = jobs.run_job(store,identity)
    assert result['state'] == 'cancelled' and result['completedChunks'] == 0
    assert engine[-1] == 'closed'
    assert jobs.read_window(store,identity,0) is None


def test_immutable_result_hash_is_checked_and_generation_changes_are_rejected(engine):
    store = MemoryStore(); identity = str(uuid.uuid4()); original=source(10)
    jobs.create_job(store,identity,original); jobs.run_job(store,identity)
    changed={**original,'generation':'98765'}
    with pytest.raises(ValueError): jobs.create_job(store,identity,changed)
    checkpoint,_=store.read_json(jobs.key(identity,'checkpoint.json'))
    entry=checkpoint['manifest'][0]; payload,version=store.read_json(entry['key'])
    payload['segments'][0]['text']='changed'
    store.write_json(entry['key'],payload,expected=version)
    with pytest.raises(ValueError): jobs.read_window(store,identity,0)


def test_stt_and_tracking_share_fenced_model_lease():
    store=MemoryStore(); tracking=Lease(store,str(uuid.uuid4())); stt=Lease(store,'stt:'+str(uuid.uuid4()))
    assert tracking.acquire() and not stt.acquire()
    tracking.release(); assert stt.acquire()
    tracking.release()
    assert store.read_json('locks/tracking.json')[0]['runId'] == stt.run_id
    stt.release()


def test_changed_preloaded_model_revision_rejects_resume_but_keeps_results_readable(tmp_path,monkeypatch,engine):
    monkeypatch.setenv('WHISPER_DOWNLOAD_ROOT',str(tmp_path))
    marker=tmp_path/'preloaded-model.json'
    marker.write_text(json.dumps({'model':'small','snapshot':'a'*40}),encoding='utf-8')
    store=MemoryStore(); identity=str(uuid.uuid4()); jobs.create_job(store,identity,source(10))
    jobs.cancel_job(store,identity)
    marker.write_text(json.dumps({'model':'small','snapshot':'b'*40}),encoding='utf-8')
    assert jobs.job_status(store,identity)['state']=='cancelled'
    with pytest.raises(ValueError): jobs.resume_job(store,identity)


def test_cloud_local_model_requires_a_valid_bounded_revision_marker(tmp_path,monkeypatch):
    monkeypatch.setenv('WHISPER_DOWNLOAD_ROOT',str(tmp_path)); monkeypatch.setenv('CLOUD_RUN_JOB','test-only')
    monkeypatch.setenv('WHISPER_LOCAL_FILES_ONLY','true')
    from tracking_worker import TrackingFailure
    with pytest.raises(TrackingFailure): jobs.configuration()
    (tmp_path/'preloaded-model.json').write_text(json.dumps({'model':'small','snapshot':'a'*40}),encoding='utf-8')
    assert jobs.configuration()['modelRevision']=='a'*40


def test_foreign_lease_blocks_model_start_and_queued_cancel_preserves_its_owner(engine):
    store=MemoryStore(); tracking=Lease(store,str(uuid.uuid4())); assert tracking.acquire()
    identity=str(uuid.uuid4()); jobs.create_job(store,identity,source(10))
    def cancel(): jobs.cancel_job(store,identity)
    result=jobs.run_job(store,identity,external_guard=cancel)
    assert result['state']=='cancelled' and engine==[]
    assert store.read_json('locks/tracking.json')[0]['runId']==tracking.run_id
    tracking.release()


def test_old_worker_does_not_publish_after_another_execution_takes_its_lease(engine,monkeypatch):
    store=MemoryStore(); identity=str(uuid.uuid4()); jobs.create_job(store,identity,source(10))
    real=jobs.InferenceSession.transcribe
    def replace(self,*args):
        result=real(self,*args)
        lease,version=store.read_json('locks/tracking.json'); lease['expiresAt']=0
        store.write_json('locks/tracking.json',lease,expected=version)
        successor=Lease(store,'stt:'+identity); assert successor.acquire()
        jobs.update_state(store,identity,{'_runId':successor.run_id,'state':'running'})
        return result
    monkeypatch.setattr(jobs.InferenceSession,'transcribe',replace)
    jobs.run_job(store,identity)
    assert jobs.read_window(store,identity,0) is None
    assert jobs.job_status(store,identity)['state']=='running'
