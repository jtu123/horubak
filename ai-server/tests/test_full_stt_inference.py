import subprocess
import sys

import pytest

import full_stt_inference as inference
from full_tracking_job import JobCancelled
from tracking_worker import TrackingFailure


@pytest.mark.parametrize('failure',['cancel','timeout'])
def test_cancel_and_deadline_reap_real_isolated_inference_child(tmp_path,monkeypatch,failure):
    children=[]; native=inference.subprocess.Popen
    def spawn(arguments,**kwargs):
        if not any(str(item).endswith('full_stt_worker.py') for item in arguments):
            return native(arguments,**kwargs)
        child=native([sys.executable,'-c','import time; time.sleep(60)'],**kwargs)
        children.append(child)
        return child
    monkeypatch.setattr(inference.subprocess,'Popen',spawn)
    monkeypatch.setattr(inference,'extract_audio',lambda *args:args[2])
    monkeypatch.setenv('FULL_STT_CHUNK_TIMEOUT_SECONDS','30')
    def heartbeat():
        if failure=='cancel': raise JobCancelled()
    if failure=='timeout':
        stamps=iter([0,100]); monkeypatch.setattr(inference.time,'monotonic',lambda:next(stamps,100))
    with pytest.raises(JobCancelled if failure=='cancel' else TrackingFailure):
        with inference.InferenceSession() as session:
            session.transcribe('http://127.0.0.1/source',{'duration':10},0,10,0,heartbeat)
    assert len(children)==1 and children[0].poll() is not None
    assert children[0].stdin.closed


def test_two_windows_use_one_model_child_and_bounded_audio(monkeypatch):
    import io,json
    from pathlib import Path
    children=[]; extracted=[]; stopped=[]
    class Input(io.StringIO):
        def flush(self):
            command=json.loads(self.getvalue().splitlines()[-1])
            Path(command['output']).write_text(json.dumps({'segments':[]}),encoding='utf-8')
    class Child:
        def __init__(self): self.stdin=Input()
        def poll(self): return None
    def spawn(*_,**__):
        child=Child(); children.append(child); return child
    monkeypatch.setattr(inference.subprocess,'Popen',spawn)
    monkeypatch.setattr(inference,'terminate_tree',lambda process:stopped.append(process))
    monkeypatch.setattr(inference,'extract_audio',lambda _url,_meta,start,end,*_:extracted.append((start,end)))
    with inference.InferenceSession() as session:
        assert session.transcribe('http://127.0.0.1/source',{'duration':602.5},0,300,0,lambda:None)==[]
        assert session.transcribe('http://127.0.0.1/source',{'duration':602.5},300,600,0,lambda:None)==[]
    assert extracted==[(0,302),(298,602)]
    assert len(children)==1 and stopped==children and children[0].stdin.closed
