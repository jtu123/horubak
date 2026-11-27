import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Crosshair, RefreshCw, Upload } from 'lucide-react';
import type { Clip, Project } from '../types';
import { formatSize, formatTime, validateVideo } from '../lib';
import { readVideoDuration } from '../video-metadata';
import { fullTrackingApi, requireJobSource, uploadResumable } from '../services/full-tracking';
import { activeTrackingJob, MAX_FULL_SOURCE_SECONDS, resumableTrackingJob, sameStoredSource, trackingWindowStart } from '../full-tracking-model';
import type { FullJob, FullSource, FullTrackingWindow, UploadSession } from '../full-tracking-model';
import { TrackingOverlay } from './TrackingOverlay';
import '../styles/tracking.css';

type Operation = 'preparing' | 'upload' | 'start' | 'cancel' | 'resume' | 'save' | null;
interface Remote { key: string; source: FullSource | null; upload: UploadSession | null; job: FullJob | null }
interface SelectedFile { key: string; file: File; url: string }
const failure = (error: unknown) => error instanceof Error ? error.message : '전체 추적 정보를 확인하지 못했어요.';
const JOB_LABELS = { queued: '분석 대기', running: '전체 영상 추적 중', cancelling: '분석 중단 중', cancelled: '분석 중단됨', interrupted: '실행이 중단됐어요', failed: '분석 실패', completed: '전체 영상 추적 완료' };

export function TrackingPanel({ project, clip, enabled, ownerId, videoUrl, onSourceReady }: {
  project: Project; clip: Clip; enabled: boolean; ownerId?: string; videoUrl?: string; onSourceReady?: (uploadId: string) => void;
}) {
  const key = JSON.stringify([ownerId, project.id, project.source, project.sourceName, project.duration, project.fileSize, project.sourceUrl, project.sportsSampleId]);
  const active = useRef(key); active.current = key;
  const action = useRef<AbortController | null>(null); const actionVersion = useRef(0);
  const video = useRef<HTMLVideoElement>(null); const viewport = useRef<HTMLDivElement>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [remote, setRemote] = useState<Remote>({ key, source: null, upload: null, job: null });
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [record, setRecord] = useState<{ key: string; data: FullTrackingWindow } | null>(null);
  const [operation, setOperation] = useState<Operation>(null);
  const [loading, setLoading] = useState(false); const [windowLoading, setWindowLoading] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [uploadedBytes, setUploadedBytes] = useState(0); const [reload, setReload] = useState(0);
  const [time, setTime] = useState(clip.edit.start); const [windowStart, setWindowStart] = useState(trackingWindowStart(clip.edit.start, project.duration));
  const [dimensions, setDimensions] = useState({ width: 0, height: 0, videoWidth: 0, videoHeight: 0 });
  const source = remote.key === key ? remote.source : null;
  const job = remote.key === key ? remote.job : null;
  const currentFile = selected?.key === key ? selected : null;
  const windowKey = `${key}:${job?.id ?? ''}:${source?.generation ?? ''}:${windowStart}`;
  const currentWindowKey = useRef(windowKey); currentWindowKey.current = windowKey;
  const data = record?.key === windowKey ? record.data : null;
  const result = data?.result ?? null;
  const busy = operation !== null;
  const supported = Number.isFinite(project.duration) && project.duration > 0 && project.duration <= MAX_FULL_SOURCE_SECONDS && project.source !== 'url';
  const serverPlayback = source ? `/api/projects/${encodeURIComponent(project.id)}/source?version=${encodeURIComponent(source.uploadId)}` : undefined;
  const playback = serverPlayback ?? currentFile?.url ?? videoUrl;
  const verified = enabled && !!source && !!job && !!data && sameStoredSource(source, data.job.source) && sameStoredSource(source, job.source);
  const canSelect = verified && !!result && !busy && !windowLoading;

  useEffect(() => {
    const abort = new AbortController(); const requestKey = key;
    action.current?.abort(); actionVersion.current += 1;
    setRemote({ key, source: null, upload: null, job: null }); setRecord(null); setSelected(null);
    setConfigured(null); setOperation(null); setError(''); setNotice(''); setUploadedBytes(0); setLoading(enabled);
    setTime(clip.edit.start); setWindowStart(trackingWindowStart(clip.edit.start, project.duration));
    if (enabled) void (async () => {
      const ready = await fullTrackingApi.configured(abort.signal);
      if (abort.signal.aborted || active.current !== requestKey) return;
      setConfigured(ready); if (!ready) return;
      const [original, latest] = await Promise.all([fullTrackingApi.source(project.id, abort.signal), fullTrackingApi.latest(project.id, abort.signal)]);
      if (abort.signal.aborted || active.current !== requestKey) return;
      if (original.source && latest) requireJobSource(latest, original.source);
      setRemote({ key: requestKey, ...original, job: latest });
      if (original.source) onSourceReady?.(original.source.uploadId);
    })().catch(reason => { if (!abort.signal.aborted && active.current === requestKey) setError(failure(reason)); })
      .finally(() => { if (!abort.signal.aborted && active.current === requestKey) setLoading(false); });
    return () => { abort.abort(); action.current?.abort(); actionVersion.current += 1; };
  }, [key, enabled, project.id, reload]);
  useEffect(() => () => { if (selected) URL.revokeObjectURL(selected.url); }, [selected]);
  useEffect(() => {
    const element = viewport.current; if (!element) return;
    const measure = () => { const rect = element.getBoundingClientRect(); setDimensions(old => ({ ...old, width: rect.width, height: rect.height })); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!enabled || !job || !source || !activeTrackingJob(job) || ['start', 'cancel', 'resume'].includes(operation ?? '')) return;
    const abort = new AbortController(); const requestKey = key; const jobId = job.id; const original = source;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await fullTrackingApi.status(project.id, jobId, abort.signal); requireJobSource(next, original);
        if (!abort.signal.aborted && active.current === requestKey) setRemote(current => current.key === requestKey && current.job?.id === jobId ? { ...current, job: next } : current);
      } catch (reason) { if (!abort.signal.aborted && active.current === requestKey) setError(failure(reason)); }
      if (!abort.signal.aborted) timer = setTimeout(() => void poll(), 2500);
    };
    timer = setTimeout(() => void poll(), 1500);
    return () => { abort.abort(); clearTimeout(timer); };
  }, [key, enabled, project.id, job?.id, job?.state, source?.generation, operation]);

  useEffect(() => {
    if (operation === 'save' || record?.key === windowKey && record.data.state === 'ready') return;
    setRecord(null); setWindowLoading(false);
    if (!enabled || !job || !source || !job.completedChunks) return;
    const abort = new AbortController(); const requestKey = key; const expected = windowKey; const original = source;
    setWindowLoading(true);
    void fullTrackingApi.window(project.id, job.id, windowStart, abort.signal).then(next => {
      requireJobSource(next.job, original);
      if (!abort.signal.aborted && active.current === requestKey && currentWindowKey.current === expected) setRecord({ key: expected, data: next });
    }).catch(reason => { if (!abort.signal.aborted && active.current === requestKey && currentWindowKey.current === expected) setError(failure(reason)); })
      .finally(() => { if (!abort.signal.aborted && active.current === requestKey && currentWindowKey.current === expected) setWindowLoading(false); });
    return () => abort.abort();
  }, [key, enabled, project.id, job?.id, job?.completedChunks, source?.generation, windowStart, operation]);

  const begin = (next: Operation) => {
    action.current?.abort(); const abort = new AbortController(); action.current = abort;
    const version = ++actionVersion.current; const requestKey = key;
    setOperation(next); setError(''); setNotice('');
    return { abort, current: () => !abort.signal.aborted && active.current === requestKey && actionVersion.current === version };
  };
  const selectFile = async (file: File) => {
    const request = begin('preparing');
    setSelected(null); setUploadedBytes(0);
    try {
      const invalid = validateVideo(file); if (invalid) throw new Error(invalid);
      if (file.name.normalize('NFC') !== project.sourceName.normalize('NFC') || project.fileSize && file.size !== project.fileSize) throw new Error('프로젝트에 등록한 원본과 이름·크기가 같은 파일을 선택해 주세요.');
      const duration = await readVideoDuration(file, request.abort.signal);
      if (Math.abs(duration - project.duration) > .5) throw new Error('등록한 영상과 길이가 달라요. 같은 원본을 선택해 주세요.');
      if (request.current()) { setSelected({ key, file, url: URL.createObjectURL(file) }); setUploadedBytes(0); }
    } catch (reason) { if (request.current()) setError(failure(reason)); }
    finally { if (request.current()) setOperation(null); }
  };
  const start = async () => {
    if (!enabled || !configured || !supported || busy || loading || activeTrackingJob(job) || !source && !currentFile) return;
    const request = begin(source ? 'start' : 'upload');
    try {
      let original = source;
      if (!original) {
        const file = currentFile!.file;
        let upload = remote.key === key ? remote.upload : null;
        if (!upload || Date.parse(upload.expiresAt) <= Date.now()) upload = await fullTrackingApi.init(project.id, file, request.abort.signal);
        if (!request.current()) return;
        setRemote(current => current.key === key ? { ...current, upload } : current);
        await uploadResumable(file, upload, request.abort.signal, bytes => { if (request.current()) setUploadedBytes(bytes); });
        original = await fullTrackingApi.complete(project.id, upload.uploadId, request.abort.signal);
        if (!request.current()) return;
        setRemote(current => current.key === key ? { ...current, source: original, upload: null, job: null } : current);
        onSourceReady?.(original.uploadId);
        setOperation('start');
      }
      const next = await fullTrackingApi.create(project.id, request.abort.signal); requireJobSource(next, original);
      if (request.current()) { setRemote(current => current.key === key ? { ...current, source: original, job: next } : current); setNotice('원본 전체 추적을 시작했어요. 이 창을 닫아도 서버 작업은 계속됩니다.'); }
    } catch (reason) { if (request.current()) setError(failure(reason)); }
    finally { if (request.current()) setOperation(null); }
  };
  const changeJob = async (kind: 'cancel' | 'resume') => {
    if (!job || !source || busy) return;
    const request = begin(kind);
    try {
      const next = await fullTrackingApi[kind](project.id, job.id, request.abort.signal); requireJobSource(next, source);
      if (request.current()) { setRemote(current => current.key === key ? { ...current, job: next } : current); setNotice(kind === 'cancel' ? '서버에 중단을 요청했어요. 영상 처리 종료를 확인하고 있습니다.' : '저장된 지점부터 전체 추적을 이어갑니다.'); }
    } catch (reason) { if (request.current()) setError(failure(reason)); }
    finally { if (request.current()) setOperation(null); }
  };
  const choose = async (sceneId: string, trackId: string | null) => {
    if (!canSelect || !data || !source) return;
    const expected = windowKey; const request = begin('save');
    try {
      const selections = await fullTrackingApi.select(project.id, data, sceneId, trackId, request.abort.signal);
      if (request.current() && currentWindowKey.current === expected) { setRecord({ key: expected, data: { ...data, selections } }); setNotice('주요 대상을 저장했어요. 자동 크롭은 별도 기능입니다.'); }
    } catch (reason) { if (request.current()) setError(failure(reason)); }
    finally { if (request.current()) setOperation(null); }
  };
  const seek = (value: number) => {
    const duration = source?.duration ?? project.duration;
    const next = Math.max(0, Math.min(Number.isFinite(value) ? value : 0, duration - .001));
    if (video.current) { video.current.pause(); video.current.currentTime = next; }
    setTime(next); setWindowStart(trackingWindowStart(next, duration, job?.chunkSeconds));
  };

  return <section className="tracking-panel" aria-label="주요 피사체 추적">
    <div className="control-title"><h3>주요 피사체 추적</h3><span className="tiny-tag">원본 전체</span></div>
    <p className="tracking-help">처음부터 끝까지 대상을 추적하고, 재생 위치에 맞춰 관측 결과를 보여줍니다.</p>
    {!enabled && <p className="tracking-note">로그인 후 전체 추적과 결과 저장을 사용할 수 있어요.</p>}
    {enabled && configured === false && <p className="tracking-note">전체 영상 추적 서버가 아직 연결되지 않았어요. 서버 설정 후 사용할 수 있습니다.</p>}
    {!supported && <p className="field-error">최대 10시간의 MP4·MOV 원본 파일로 등록해 주세요. 영상 주소만 등록한 프로젝트는 파일 등록이 필요합니다.</p>}
    {source ? <p className="tracking-file-name"><Check size={13} />{source.filename} · 서버 원본 연결됨</p> : <>
      <label className="tracking-file-label">등록한 원본 파일<input type="file" accept="video/mp4,video/quicktime,.mp4,.mov" aria-label="피사체 분석 원본 파일" disabled={!enabled || busy || loading || !supported || configured !== true}
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void selectFile(file); }} /></label>
      {currentFile && <p className="tracking-file-name">{currentFile.file.name} · {formatSize(currentFile.file.size)}</p>}
      <p className="tracking-help">추적을 시작하면 원본을 비공개 저장소에 올립니다. 연결이 끊기면 같은 파일로 이어 올릴 수 있어요.</p>
    </>}
    <p className="tracking-help">최대 4GB · 10시간 · 4K 지원 · 원본 전체 분석</p>
    {operation === 'preparing' && <p role="status">원본 영상 확인 중…</p>}
    {operation === 'upload' && currentFile && <div className="tracking-progress" role="status"><span>원본 업로드 · {formatSize(uploadedBytes)} / {formatSize(currentFile.file.size)}</span><progress aria-label="원본 업로드 진행" max={currentFile.file.size} value={uploadedBytes} />
      <button type="button" className="text-link" onClick={() => { action.current?.abort(); actionVersion.current += 1; setOperation(null); setNotice('업로드를 중단했어요. 같은 파일로 이어 올릴 수 있어요.'); }}>업로드 중단</button></div>}
    {!resumableTrackingJob(job) && <button type="button" className="btn primary full" disabled={!enabled || configured !== true || !supported || busy || loading || activeTrackingJob(job) || !source && !currentFile} onClick={() => void start()}>
      {source ? <Crosshair size={15} /> : <Upload size={15} />}{operation === 'upload' ? '원본 업로드 중…' : operation === 'start' ? '전체 추적 시작 중…' : job?.state === 'completed' ? '전체 영상 다시 추적' : source ? '전체 영상 추적 시작' : '원본 업로드 후 전체 추적'}</button>}
    <div className="tracking-result-heading"><span>{loading ? '작업 불러오는 중…' : job ? JOB_LABELS[job.state] : '저장된 추적 작업 없음'}</span>
      <button type="button" className="icon-button" aria-label="피사체 결과 다시 불러오기" disabled={!enabled || busy || loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={14} /></button></div>
    {job && <div className="tracking-progress" role="status"><span>{formatTime(job.processedSeconds)} / {formatTime(job.duration)} 처리 · {job.completedChunks}/{job.totalChunks} 구간</span>
      <progress aria-label="전체 영상 추적 진행" max={job.duration} value={job.processedSeconds} />
      {job.state === 'queued' && <small>순서가 되면 서버에서 분석을 시작합니다.</small>}
      {job.state === 'running' && !job.completedChunks && <small>원본을 확인하거나 첫 구간을 분석 중입니다.</small>}
      {job.state === 'cancelling' && <small>영상 처리 프로그램의 종료를 확인하고 있습니다.</small>}
      {job.error && <p className="field-error">{job.error.message}</p>}
      {activeTrackingJob(job) && <button type="button" className="btn secondary" disabled={busy || job.state === 'cancelling'} onClick={() => void changeJob('cancel')}>전체 추적 중단</button>}
      {resumableTrackingJob(job) && <button type="button" className="btn primary full" disabled={busy} onClick={() => void changeJob('resume')}>저장된 지점부터 재개</button>}
    </div>}
    {error && <p className="field-error" role="alert">{error}</p>}{notice && <p className="tracking-note" role="status">{notice}</p>}
    <div className="tracking-viewport" ref={viewport}>
      {playback ? <video ref={video} src={playback} controls muted playsInline preload="metadata" aria-label="피사체 추적 원본 전체 보기"
        onLoadedMetadata={event => { const element = event.currentTarget; element.currentTime = Math.min(time, Math.max(0, element.duration - .001)); setDimensions(old => ({ ...old, videoWidth: element.videoWidth, videoHeight: element.videoHeight })); }}
        onTimeUpdate={event => { const next = event.currentTarget.currentTime; setTime(next); setWindowStart(trackingWindowStart(next, source?.duration ?? project.duration, job?.chunkSeconds)); }}
        onError={() => setError('원본을 재생하지 못했어요. 결과를 다시 불러오거나 원본 연결 상태를 확인해 주세요.')} /> : <span>원본 전체 보기</span>}
      {verified && result && <TrackingOverlay result={result} selections={data!.selections} time={time} {...dimensions} disabled={!canSelect} onSelect={(sceneId, trackId) => void choose(sceneId, trackId)} />}
    </div>
    <p className="tracking-time">원본 {formatTime(time)} / {formatTime(source?.duration ?? project.duration)}</p>
    {source && <div className="tracking-window-nav"><button type="button" className="icon-button" aria-label="이전 추적 구간" disabled={windowStart <= 0} onClick={() => seek(Math.max(0, windowStart - (job?.chunkSeconds ?? 60)))}><ChevronLeft size={15} /></button>
      <label>확인 위치(초)<input type="number" min="0" max={source.duration} step="1" aria-label="피사체 결과 확인 초" value={Math.round(time)} onChange={event => seek(Number(event.target.value))} /></label>
      <button type="button" className="icon-button" aria-label="다음 추적 구간" disabled={windowStart + (job?.chunkSeconds ?? 60) >= source.duration} onClick={() => seek(windowStart + (job?.chunkSeconds ?? 60))}><ChevronRight size={15} /></button></div>}
    {windowLoading && <p className="tracking-help" role="status">현재 위치의 추적 결과를 불러오는 중…</p>}
    {job && !windowLoading && !result && <p className="tracking-help">이 위치의 결과가 아직 없어요. 처리된 위치의 결과는 분석 중에도 확인할 수 있습니다.</p>}
    {verified && result && <>
      <p className="tracking-help">{formatTime(result.range.start)}–{formatTime(result.range.end)} · {result.tracks.length}개 대상 · 이 구간에서 관측한 대상 선택</p>
      {!result.tracks.length && <p className="tracking-note">이 구간은 처리했지만 지원하는 피사체를 찾지 못했어요.</p>}
      <div className="tracking-scenes">{result.scenes.map(scene => {
        const tracks = result.tracks.filter(track => track.sceneId === scene.id); const selectedTrack = data!.selections.find(item => item.sceneId === scene.id)?.trackId;
        return <fieldset key={scene.id}><legend>장면 {scene.id} · {formatTime(scene.start)}–{formatTime(scene.end)}</legend>
          <label className="tracking-radio"><input type="radio" name={`tracking-${scene.id}`} checked={!selectedTrack} disabled={!canSelect} onChange={() => void choose(scene.id, null)} />선택 안 함</label>
          {tracks.map(track => <div className="tracking-track" key={track.id}><label className="tracking-radio"><input type="radio" name={`tracking-${scene.id}`} checked={selectedTrack === track.id} disabled={!canSelect} onChange={() => void choose(scene.id, track.id)} />
            <span>{track.label} · {track.id}<small>{formatTime(track.start)}–{formatTime(track.end)}{result.recommendations.some(item => item.trackId === track.id) ? ' · 추천' : ''}</small></span></label>
            <button type="button" className="text-link" onClick={() => seek(track.start)} aria-label={`${track.id} 처음 관측 재생`}>보기</button></div>)}
        </fieldset>;
      })}</div>
      {operation === 'save' && <p role="status">주요 대상 선택 저장 중…</p>}
      {result.warnings.length > 0 && <details className="tracking-warnings"><summary>분석 안내 {result.warnings.length}개</summary><ul>{result.warnings.map((warning, index) => <li key={index}>{warning.message}</li>)}</ul></details>}
      <p className="tracking-help">가림·작은 대상·빠른 움직임은 놓칠 수 있어요. 관측 공백에는 상자를 표시하지 않습니다. 선택은 자동 저장되며 자동 크롭은 별도 기능입니다.</p>
    </>}
  </section>;
}
