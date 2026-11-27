"""One isolated Whisper model per job; newline commands contain local paths only."""
import json
import math
import os
from pathlib import Path
import sys
from types import SimpleNamespace
import wave

from stt_worker import get_model
from subtitles import split_subtitles


def load_pcm(path):
    import numpy as np
    with wave.open(str(path), 'rb') as audio:
        count = audio.getnframes()
        if ((audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 16000)
                or not 0 < count <= 304 * 16000):
            raise ValueError('Unexpected or unbounded audio window')
        payload = audio.readframes(count + 1)
        if len(payload) != count * 2:
            raise ValueError('Incomplete audio window')
    return np.frombuffer(payload, dtype='<i2').astype(np.float32) / 32768


def owned_segments(segments, offset, start, end, base):
    results = []
    for segment in segments:
        words = []
        for word in segment.words or []:
            left, right = offset + word.start, offset + word.end
            if not all(math.isfinite(value) for value in (left, right)) or right <= left:
                continue
            if start <= (left + right) / 2 < end:
                words.append(SimpleNamespace(start=max(start, left), end=min(end, right), word=word.word))
        if segment.words:
            grouped = split_subtitles(SimpleNamespace(words=words, text='', start=start, end=end)) if words else []
        else:
            left, right = offset + segment.start, offset + segment.end
            grouped = [{'start': max(start, left), 'end': min(end, right), 'text': segment.text.strip()}] if start <= (left + right) / 2 < end else []
        for item in grouped:
            left = max(start, item['start']); right = min(end, item['end']); text = item['text'].strip()
            if text and left < right:
                results.append({'segmentIndex': base + len(results), 'startSeconds': left, 'endSeconds': right, 'text': text})
        if len(results) > 2000:
            raise ValueError('Transcript window exceeds its segment budget')
    return results


def main():
    model = None
    for line in sys.stdin:
        command = json.loads(line)
        output = Path(command['output'])
        try:
            model = model or get_model()
            # PCM is already decoded and bounded; avoid a second PyAV decode.
            segments, _ = model.transcribe(load_pcm(command['audio']), language=os.getenv('WHISPER_LANGUAGE', 'ko') or 'ko',
                                           vad_filter=True, condition_on_previous_text=False, word_timestamps=True)
            result = {'segments': owned_segments(segments, command['offset'], command['start'], command['end'], command['base'])}
            payload = json.dumps(result, ensure_ascii=False, allow_nan=False).encode()
            if len(payload) > 512 * 1024:
                raise ValueError('Transcript window exceeds its byte budget')
        except Exception as error:
            payload = json.dumps({'error': 'STT_FAILED', 'errorType': type(error).__name__, 'message': '음성 인식을 완료하지 못했습니다. 모델과 원본을 확인해 주세요.'}, ensure_ascii=False).encode()
        temporary = output.with_suffix('.tmp')
        temporary.write_bytes(payload)
        temporary.replace(output)


if __name__ == '__main__':
    main()
