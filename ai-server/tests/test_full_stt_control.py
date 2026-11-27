import copy
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

import full_stt_control as control
import full_stt_dispatch as queue
import full_stt_job as jobs
from full_tracking_store import LocalStore
from test_full_tracking_job import MemoryStore, source


def test_stt_queue_is_independent_and_drains_without_losing_resume(tmp_path):
    store=LocalStore(tmp_path); first,second=str(uuid4()),str(uuid4())
    identity=queue.enqueue(store,first); assert queue.enqueue(store,second) is None
    visited=[]
    queue.run_pending(store,identity,analyze=lambda _store,job_id,**_: visited.append(job_id) or {'state':'completed'})
    assert visited==[first,second]
    assert store.read_json('queues/tracking.json')==(None,None)
    assert store.read_json(queue.QUEUE_KEY)[0]['runner'] is None


def test_queue_resume_racing_ack_remains_queued_and_only_one_runner_is_created(tmp_path):
    store=LocalStore(tmp_path); identity=str(uuid4())
    runner=queue.enqueue(store,identity); assert queue.enqueue(store,identity) is None
    assert queue.next_job(store,runner)==identity
    store.write_json(jobs.key(identity,'state.json'),{'state':'queued'})
    assert queue.enqueue(store,identity) is None
    queue.acknowledge(store,runner,identity)
    assert queue.next_job(store,runner)==identity


def test_unknown_underlying_error_is_not_exposed_to_browser():
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as failure:
        control.public_error(RuntimeError('fake-sensitive-provider-url-and-token'))
    assert failure.value.status_code==503
    assert failure.value.detail['code']=='FULL_TRANSCRIPTION_STORAGE_FAILED'
    assert 'fake-sensitive' not in str(failure.value.detail)


def test_cloud_dispatch_only_overrides_stt_args_and_runner_id(monkeypatch):
    resource='projects/test-project/locations/asia-northeast3/jobs/full-analysis'
    monkeypatch.setenv('TRACKING_JOB_RESOURCE',resource)
    calls=[]
    class Session:
        def __init__(self,credentials): assert credentials=='fake-sdk-credentials'
        def post(self,url,**kwargs):
            calls.append((url,kwargs))
            return SimpleNamespace(raise_for_status=lambda:None,json=lambda:{'metadata':{'name':resource+'/executions/test'}})
    monkeypatch.setattr('google.auth.transport.requests.AuthorizedSession',Session)
    result=control.launch_runner(SimpleNamespace(client=SimpleNamespace(_credentials='fake-sdk-credentials')),str(uuid4()),'test-runner')
    assert result['id']==resource+'/executions/test'
    url,options=calls[0]
    assert url=='https://run.googleapis.com/v2/'+resource+':run'
    assert options['allow_redirects'] is False
    override=options['json']['overrides']['containerOverrides'][0]
    assert override['args']==['full_stt_dispatch.py']
    assert override['env']==[{'name':'HORUBAK_STT_RUNNER_ID','value':'test-runner'}]


def test_dispatch_failure_is_explicit_and_resumable(monkeypatch):
    store=MemoryStore(); identity=str(uuid4()); jobs.create_job(store,identity,source(600))
    monkeypatch.setattr(control,'launch_runner',lambda *_: (_ for _ in ()).throw(RuntimeError('test failure')))
    with pytest.raises(RuntimeError): control.execute_job(store,identity)
    assert jobs.job_status(store,identity)['state']=='failed'
    assert jobs.job_status(store,identity)['error']['code']=='DISPATCH_FAILED'
    assert jobs.resume_job(store,identity)['state']=='queued'


def test_context_uses_only_nearby_segments_and_accepts_times_after_one_hour(monkeypatch):
    import highlight
    store=MemoryStore(); identity=str(uuid4()); original=source(7500)
    jobs.create_job(store,identity,original)
    def window(_store,_job_id,stamp):
        index=min(int(stamp//300),24); start=index*300
        return {'segments':[{'segmentIndex':index*300+i,'startSeconds':start+i,'endSeconds':start+i+.5,'text':'테스트'} for i in range(300)]}
    monkeypatch.setattr(jobs,'job_status',lambda *_:{'state':'completed','source':original,'duration':7500,'totalChunks':25})
    monkeypatch.setattr(jobs,'read_window',window)
    seen=[]
    monkeypatch.setattr(highlight,'check_context',lambda value:seen.append(value) or {'status':'keep'})
    assert control.context_result(store,identity,4000,4040)=={'status':'keep'}
    assert len(seen[0].segments)==48
    assert seen[0].segments[0].startSeconds==3996
    assert seen[0].segments[-1].startSeconds==4043
    assert highlight.ContextCheckRequest(startSeconds=35940,endSeconds=36000,segments=[{'segmentIndex':1,'startSeconds':35940,'endSeconds':35999,'text':'끝'}])


def test_private_stt_routes_stay_behind_service_auth_and_never_require_media_body(monkeypatch):
    import main
    token='test-only-transcription-token-123456789'
    monkeypatch.setenv('ANALYSIS_SERVICE_TOKEN',token)
    store=MemoryStore(); monkeypatch.setattr(control,'configured_store',lambda:store)
    payload={'jobId':str(uuid4()),'source':source(36000)}; payload['source']['size']=4*1024**3
    with TestClient(main.app) as client:
        assert client.post('/api/transcripts/full/jobs/create',json=payload).status_code==401
        response=client.post('/api/transcripts/full/jobs/create',json=payload,headers={'Authorization':'Bearer '+token})
    assert response.status_code==200 and response.json()['totalChunks']==120
    assert len(str(payload))<2048
