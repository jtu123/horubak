import { useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import type { useProjectTranscript } from '../services/useProjectTranscript';
import { activeTranscriptionJob, resumableTranscriptionJob, TRANSCRIPTION_CHUNK_SECONDS } from '../full-transcription-model';
import { formatSize, formatTime } from '../lib';
import './transcript-analysis.css';

const labels = { queued: '전사 대기', running: '전체 한국어 전사 중', cancelling: '전사 중단 중', cancelled: '전사 중단됨', interrupted: '전사 실행이 중단됐어요', failed: '전사 실패', completed: '전체 한국어 전사 완료' };

export function TranscriptAnalysis({ project, enabled, transcript, onSourceReady }: {
  project: Project; videoUrl?: string; enabled: boolean; ownerId?: string;
  transcript: ReturnType<typeof useProjectTranscript>; onSourceReady?: (uploadId: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const readyCallback = useRef(onSourceReady); readyCallback.current = onSourceReady;
  const [position, setPosition] = useState(String(transcript.windowStart));
  useEffect(() => { setPosition(String(transcript.windowStart)); }, [project.id, transcript.windowStart]);
  useEffect(() => { if (enabled && transcript.source) readyCallback.current?.(transcript.source.uploadId); }, [project.id, enabled, transcript.source?.uploadId]);
  if (project.source === 'sample') return null;
  const { job, source, operation } = transcript;
  const busy = operation !== null || transcript.loading;
  const active = activeTranscriptionJob(job);
  const disabled = busy || !enabled || !transcript.supported || transcript.configured !== true;
  const begin = () => {
    if (!source && !transcript.selectedFile) input.current?.click();
    else void transcript.analyze();
  };
  return <section className="transcript-analysis" aria-label="전체 영상 한국어 전사" aria-busy={busy}>
    <input ref={input} className="sr-only" type="file" accept="video/mp4,video/quicktime,.mp4,.mov" aria-label="전사할 원본 파일" disabled={disabled || active}
      onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void transcript.analyze(file); }} />
    <div className="transcript-analysis-actions">
      <button type="button" className="btn secondary" disabled={disabled || active} onClick={begin}>{operation === 'preparing' ? '원본 확인 중…' : operation === 'upload' ? '원본 업로드 중…' : operation === 'start' ? '전사 시작 중…' : transcript.loading ? '전사 불러오는 중…' : job?.state === 'completed' ? '전체 전사 다시 생성' : source ? '전체 한국어 전사 시작' : transcript.selectedFile ? '원본 이어 올리고 전사' : '원본 업로드 후 전사'}</button>
      <button type="button" className="text-link" disabled={busy || !enabled} onClick={transcript.reload}>다시 불러오기</button>
    </div>
    {!enabled && <p className="muted">로그인 후 원본을 전사할 수 있어요.</p>}
    {enabled && transcript.configured === false && <p className="muted">전체 영상 전사 저장소와 작업 서버가 아직 연결되지 않았어요.</p>}
    {!transcript.supported && <p className="field-error">최대 4GiB·10시간의 MP4·MOV 파일 원본으로 등록해 주세요.</p>}
    {source ? <p className="muted">{source.filename} · 서버 원본 연결됨</p> : <p className="muted">{transcript.selectedFile ? `${transcript.selectedFile.name} · ${formatSize(transcript.selectedFile.size)}` : '등록한 원본 파일 · 최대 4GiB·10시간'}</p>}
    {['preparing', 'upload'].includes(operation ?? '') && <div className="transcript-progress" role="status">
      {operation === 'upload' && transcript.selectedFile ? <><span>원본 업로드 · {formatSize(transcript.uploadedBytes)} / {formatSize(transcript.selectedFile.size)}</span><progress aria-label="전사 원본 업로드 진행" value={transcript.uploadedBytes} max={transcript.selectedFile.size} /></> : <span>원본 영상 확인 중…</span>}
      <button type="button" className="text-link" onClick={transcript.stopUpload}>원본 전송 중단</button>
    </div>}
    {job && <div className="transcript-progress">
      <strong role="status">{labels[job.state]}</strong>
      <span>{formatTime(job.processedSeconds)} / {formatTime(job.duration)} 처리 · {job.completedChunks} / {job.totalChunks} 구간 · 전사 {job.segmentCount.toLocaleString()}개</span>
      <progress aria-label="전체 영상 전사 진행" max={job.duration} value={job.processedSeconds} />
      {active && <button type="button" className="text-link" disabled={busy || job.state === 'cancelling'} onClick={() => void transcript.cancel()}>전체 전사 중단</button>}
      {resumableTranscriptionJob(job) && <button type="button" className="btn secondary" disabled={disabled} onClick={() => void transcript.resume()}>저장된 지점부터 전사 재개</button>}
      {job.error && <p className="field-error">{job.error.message}</p>}
    </div>}
    {active && <p className="muted">이 창을 닫아도 서버 전사는 계속됩니다. 처리된 구간부터 읽을 수 있으며 맥락 검토는 전체 완료 후 사용할 수 있어요.</p>}
    {transcript.notice && <p className="muted" role="status">{transcript.notice}</p>}
    {transcript.error && <p className="field-error" role="alert">{transcript.error}</p>}
    {job && job.completedChunks > 0 && <div className="transcript-navigation">
      <div className="transcript-analysis-actions">
        <button type="button" className="text-link" disabled={transcript.windowStart === 0 || transcript.windowLoading} onClick={() => transcript.selectTime(transcript.windowStart - TRANSCRIPTION_CHUNK_SECONDS)}>이전 전사 구간</button>
        <span>{formatTime(transcript.windowStart)} – {formatTime(Math.min(transcript.windowStart + TRANSCRIPTION_CHUNK_SECONDS, job.duration))}</span>
        <button type="button" className="text-link" disabled={transcript.windowStart + TRANSCRIPTION_CHUNK_SECONDS >= job.duration || transcript.windowLoading} onClick={() => transcript.selectTime(transcript.windowStart + TRANSCRIPTION_CHUNK_SECONDS)}>다음 전사 구간</button>
      </div>
      <form className="transcript-analysis-actions" onSubmit={event => { event.preventDefault(); const seconds = Number(position); if (Number.isFinite(seconds)) transcript.selectTime(seconds); }}>
        <label>확인 위치(초)<input type="number" min="0" max={job.duration} step="1" aria-label="전사 결과 확인 초" value={position} onChange={event => setPosition(event.target.value)} /></label>
        <button type="submit" className="text-link" disabled={transcript.windowLoading}>구간 이동</button>
      </form>
      {transcript.windowLoading ? <p role="status">전사 구간 불러오는 중…</p> : transcript.windowStart >= job.processedSeconds && job.state !== 'completed' ? <p className="muted">이 구간의 전사는 아직 처리 중이에요.</p> : !transcript.windowItems.length && <p className="muted">이 구간에서 인식된 발화가 없어요.</p>}
    </div>}
    {transcript.pageCount > 1 && <div className="transcript-analysis-actions transcript-pages" aria-label="전사 목록 페이지">
      <button type="button" className="text-link" disabled={transcript.page === 0} onClick={() => transcript.setPage(transcript.page - 1)}>이전 전사 목록</button>
      <span>{transcript.page + 1} / {transcript.pageCount} 페이지 · 한 번에 최대 100개</span>
      <button type="button" className="text-link" disabled={transcript.page + 1 >= transcript.pageCount} onClick={() => transcript.setPage(transcript.page + 1)}>다음 전사 목록</button>
    </div>}
  </section>;
}
