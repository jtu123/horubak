import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project, Utterance } from '../types';
import { analysisApi } from './analysis';
import { getProjectTranscript } from '../data';
import { ApiError } from './api';
import { fullTrackingApi, uploadResumable } from './full-tracking';
import { fullTranscriptionApi, requireTranscriptionSource, watchTranscriptionJob } from './full-transcription';
import { sourceUploadKey, withSourceUpload } from './source-upload';
import { MAX_FULL_SOURCE_BYTES, MAX_FULL_SOURCE_SECONDS, trackingWindowStart } from '../full-tracking-model';
import type { FullSource, UploadSession } from '../full-tracking-model';
import { activeTranscriptionJob, TRANSCRIPT_PAGE_SIZE, TRANSCRIPTION_CHUNK_SECONDS } from '../full-transcription-model';
import type { FullTranscriptionJob, FullTranscriptionWindow } from '../full-transcription-model';
import { validateVideo } from '../lib';
import { readVideoDuration } from '../video-metadata';

type Operation = 'preparing' | 'upload' | 'start' | 'cancel' | 'resume' | null;
interface Remote {
  key: string; source: FullSource | null; upload: UploadSession | null; job: FullTranscriptionJob | null;
  legacy: Utterance[]; configured: boolean | null;
}
const message = (error: unknown) => error instanceof Error ? error.message : '전사 작업을 확인하지 못했어요.';
const utterances = (window: NonNullable<FullTranscriptionWindow['window']>): Utterance[] => window.segments.map(segment => ({
  id: `transcript-${window.jobId}-${segment.segmentIndex}`, start: segment.startSeconds, end: segment.endSeconds, text: segment.text, speaker: '발화',
}));
const initialRemote = (key: string): Remote => ({ key, source: null, upload: null, job: null, legacy: [], configured: null });

function matchesProject(source: FullSource, project: Project) {
  if (source.filename.normalize('NFC') !== project.sourceName.normalize('NFC') || Math.abs(source.duration - project.duration) > .5
    || project.fileSize !== undefined && source.size !== project.fileSize) throw new Error('등록한 영상과 서버 원본이 달라요. 원본을 다시 불러와 주세요.');
}

export function useProjectTranscript(project: Project | undefined, enabled: boolean, ownerId?: string, focusSeconds = 0) {
  const key = project ? sourceUploadKey(ownerId, project) : '';
  const focusedWindow = project ? trackingWindowStart(focusSeconds, project.duration, TRANSCRIPTION_CHUNK_SECONDS) : 0;
  const active = useRef(key); active.current = key;
  const action = useRef<AbortController | null>(null); const actionVersion = useRef(0);
  const operationRef = useRef<Operation>(null);
  const [remote, setRemote] = useState<Remote>(() => initialRemote(key));
  const [loading, setLoading] = useState(false); const [windowLoading, setWindowLoading] = useState(false);
  const [operation, setOperationState] = useState<Operation>(null);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [selected, setSelected] = useState<{ key: string; file: File } | null>(null);
  const [reload, setReload] = useState(0);
  const [windowStart, setWindowStart] = useState(0); const [page, setPage] = useState(0);
  const [record, setRecord] = useState<{ key: string; data: FullTranscriptionWindow } | null>(null);
  const source = remote.key === key ? remote.source : null;
  const job = remote.key === key ? remote.job : null;
  const sourceRef = useRef(source); sourceRef.current = source;
  const sample = project?.source === 'sample';
  const windowKey = JSON.stringify([key, job?.id, source?.generation, windowStart]);
  const currentWindow = useRef(windowKey); currentWindow.current = windowKey;
  const setOperation = (value: Operation) => { operationRef.current = value; setOperationState(value); };
  const selectedFile = selected?.key === key ? selected.file : undefined;
  const supported = !!project && project.source !== 'url' && project.duration > 0 && project.duration <= MAX_FULL_SOURCE_SECONDS
    && (project.fileSize === undefined || project.fileSize <= MAX_FULL_SOURCE_BYTES);

  useEffect(() => {
    const abort = new AbortController(); const requestKey = key;
    action.current?.abort(); actionVersion.current += 1;
    setRemote(initialRemote(key)); setRecord(null); setSelected(null); setError(''); setNotice(''); setUploadedBytes(0);
    setOperation(null); setLoading(enabled && !sample); setWindowLoading(false); setPage(0);
    if (project) setWindowStart(trackingWindowStart(focusSeconds, project.duration, TRANSCRIPTION_CHUNK_SECONDS));
    if (enabled && project && !sample) void (async () => {
      const configured = await fullTrackingApi.configured(abort.signal);
      let original: { source: FullSource | null; upload: UploadSession | null } = { source: null, upload: null };
      let latest: FullTranscriptionJob | null = null;
      if (configured) [original, latest] = await Promise.all([fullTrackingApi.source(project.id, abort.signal), fullTranscriptionApi.latest(project.id, abort.signal)]);
      if (original.source) { matchesProject(original.source, project); if (latest) requireTranscriptionSource(latest, original.source); }
      else if (latest) throw new Error('전사 작업의 원본을 확인하지 못했어요. 다시 불러와 주세요.');
      const legacy = latest ? [] : await analysisApi.transcript(project.id, project.duration, abort.signal).catch(reason => {
        if (reason instanceof ApiError && reason.status === 404) return [];
        throw reason;
      });
      if (!abort.signal.aborted && active.current === requestKey) setRemote({ key: requestKey, ...original, job: latest, legacy, configured });
    })().catch(reason => { if (!abort.signal.aborted && active.current === requestKey) setError(message(reason)); })
      .finally(() => { if (!abort.signal.aborted && active.current === requestKey) setLoading(false); });
    return () => { abort.abort(); action.current?.abort(); actionVersion.current += 1; };
  }, [key, enabled, sample, reload]);

  useEffect(() => {
    setWindowStart(focusedWindow); setPage(0);
  }, [key, focusedWindow]);

  useEffect(() => {
    if (!enabled || !project || !job || !source || !activeTranscriptionJob(job) || ['start', 'cancel', 'resume'].includes(operation ?? '')) return;
    const abort = new AbortController(); const requestKey = key; const version = actionVersion.current;
    void watchTranscriptionJob(project.id, job.id, source, abort.signal, next => {
      if (!abort.signal.aborted && active.current === requestKey && actionVersion.current === version) {
        setRemote(current => current.key === requestKey && current.job?.id === next.id ? { ...current, job: next } : current);
      }
    }).catch(reason => { if (!abort.signal.aborted && active.current === requestKey && actionVersion.current === version) setError(message(reason)); });
    return () => abort.abort();
  }, [key, enabled, project?.id, job?.id, job?.state, source?.generation, operation]);

  useEffect(() => {
    if (record?.key === windowKey && record.data.state === 'ready') return;
    setRecord(null); setWindowLoading(false);
    if (!enabled || !project || !job || !source || !job.completedChunks) return;
    const abort = new AbortController(); const expected = windowKey;
    setWindowLoading(true);
    void fullTranscriptionApi.window(project.id, job.id, windowStart, abort.signal).then(data => {
      requireTranscriptionSource(data.job, source);
      if (job.sourceSha256 && data.job.sourceSha256 !== job.sourceSha256) throw new Error('전사 원본의 지문이 변경됐어요. 작업을 다시 불러와 주세요.');
      if (!abort.signal.aborted && currentWindow.current === expected) setRecord({ key: expected, data });
    }).catch(reason => { if (!abort.signal.aborted && currentWindow.current === expected) setError(message(reason)); })
      .finally(() => { if (!abort.signal.aborted && currentWindow.current === expected) setWindowLoading(false); });
    return () => abort.abort();
  }, [key, enabled, project?.id, job?.id, job?.completedChunks, source?.generation, windowStart]);

  const begin = (next: Operation) => {
    action.current?.abort(); const abort = new AbortController(); action.current = abort;
    const version = ++actionVersion.current; const requestKey = key;
    setOperation(next); setError(''); setNotice('');
    return { abort, current: () => !abort.signal.aborted && active.current === requestKey && actionVersion.current === version };
  };
  const analyze = async (chosen?: File) => {
    if (!project || !enabled || sample || !supported || operationRef.current || loading || remote.configured !== true || activeTranscriptionJob(job)) return;
    const request = begin(source ? 'start' : 'preparing');
    try {
      let original = source;
      if (!original) {
        const file = chosen ?? selectedFile;
        if (!file) throw new Error('등록한 원본 파일을 선택해 주세요.');
        const invalid = validateVideo(file); if (invalid) throw new Error(invalid);
        if (file.name.normalize('NFC') !== project.sourceName.normalize('NFC') || project.fileSize !== undefined && file.size !== project.fileSize) throw new Error('프로젝트에 등록한 원본과 이름·크기가 같은 파일을 선택해 주세요.');
        const duration = await readVideoDuration(file, request.abort.signal);
        if (Math.abs(duration - project.duration) > .5) throw new Error('등록한 영상과 길이가 달라요. 같은 원본을 선택해 주세요.');
        if (!request.current()) return;
        setSelected({ key, file }); setOperation('upload');
        original = await withSourceUpload(key, request.abort.signal, async () => {
          const existing = await fullTrackingApi.source(project.id, request.abort.signal);
          if (existing.source) { matchesProject(existing.source, project); return existing.source; }
          let upload = existing.upload ?? (remote.key === key ? remote.upload : null);
          if (!upload || Date.parse(upload.expiresAt) <= Date.now()) upload = await fullTrackingApi.init(project.id, file, request.abort.signal);
          if (!request.current()) throw request.abort.signal.reason ?? new DOMException('Aborted', 'AbortError');
          setRemote(current => current.key === key ? { ...current, upload } : current);
          await uploadResumable(file, upload, request.abort.signal, bytes => { if (request.current()) setUploadedBytes(bytes); });
          return fullTrackingApi.complete(project.id, upload.uploadId, request.abort.signal);
        });
        if (!request.current()) return;
        sourceRef.current = original;
        setRemote(current => current.key === key ? { ...current, source: original, upload: null, job: null, legacy: [] } : current);
        setOperation('start');
      }
      const next = await fullTranscriptionApi.create(project.id, request.abort.signal); requireTranscriptionSource(next, original);
      if (request.current()) { setRemote(current => current.key === key ? { ...current, source: original, job: next, legacy: [] } : current); setNotice('전체 영상 전사를 시작했어요. 이 창을 닫아도 서버 작업은 계속됩니다.'); }
    } catch (reason) { if (request.current()) setError(message(reason)); }
    finally { if (request.current()) setOperation(null); }
  };
  const changeJob = async (kind: 'cancel' | 'resume') => {
    if (!project || !job || !source || !enabled || operationRef.current) return;
    const request = begin(kind);
    try {
      const next = await fullTranscriptionApi[kind](project.id, job.id, request.abort.signal); requireTranscriptionSource(next, source);
      if (request.current()) { setRemote(current => current.key === key && current.job?.id === next.id ? { ...current, job: next } : current); setNotice(kind === 'cancel' ? '서버에 전사 중단을 요청했어요.' : '저장된 지점부터 전사를 이어갑니다.'); }
    } catch (reason) { if (request.current()) setError(message(reason)); }
    finally { if (request.current()) setOperation(null); }
  };
  const stopUpload = () => {
    action.current?.abort(); actionVersion.current += 1; setOperation(null);
    setNotice('원본 전송을 중단했어요. 같은 파일로 이어 올릴 수 있습니다.');
  };
  const selectTime = (seconds: number) => {
    if (project) setWindowStart(trackingWindowStart(seconds, project.duration, TRANSCRIPTION_CHUNK_SECONDS)); setPage(0);
  };
  const syncSource = useCallback((uploadId: string) => {
    if (sourceRef.current?.uploadId !== uploadId && !operationRef.current) setReload(value => value + 1);
  }, []);
  const windowItems = useMemo(() => sample && project ? getProjectTranscript(project)
    : record?.key === windowKey && record.data.window ? utterances(record.data.window)
      : job ? [] : remote.key === key ? remote.legacy : [], [sample, project, record, windowKey, job?.id, remote.key, remote.legacy, key]);
  const items = useMemo(() => windowItems.slice(page * TRANSCRIPT_PAGE_SIZE, (page + 1) * TRANSCRIPT_PAGE_SIZE), [windowItems, page]);
  const identity = `${key}:${job?.id ?? 'legacy'}:${source?.generation ?? ''}:${job?.sourceSha256 ?? ''}`;
  const identityRef = useRef(identity); identityRef.current = identity;
  const contextItems = async (start: number, end: number, signal: AbortSignal): Promise<Utterance[]> => {
    if (!project) return [];
    if (!job) return remote.key === key ? remote.legacy : [];
    if (job.state !== 'completed' || !source) throw new Error('전체 전사가 완료된 뒤 맥락을 확인해 주세요.');
    const expected = identity;
    const first = trackingWindowStart(Math.max(0, start - 20), job.duration, TRANSCRIPTION_CHUNK_SECONDS);
    const last = trackingWindowStart(Math.min(job.duration, end + 20), job.duration, TRANSCRIPTION_CHUNK_SECONDS);
    const starts = first === last ? [first] : [first, last];
    const results: Utterance[] = [];
    for (const stamp of starts) {
      const data = await fullTranscriptionApi.window(project.id, job.id, stamp, signal); requireTranscriptionSource(data.job, source);
      if (data.job.sourceSha256 !== job.sourceSha256) throw new Error('전사 원본의 지문이 변경됐어요. 다시 검토해 주세요.');
      if (signal.aborted || identityRef.current !== expected) throw new Error('전사가 변경됐어요. 현재 구간으로 다시 확인해 주세요.');
      if (!data.window) throw new Error('전사 구간을 아직 불러오지 못했어요. 다시 요청해 주세요.');
      results.push(...utterances(data.window));
    }
    return results;
  };
  return {
    items, windowItems, loading, windowLoading, operation, error, notice, source, job, uploadedBytes, selectedFile,
    configured: remote.key === key ? remote.configured : null, supported,
    analyzing: operation === 'preparing' || operation === 'upload' || operation === 'start' || activeTranscriptionJob(job),
    contextReady: !!job ? job.state === 'completed' : windowItems.length > 0,
    identity, contextItems, analyze, cancel: () => changeJob('cancel'), resume: () => changeJob('resume'), stopUpload, syncSource,
    windowStart, selectTime, page, pageCount: Math.max(1, Math.ceil(windowItems.length / TRANSCRIPT_PAGE_SIZE)),
    setPage: (next: number) => setPage(Math.max(0, Math.min(next, Math.max(0, Math.ceil(windowItems.length / TRANSCRIPT_PAGE_SIZE) - 1)))),
    reload: () => setReload(value => value + 1),
  };
}
