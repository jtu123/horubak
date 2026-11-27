"""Durable whole-video transcription; only committed immutable windows are public."""
import copy
from datetime import datetime, timezone
import math
import os
import json
from pathlib import Path
import re
import signal
import threading
import time
import uuid

from full_stt_inference import InferenceSession
from full_stt_media import probe_audio
from full_tracking_job import JobCancelled, JobInterrupted, Lease, LeaseLost, digest, validate_source
from full_tracking_store import Conflict, encoded
from tracking_worker import TrackingFailure

CHUNK_SECONDS = 300
PUBLIC_FIELDS = ('id','state','source','processedSeconds','duration','chunkSeconds','completedChunks',
                 'totalChunks','segmentCount','sourceSha256','error','createdAt','updatedAt')
TERMINAL = {'completed','failed','cancelled','interrupted'}


def now():
    return datetime.now(timezone.utc).isoformat()


def key(job_id, name):
    if str(uuid.UUID(job_id)) != job_id:
        raise ValueError('Invalid transcription identity')
    return f'stt-jobs/{job_id}/{name}'


def configuration():
    model=os.getenv('WHISPER_MODEL','small')
    marker=Path(os.getenv('WHISPER_DOWNLOAD_ROOT',''))/'preloaded-model.json'
    try:
        with marker.open('rb') as value:
            payload=value.read(4097)
        if len(payload)>4096:
            raise ValueError('Unbounded model marker')
        identity=json.loads(payload)
        if identity.get('model')!=model or not re.fullmatch('[a-f0-9]{40}',identity.get('snapshot') or ''):
            raise ValueError('Invalid model revision')
        revision=identity['snapshot']
    except FileNotFoundError:
        if (os.getenv('K_SERVICE') or os.getenv('CLOUD_RUN_JOB')) and os.getenv('WHISPER_LOCAL_FILES_ONLY','').lower()=='true':
            raise TrackingFailure('MODEL_UNAVAILABLE','전사 모델의 사전 준비 정보를 확인하지 못했습니다.')
        revision='local-unversioned'
    except (OSError,ValueError,TypeError,AttributeError):
        raise TrackingFailure('MODEL_UNAVAILABLE','전사 모델의 버전 정보를 확인하지 못했습니다.')
    return {'model':model,'modelRevision':revision,'language':os.getenv('WHISPER_LANGUAGE','ko') or 'ko',
            'computeType':os.getenv('WHISPER_COMPUTE_TYPE','int8'),'library':'faster-whisper-1.2.1',
            'sampleRate':16000,'chunkSeconds':CHUNK_SECONDS,'overlapSeconds':2,'schemaVersion':1}


def create_job(store, job_id, source):
    validate_source(source)
    plan = {'id':job_id,'source':copy.deepcopy(source),'configuration':configuration(),'createdAt':now()}
    try:
        store.write_json(key(job_id,'plan.json'),plan,expected='0')
    except Conflict:
        original,_ = store.read_json(key(job_id,'plan.json'))
        if not original or original['source'] != source or original['configuration'] != plan['configuration']:
            raise ValueError('Transcription identity or configuration changed')
        plan=original
    initial={'id':job_id,'source':copy.deepcopy(source),'state':'queued','processedSeconds':0,
             'duration':source['duration'],'chunkSeconds':CHUNK_SECONDS,'completedChunks':0,
             'totalChunks':math.ceil(source['duration']/CHUNK_SECONDS),'segmentCount':0,'sourceSha256':None,
             'error':None,'createdAt':plan['createdAt'],'updatedAt':plan['createdAt']}
    try:
        store.write_json(key(job_id,'state.json'),initial,expected='0')
    except Conflict:
        pass
    return job_status(store,job_id)


def plan_for(store, job_id):
    plan,_=store.read_json(key(job_id,'plan.json'))
    if not plan or plan.get('id') != job_id or not isinstance(plan.get('configuration'),dict):
        raise ValueError('Transcription not found')
    validate_source(plan['source'])
    return plan


def checked_checkpoint(plan, checkpoint):
    if checkpoint is None:
        return
    if checkpoint.get('sourceIdentity') != digest(plan['source']) or checkpoint.get('configuration') != plan['configuration']:
        raise ValueError('Transcription checkpoint identity changed')
    manifest=checkpoint.get('manifest')
    if not isinstance(manifest,list) or len(manifest)>math.ceil(plan['source']['duration']/CHUNK_SECONDS):
        raise ValueError('Invalid transcription checkpoint')
    if manifest and not re.fullmatch('[a-f0-9]{64}',checkpoint.get('sourceSha256') or ''):
        raise ValueError('Missing original fingerprint')
    total=0
    for index,entry in enumerate(manifest):
        if (entry.get('index') != index or entry.get('start') != index*CHUNK_SECONDS
                or entry.get('end') != min((index+1)*CHUNK_SECONDS,plan['source']['duration'])
                or not re.fullmatch('[a-f0-9]{64}',entry.get('sha256') or '')
                or entry.get('key') != key(plan['id'],f'chunks/{index}-{entry["sha256"]}.json')
                or not isinstance(entry.get('segmentCount'),int) or isinstance(entry['segmentCount'],bool) or not 0<=entry['segmentCount']<=2000
                or entry.get('firstSegmentIndex') != total):
            raise ValueError('Invalid transcription manifest')
        total+=entry['segmentCount']
    if checkpoint.get('segmentCount') != total:
        raise ValueError('Transcription segment count changed')


def job_status(store, job_id):
    plan=plan_for(store,job_id)
    state,_=store.read_json(key(job_id,'state.json'))
    if not state:
        raise ValueError('Transcription job missing')
    checkpoint,_=store.read_json(key(job_id,'checkpoint.json'))
    checked_checkpoint(plan,checkpoint)
    result={name:state[name] for name in PUBLIC_FIELDS}
    if checkpoint:
        entries=checkpoint['manifest']
        result.update(completedChunks=len(entries),processedSeconds=entries[-1]['end'] if entries else 0,
                      segmentCount=checkpoint['segmentCount'],sourceSha256=checkpoint['sourceSha256'])
    if result['state']=='completed' and result['completedChunks']!=result['totalChunks']:
        raise ValueError('Incomplete transcription marked complete')
    return result


def update_state(store, job_id, changes, run_id=None, allowed=None):
    for _ in range(20):
        state,version=store.read_json(key(job_id,'state.json'))
        if not state:
            raise ValueError('Transcription job missing')
        if run_id and state.get('_runId') != run_id:
            raise LeaseLost('Another transcription owns this state')
        if allowed and state['state'] not in allowed:
            return state
        state.update(changes,updatedAt=now())
        try:
            store.write_json(key(job_id,'state.json'),state,expected=version)
            return state
        except Conflict:
            continue
    raise LeaseLost('Transcription state changed concurrently')


def mark_dispatch_failed(store, job_id):
    update_state(store,job_id,{'state':'failed','error':{'code':'DISPATCH_FAILED','message':'전사 작업을 시작하지 못했습니다. 다시 시작해 주세요.'}},allowed={'queued'})


def cancel_job(store, job_id):
    current=job_status(store,job_id)
    if current['state'] not in TERMINAL:
        store.write_json(key(job_id,'command.json'),{'cancelRequested':True})
        update_state(store,job_id,{'state':'cancelled' if current['state']=='queued' else 'cancelling'},allowed={'queued','running','cancelling'})
    return job_status(store,job_id)


def resume_job(store, job_id):
    current=job_status(store,job_id)
    if current['state'] not in {'failed','interrupted','cancelled'}:
        raise ValueError('Transcription job is not resumable')
    if plan_for(store,job_id)['configuration']!=configuration():
        raise ValueError('Transcription model changed; create a new analysis')
    store.write_json(key(job_id,'command.json'),{'cancelRequested':False})
    update_state(store,job_id,{'state':'queued','error':None},allowed={'failed','interrupted','cancelled'})
    return job_status(store,job_id)


def validate_segments(segments,start,end,base):
    if not isinstance(segments,list) or len(segments)>2000:
        raise ValueError('Transcription window exceeds segment budget')
    previous=start
    for index,item in enumerate(segments):
        left,right=item.get('startSeconds'),item.get('endSeconds')
        if (not isinstance(item.get('segmentIndex'),int) or isinstance(item['segmentIndex'],bool)
                or item['segmentIndex'] != base+index or not isinstance(left,(int,float)) or isinstance(left,bool)
                or not isinstance(right,(int,float)) or isinstance(right,bool) or not math.isfinite(left+right)
                or not start<=left<right<=end or left<previous or not isinstance(item.get('text'),str)
                or not item['text'].strip() or len(item['text'])>2000):
            raise ValueError('Invalid transcription segment')
        previous=left


def read_window(store,job_id,start):
    plan=plan_for(store,job_id)
    if not isinstance(start,(int,float)) or not math.isfinite(start) or not 0<=start<=plan['source']['duration']:
        raise ValueError('Invalid transcription position')
    checkpoint,_=store.read_json(key(job_id,'checkpoint.json')); checked_checkpoint(plan,checkpoint)
    index=min(math.floor(start/CHUNK_SECONDS),math.ceil(plan['source']['duration']/CHUNK_SECONDS)-1)
    if not checkpoint or index>=len(checkpoint['manifest']):
        return None
    entry=checkpoint['manifest'][index]
    result,_=store.read_json(entry['key'])
    if not result or digest(result)!=entry['sha256'] or len(encoded(result))>512*1024:
        raise ValueError('Transcription result changed')
    if (result.get('jobId')!=job_id or result.get('source')!=plan['source'] or result.get('sourceSha256')!=checkpoint['sourceSha256']
            or result.get('index')!=index or result.get('start')!=entry['start'] or result.get('end')!=entry['end']):
        raise ValueError('Transcription window identity changed')
    validate_segments(result['segments'],entry['start'],entry['end'],entry['firstSegmentIndex'])
    if len(result['segments']) != entry['segmentCount']:
        raise ValueError('Transcription result segment count changed')
    return result


def run_job(store,job_id,external_guard=None):
    plan=plan_for(store,job_id)
    if job_status(store,job_id)['state'] in {'completed','cancelled'}:
        return job_status(store,job_id)
    if plan['configuration']!=configuration():
        raise ValueError('Transcription model changed; create a new analysis')
    lease=Lease(store,'stt:'+job_id)
    owns=False; last_command=0; last_status=0; old_handler=None
    def interrupt(*_):
        raise JobInterrupted('Transcription execution stopping')
    if threading.current_thread() is threading.main_thread():
        old_handler=signal.signal(signal.SIGTERM,interrupt)
    def command_check(force=False):
        nonlocal last_command
        if force or time.monotonic()-last_command>=.5:
            if external_guard: external_guard()
            command,_=store.read_json(key(job_id,'command.json')); last_command=time.monotonic()
            if command and command.get('cancelRequested'): raise JobCancelled()
    def heartbeat():
        nonlocal last_status
        command_check(); lease.heartbeat()
        if time.monotonic()-last_status>=10:
            update_state(store,job_id,{'_heartbeat':time.time()},run_id=lease.run_id); last_status=time.monotonic()
    try:
        deadline=time.monotonic()+86400
        while not lease.acquire():
            command_check(True)
            active,_=store.read_json('locks/tracking.json')
            if active and active.get('jobId')=='stt:'+job_id and active.get('expiresAt',0)>time.time():
                return job_status(store,job_id)
            if time.monotonic()>deadline:
                raise TrackingFailure('ANALYSIS_BUSY','다른 영상 분석을 기다리는 시간이 초과됐습니다. 다시 시작해 주세요.')
            time.sleep(1)
        owns=True
        update_state(store,job_id,{'state':'running','error':None,'_runId':lease.run_id,'_heartbeat':time.time()})
        command_check(True)
        checkpoint,version=store.read_json(key(job_id,'checkpoint.json')); checked_checkpoint(plan,checkpoint)
        checkpoint=checkpoint or {'sourceIdentity':digest(plan['source']),'configuration':plan['configuration'],
                                  'sourceSha256':None,'manifest':[],'segmentCount':0}
        checkpoint['runId']=lease.run_id
        version=store.write_json(key(job_id,'checkpoint.json'),checkpoint,expected=version or '0')
        if checkpoint['sourceSha256'] is None:
            checkpoint['sourceSha256']=store.source_sha256(plan['source'],heartbeat)
            version=store.write_json(key(job_id,'checkpoint.json'),checkpoint,expected=version)
        source=plan['source']
        with store.source_url(source) as (url,_), InferenceSession() as session:
            metadata=probe_audio(url,source['duration'],heartbeat)
            metadata['duration']=source['duration']
            for index in range(len(checkpoint['manifest']),math.ceil(source['duration']/CHUNK_SECONDS)):
                start=index*CHUNK_SECONDS; end=min(source['duration'],start+CHUNK_SECONDS)
                heartbeat()
                segments=session.transcribe(url,metadata,start,end,checkpoint['segmentCount'],heartbeat)
                validate_segments(segments,start,end,checkpoint['segmentCount'])
                result={'jobId':job_id,'index':index,'start':start,'end':end,'source':source,
                        'sourceSha256':checkpoint['sourceSha256'],'segments':segments}
                if len(encoded(result))>512*1024:
                    raise TrackingFailure('RESULT_LIMIT','전사 구간 결과가 저장 한도를 초과했습니다.')
                checksum=digest(result); result_key=key(job_id,f'chunks/{index}-{checksum}.json')
                try:
                    store.write_json(result_key,result,expected='0')
                except Conflict:
                    existing,_=store.read_json(result_key)
                    if not existing or digest(existing)!=checksum:
                        raise ValueError('Immutable transcription changed')
                entry={'index':index,'start':start,'end':end,'key':result_key,'sha256':checksum,
                       'segmentCount':len(segments),'firstSegmentIndex':checkpoint['segmentCount']}
                candidate={**checkpoint,'manifest':[*checkpoint['manifest'],entry],
                           'segmentCount':checkpoint['segmentCount']+len(segments)}
                heartbeat(); command_check(True); lease.heartbeat(force=True)
                version=store.write_json(key(job_id,'checkpoint.json'),candidate,expected=version)
                checkpoint=candidate
                update_state(store,job_id,{'processedSeconds':end,'completedChunks':index+1,'segmentCount':checkpoint['segmentCount'],
                                          'sourceSha256':checkpoint['sourceSha256'],'_heartbeat':time.time()},run_id=lease.run_id)
        command_check(True)
        checked_checkpoint(plan,checkpoint)
        if not checkpoint['manifest'] or checkpoint['manifest'][-1]['end']!=source['duration']:
            raise ValueError('Incomplete transcription')
        update_state(store,job_id,{'state':'completed'},run_id=lease.run_id)
    except JobCancelled:
        try: update_state(store,job_id,{'state':'cancelled','error':None},run_id=lease.run_id if owns else None,allowed={'queued','running','cancelling'})
        except LeaseLost: pass
    except (JobInterrupted,KeyboardInterrupt):
        if owns:
            try: update_state(store,job_id,{'state':'interrupted','error':{'code':'EXECUTION_INTERRUPTED','message':'실행이 중단됐습니다. 저장된 지점부터 재개할 수 있습니다.'}},run_id=lease.run_id)
            except LeaseLost: pass
    except LeaseLost:
        pass
    except Exception as error:
        code,message=(error.code,error.message) if isinstance(error,TrackingFailure) else ('STT_FAILED','전사를 완료하지 못했습니다. 저장된 지점부터 재개해 주세요.')
        try: update_state(store,job_id,{'state':'failed','error':{'code':code,'message':message}},run_id=lease.run_id if owns else None,allowed={'queued','running','cancelling'})
        except LeaseLost: pass
    finally:
        if owns:
            try: lease.release()
            except (Conflict,OSError): pass
        if old_handler is not None: signal.signal(signal.SIGTERM,old_handler)
    return job_status(store,job_id)
