"""Authenticated small-job requests; source bytes and long transcripts stay in GCS."""
from datetime import datetime
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import time

from fastapi import APIRouter, HTTPException
from pydantic import Field

import full_stt_dispatch as queue
import full_stt_job as jobs
from full_tracking_control import CreateInput, JobInput, WindowInput, execution_active, failure, iso, process_info
from full_tracking_store import Conflict, LocalStore, create_store, encoded
from tracking_worker import TrackingFailure


def configured_store():
    try:
        return create_store()
    except (ImportError,ValueError):
        failure('FULL_TRANSCRIPTION_NOT_CONFIGURED','전체 영상 전사 저장소와 작업 서버가 준비되지 않았습니다.')


def launch_runner(store,job_id,identity):
    if isinstance(store,LocalStore):
        environment={**os.environ,'HORUBAK_STT_RUNNER_ID':identity,'PYTHONUNBUFFERED':'1'}
        options={'creationflags':subprocess.CREATE_NEW_PROCESS_GROUP|subprocess.CREATE_NO_WINDOW} if os.name=='nt' else {'start_new_session':True}
        process=subprocess.Popen([sys.executable,str(Path(__file__).with_name('full_stt_dispatch.py'))],cwd=Path(__file__).parent,
                                 env=environment,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,**options)
        return {'id':f'local-{process.pid}-{identity}','pid':process.pid,'birth':process_info(process.pid)[1],'startedAt':iso()}
    from google.auth.transport.requests import AuthorizedSession
    resource=os.getenv('TRACKING_JOB_RESOURCE','')
    if not re.fullmatch(r'projects/[A-Za-z0-9_-]+/locations/[a-z0-9-]+/jobs/[a-z0-9-]+',resource):
        failure('FULL_TRANSCRIPTION_NOT_CONFIGURED','전체 전사의 실행 대상이 설정되지 않았습니다.')
    response=AuthorizedSession(store.client._credentials).post('https://run.googleapis.com/v2/'+resource+':run',
        json={'overrides':{'taskCount':1,'containerOverrides':[{'args':['full_stt_dispatch.py'],
              'env':[{'name':'HORUBAK_STT_RUNNER_ID','value':identity}]}]}},timeout=30,allow_redirects=False)
    response.raise_for_status(); operation=response.json()
    return {'id':operation.get('metadata',{}).get('name') or operation['name'],'startedAt':iso()}


def execute_job(store,job_id):
    if jobs.job_status(store,job_id)['state']=='completed':
        return {'executionId':'completed-'+job_id}
    try:
        identity=queue.enqueue(store,job_id)
    except queue.QueueFull:
        jobs.mark_dispatch_failed(store,job_id)
        failure('ANALYSIS_BUSY','전사 대기열이 가득 찼습니다. 잠시 후 다시 시작해 주세요.')
    if identity is None:
        execution=queue.execution_for(store,job_id)
        return {'executionId':execution['id'] if execution else 'queued-'+job_id}
    try:
        execution=launch_runner(store,job_id,identity)
    except Exception:
        queue.abandon(store,identity); queue.drop_pending(store,job_id)
        jobs.mark_dispatch_failed(store,job_id)
        raise
    store.write_json(jobs.key(job_id,'execution.json'),execution)
    try:
        queue.set_execution(store,identity,execution)
    except Conflict:
        if jobs.job_status(store,job_id)['state'] not in {'completed','cancelled','failed'}:
            raise
    return {'executionId':execution['id']}


def reconcile_job(store,job_id):
    current=jobs.job_status(store,job_id)
    if current['state'] not in {'queued','running','cancelling'}:
        return current
    state,_=store.read_json(jobs.key(job_id,'state.json'))
    updated=state.get('_heartbeat') or datetime.fromisoformat(current['updatedAt'].replace('Z','+00:00')).timestamp()
    if time.time()-updated<30:
        return current
    pending,_=store.read_json(queue.QUEUE_KEY)
    reserved=pending and (pending['current']==job_id or job_id in pending['pending'])
    runner=pending.get('runner') if reserved else None
    execution=(runner or {}).get('execution')
    if reserved and not execution:
        if current['state']!='queued' or runner and runner['expires']>time.time():
            return current
        lease,_=store.read_json('locks/tracking.json')
        if lease and lease.get('jobId')=='stt:'+job_id and lease.get('expiresAt',0)>time.time():
            return current
        try: execute_job(store,job_id)
        except Conflict: raise
        except Exception: jobs.mark_dispatch_failed(store,job_id)
        return jobs.job_status(store,job_id)
    if not reserved and not execution:
        execution,_=store.read_json(jobs.key(job_id,'execution.json'))
    if execution and execution_active(store,execution) is False:
        terminal='cancelled' if current['state']=='cancelling' else 'interrupted'
        error=None if terminal=='cancelled' else {'code':'EXECUTION_INTERRUPTED','message':'전사 실행이 중단됐습니다. 저장된 지점부터 재개해 주세요.'}
        jobs.update_state(store,job_id,{'state':terminal,'error':error},allowed={'queued','running','cancelling'})
        pending,_=store.read_json(queue.QUEUE_KEY)
        if pending and pending.get('runner') and pending['runner'].get('execution')==execution:
            queue.abandon(store,pending['runner']['id'])
    return jobs.job_status(store,job_id)


def context_result(store,job_id,start,end):
    from highlight import ContextCheckRequest, check_context
    job=jobs.job_status(store,job_id)
    if job['state']!='completed':
        failure('TRANSCRIPT_NOT_READY','전사가 완료된 뒤 맥락을 검토해 주세요.',409)
    if not all(math.isfinite(value) for value in (start,end)) or not 0<=start<end<=job['duration'] or not 30<=round(end-start,3)<=60:
        failure('INVALID_RANGE','원본 안의 30~60초 구간을 선택해 주세요.',422)
    first=int(start//jobs.CHUNK_SECONDS); last=min(int(end//jobs.CHUNK_SECONDS),job['totalChunks']-1)
    segments=[]
    for index in range(first,last+1):
        segments.extend(jobs.read_window(store,job_id,index*jobs.CHUNK_SECONDS)['segments'])
    inside=[item for item in segments if item['startSeconds']<end and item['endSeconds']>start]
    if not inside:
        failure('TRANSCRIPT_EMPTY_RANGE','이 구간에 전사된 음성이 없습니다.',422)
    before=[item for item in segments if item['endSeconds']<=start][-4:]
    after=[item for item in segments if item['startSeconds']>=end][:4]
    for index in range(first-1,-1,-1):
        if len(before)>=4: break
        previous=jobs.read_window(store,job_id,index*jobs.CHUNK_SECONDS)['segments']
        before=(previous+before)[-4:]
    for index in range(last+1,job['totalChunks']):
        if len(after)>=4: break
        following=jobs.read_window(store,job_id,index*jobs.CHUNK_SECONDS)['segments']
        after=(after+following)[:4]
    nearby=before+inside+after
    if len(nearby)>1024 or len(encoded(nearby))>1024*1024:
        failure('RESULT_LIMIT','검토할 구간의 전사가 너무 많습니다.',422)
    return check_context(ContextCheckRequest(startSeconds=start,endSeconds=end,segments=nearby))


def public_error(error):
    if isinstance(error,HTTPException): raise error
    if isinstance(error,Conflict): failure('TRANSCRIPTION_BUSY','다른 요청이 전사 상태를 변경했습니다. 다시 확인해 주세요.',409)
    if isinstance(error,(ValueError,KeyError)): failure('FULL_TRANSCRIPTION_INVALID','전사 원본 또는 작업 정보를 확인해 주세요.',422)
    if isinstance(error,TrackingFailure):
        failure(error.code,error.message,503 if error.code in {'TOOLS_UNAVAILABLE','MODEL_UNAVAILABLE','CONFIG_INVALID'} else 422)
    failure('FULL_TRANSCRIPTION_STORAGE_FAILED','전체 전사 저장소 또는 작업 서버에 연결하지 못했습니다.')


class ContextInput(JobInput):
    start:float=Field(ge=0,le=36000,allow_inf_nan=False)
    end:float=Field(gt=0,le=36000,allow_inf_nan=False)


def create_full_stt_router():
    router=APIRouter(prefix='/api/transcripts/full/jobs')
    @router.post('/create')
    def create(value:CreateInput):
        try: return jobs.create_job(configured_store(),str(value.jobId),value.source.model_dump(mode='json'))
        except Exception as error: return public_error(error)
    @router.post('/status')
    def status(value:JobInput):
        try: return reconcile_job(configured_store(),str(value.jobId))
        except Exception as error: return public_error(error)
    @router.post('/dispatch')
    def dispatch(value:JobInput):
        try: return execute_job(configured_store(),str(value.jobId))
        except Exception as error: return public_error(error)
    @router.post('/cancel')
    def cancel(value:JobInput):
        try:
            store=configured_store(); identity=str(value.jobId)
            jobs.cancel_job(store,identity); queue.drop_pending(store,identity)
            return jobs.job_status(store,identity)
        except Exception as error: return public_error(error)
    @router.post('/resume')
    def resume(value:JobInput):
        try: return jobs.resume_job(configured_store(),str(value.jobId))
        except Exception as error: return public_error(error)
    @router.post('/window')
    def window(value:WindowInput):
        try:
            result=jobs.read_window(configured_store(),str(value.jobId),value.start)
            return {'state':'ready' if result is not None else 'pending','window':result}
        except Exception as error: return public_error(error)
    @router.post('/context')
    def context(value:ContextInput):
        try: return context_result(configured_store(),str(value.jobId),value.start,value.end)
        except Exception as error: return public_error(error)
    return router
