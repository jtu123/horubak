from types import SimpleNamespace
import wave

import numpy as np
import pytest

import full_stt_worker as worker


def test_bounded_pcm_input_bypasses_second_pyav_decode_and_normalizes_samples(tmp_path):
    path=tmp_path/'window.wav'
    with wave.open(str(path),'wb') as output:
        output.setparams((1,2,16000,0,'NONE','not compressed'))
        output.writeframes(np.array([-32768,0,16384,32767],dtype='<i2').tobytes())
    audio=worker.load_pcm(path)
    assert audio.dtype==np.float32 and audio.shape==(4,)
    assert audio.tolist()==[-1.,0.,.5,32767/32768]


@pytest.mark.parametrize('channels,rate,length',[(2,16000,4),(1,8000,4),(1,16000,304*16000+1)])
def test_unsupported_or_oversize_pcm_is_rejected_before_whisper(tmp_path,channels,rate,length):
    path=tmp_path/'bad.wav'
    with wave.open(str(path),'wb') as output:
        output.setparams((channels,2,rate,0,'NONE','not compressed'))
        output.writeframes(bytes(length*channels*2))
    with pytest.raises(ValueError): worker.load_pcm(path)


def test_overlap_words_have_one_core_owner_and_original_times_are_clamped():
    def segment():
        return SimpleNamespace(words=[SimpleNamespace(start=1.4,end=2.4,word=' 경계'),
                                      SimpleNamespace(start=2.2,end=2.7,word=' 다음.')],text='',start=0,end=4)
    left=worker.owned_segments([segment()],298,0,300,0)
    right=worker.owned_segments([segment()],298,300,600,len(left))
    assert ''.join(item['text'] for item in left)=='경계'
    assert ''.join(item['text'] for item in right)=='다음.'
    assert left[-1]['endSeconds']==300 and right[0]['startSeconds']==300.2
    assert [item['segmentIndex'] for item in left+right]==[0,1]


def test_silence_is_a_valid_empty_transcript():
    assert worker.owned_segments([],0,0,300,10)==[]
