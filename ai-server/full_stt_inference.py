"""Bounded PCM and an isolated, reusable Whisper child with cancellable waits."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

from full_stt_media import extract_audio
from full_tracking_engine_process import process_options, terminate_tree
from tracking_worker import TrackingFailure


class InferenceSession:
    def __enter__(self):
        self.directory = tempfile.TemporaryDirectory(prefix='horubak-full-stt-')
        self.process = None
        self.sequence = 0
        return self

    def __exit__(self, *_):
        try:
            if self.process is not None:
                try:
                    terminate_tree(self.process)
                finally:
                    self.process.stdin.close()
        finally:
            self.directory.cleanup()

    def transcribe(self, url, metadata, start, end, base, heartbeat):
        folder = Path(self.directory.name)
        audio, output = folder / 'window.wav', folder / f'result-{self.sequence}.json'
        self.sequence += 1
        offset = max(0, start - 2)
        extract_audio(url, metadata, offset, min(metadata['duration'], end + 2), audio, heartbeat)
        if self.process is None:
            self.process = subprocess.Popen([sys.executable, str(Path(__file__).with_name('full_stt_worker.py'))],
                                            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                            text=True, encoding='utf-8', **process_options())
        command = {'audio': str(audio), 'output': str(output), 'offset': offset, 'start': start, 'end': end, 'base': base}
        self.process.stdin.write(json.dumps(command) + '\n'); self.process.stdin.flush()
        timeout = float(os.getenv('FULL_STT_CHUNK_TIMEOUT_SECONDS', '1800'))
        if not 30 <= timeout <= 7200:
            raise TrackingFailure('CONFIG_INVALID', '전사 구간의 처리 제한 설정을 확인해 주세요.')
        deadline = time.monotonic() + timeout
        while not output.exists():
            heartbeat()
            if self.process.poll() is not None:
                raise TrackingFailure('STT_FAILED', '음성 인식 프로세스가 종료됐습니다. 저장된 지점부터 재개해 주세요.')
            if time.monotonic() > deadline:
                raise TrackingFailure('STT_TIMEOUT', '전사 구간 처리 시간이 초과됐습니다. 저장된 지점부터 재개해 주세요.')
            time.sleep(.1)
        heartbeat()
        if output.stat().st_size > 512 * 1024:
            raise TrackingFailure('RESULT_LIMIT', '전사 구간 결과가 저장 한도를 초과했습니다.')
        result = json.loads(output.read_text(encoding='utf-8'))
        output.unlink()
        if 'error' in result:
            raise TrackingFailure('STT_FAILED', '음성 인식을 완료하지 못했습니다. 모델과 원본을 확인해 주세요.')
        return result['segments']
