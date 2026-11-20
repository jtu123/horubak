import { useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import type { useProjectTranscript } from '../services/useProjectTranscript';
import './transcript-analysis.css';

export function TranscriptAnalysis({ project, videoUrl, enabled, ownerId, transcript }: {
  project: Project;
  videoUrl?: string;
  enabled: boolean;
  ownerId?: string;
  transcript: ReturnType<typeof useProjectTranscript>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const projectKey = `${ownerId ?? ''}:${project.id}`;
  const currentProject = useRef(projectKey); currentProject.current = projectKey;
  const preparingAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    currentProject.current = projectKey; setError(''); setPreparing(false);
    return () => { currentProject.current = ''; preparingAbort.current?.abort(); };
  }, [projectKey]);
  if (project.source === 'sample') return null;
  const busy = transcript.analyzing || preparing || transcript.loading;
  const analyze = async (file?: File) => {
    const projectId = projectKey;
    setError('');
    if (!file && !videoUrl && !project.sourceUploaded) { input.current?.click(); return; }
    setPreparing(true);
    preparingAbort.current?.abort();
    const abort = new AbortController(); preparingAbort.current = abort;
    try {
      if (project.fileSize && project.fileSize > 25 * 1024 * 1024) throw new Error('데모 전사는 25MiB 이하의 원본을 지원해요.');
      if (!file) {
        const source = videoUrl?.startsWith('blob:') ? videoUrl : project.sourceUploaded ? `/api/projects/${encodeURIComponent(project.id)}/source` : null;
        if (!source) { input.current?.click(); return; }
        const response = await fetch(source, { credentials: 'same-origin', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]) });
        if (!response.ok) throw new Error('원본을 불러오지 못했어요. 원본 파일을 다시 선택해 주세요.');
        const blob = await response.blob();
        file = new File([blob], project.sourceName, { type: blob.type });
      }
      if (!abort.signal.aborted && currentProject.current === projectId) await transcript.analyze(file);
    } catch (reason) {
      if (currentProject.current === projectId) setError(reason instanceof Error ? reason.message : '원본을 연결하지 못했어요.');
    } finally { if (currentProject.current === projectId) setPreparing(false); }
  };
  return <div className="transcript-analysis" aria-busy={busy}>
    <input ref={input} className="sr-only" type="file" accept="video/*,audio/*" aria-label="전사할 원본 파일" disabled={busy || !enabled} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void analyze(file); }} />
    <div className="transcript-analysis-actions"><button type="button" className="btn secondary" disabled={busy || !enabled} onClick={() => void analyze()}>{transcript.analyzing ? '한국어 전사 중…' : preparing ? '원본 준비 중…' : transcript.loading ? '전사 불러오는 중…' : transcript.items.length ? '전사 다시 생성' : '한국어 전사 시작'}</button><button type="button" className="text-link" disabled={busy || !enabled} onClick={transcript.reload}>다시 불러오기</button></div>
    {!enabled && <p className="muted">로그인 후 원본을 전사할 수 있어요.</p>}
    {transcript.analyzing && <p className="muted" role="status">영상 길이에 따라 시간이 걸려요. 완료될 때까지 이 화면을 유지해 주세요.</p>}
    {(error || transcript.error) && <p className="field-error" role="alert">{error || transcript.error}</p>}
    {!busy && !transcript.items.length && !error && !transcript.error && <p className="muted">등록한 원본 파일 · 25MiB 이하</p>}
  </div>;
}
