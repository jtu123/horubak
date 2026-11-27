import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import uuid
import wave

import numpy as np
import pytest

from full_stt_media import extract_audio, probe_audio
from full_stt_worker import load_pcm
from full_tracking_store import LocalStore, source_key
from tracking_worker import TrackingFailure


@pytest.fixture
def native():
    ffmpeg=os.getenv('FFMPEG_BINARY') or shutil.which('ffmpeg')
    ffprobe=os.getenv('FFPROBE_BINARY') or shutil.which('ffprobe')
    if not ffmpeg or not ffprobe:
        pytest.skip('Native media tools required')
    return ffmpeg


def stored_video(tmp_path,native,offset=2,audio=True):
    media=tmp_path/'original.mp4'
    command=[native,'-y','-v','error','-f','lavfi','-i','color=c=black:s=64x64:r=25:d=8']
    if audio:
        command+=['-itsoffset',str(offset),'-f','lavfi','-i','sine=frequency=1000:duration=4','-map','0:v','-map','1:a','-c:a','aac']
    command+=['-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',str(media)]
    subprocess.run(command,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30)
    store=LocalStore(tmp_path/'objects')
    owner,project,upload=(str(uuid.uuid4()) for _ in range(3)); name=source_key(owner,project,upload)
    target=store.path(name); target.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(media,target)
    return store,{'uploadId':upload,'filename':'original.mp4','objectKey':name,'generation':str(target.stat().st_mtime_ns),
                  'size':target.stat().st_size,'checksum':hashlib.sha256(target.read_bytes()).hexdigest()}


def test_real_positive_audio_offset_and_short_tail_are_in_original_video_time(tmp_path,native):
    store,source=stored_video(tmp_path,native)
    beats=[]
    with store.source_url(source) as (url,_):
        metadata=probe_audio(url,8,lambda:beats.append(True))
        assert 1.9<metadata['audioStart']-metadata['origin']<2.1
        path=tmp_path/'first.wav'; extract_audio(url,metadata,0,3,path,lambda:None)
        first=load_pcm(path)
        assert len(first)==48000
        assert float(np.max(np.abs(first[:int(1.8*16000)])))<.001
        assert float(np.mean(np.abs(first[int(2.2*16000):])))>.02
        path=tmp_path/'middle.wav'; extract_audio(url,metadata,3,5,path,lambda:None)
        middle=load_pcm(path)
        assert len(middle)==32000 and float(np.mean(np.abs(middle)))>.02
        path=tmp_path/'tail.wav'; extract_audio(url,metadata,7,8,path,lambda:None)
        assert np.max(np.abs(load_pcm(path)))==0
    assert beats


def test_real_video_without_audio_is_explicit_no_audio(tmp_path,native):
    store,source=stored_video(tmp_path,native,audio=False)
    with store.source_url(source) as (url,_):
        with pytest.raises(TrackingFailure) as failure:
            probe_audio(url,8)
    assert failure.value.code=='NO_AUDIO'


def test_cancel_during_real_extraction_reaps_its_process(tmp_path,native,monkeypatch):
    import full_stt_media as media
    store,source=stored_video(tmp_path,native)
    real=media.subprocess.Popen; children=[]
    def spawn(*args,**kwargs):
        process=real(*args,**kwargs); children.append(process); return process
    with store.source_url(source) as (url,_):
        metadata=probe_audio(url,8)
        monkeypatch.setattr(media.subprocess,'Popen',spawn)
        def cancel():
            raise RuntimeError('independent cancellation')
        with pytest.raises(RuntimeError): extract_audio(url,metadata,0,8,tmp_path/'cancel.wav',cancel)
    assert children and all(child.poll() is not None for child in children)
