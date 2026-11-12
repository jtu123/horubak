import { useEffect, useRef, useState } from 'react';
import { FileVideo, Link2, Maximize2, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { Poster } from './Poster';
import { formatTime, validateVideo } from '../lib';
import { useWorkspace } from '../store';
import type { EditState, Project } from '../types';
import { getOutputProfile } from '../output-profile';
import { getSportsSample } from '../sports-samples';
import '../styles/output-profile.css';

const sampleVideos = new Map<string, Promise<Blob>>();

function loadSampleVideo(source: string): Promise<Blob> {
  const existing = sampleVideos.get(source);
  if (existing) return existing;

  // The hosted site serves whole files. A local media URL allows seeking
  // throughout the sample without depending on HTTP byte ranges.
  const request = fetch(source).then(response => {
    if (!response.ok) throw new Error('Sample video could not be loaded.');
    return response.blob();
  }).catch(error => {
    sampleVideos.delete(source);
    throw error;
  });
  sampleVideos.set(source, request);
  return request;
}

export function SourceReconnect({ project }: { project: Project }) {
  const input = useRef<HTMLInputElement>(null);
  const { attachVideo, updateProject, videos, notify } = useWorkspace();
  if (project.source === 'sample') return null;
  return <div className="v3-source-reconnect"><button className="btn secondary" onClick={() => input.current?.click()}><Link2 size={15} />{videos[project.id] ? '원본 교체' : '원본 다시 연결'}</button><span>편집 구간과 스타일은 유지됩니다.</span><input ref={input} type="file" className="sr-only" accept="video/mp4,video/quicktime,.mp4,.mov" aria-label="원본 다시 연결" onChange={event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const invalid = validateVideo(file);
    if (invalid) { notify('영상을 확인해 주세요', invalid, 'error'); return; }
    const metadata = document.createElement('video');
    const temporaryUrl = URL.createObjectURL(file);
    metadata.preload = 'metadata';
    metadata.onloadedmetadata = () => {
      const duration = Number.isFinite(metadata.duration) ? metadata.duration : 0;
      URL.revokeObjectURL(temporaryUrl);
      if (duration <= 0) { notify('영상 길이를 확인할 수 없어요', '기존 원본과 편집 정보는 유지됩니다.', 'error'); return; }
      attachVideo(project.id, file);
      updateProject(project.id, { duration, sourceName: file.name, source: 'file', fileSize: file.size });
      notify('원본을 연결했어요', '기존 편집 구간이 새 길이에 맞는지 확인해 주세요.');
    };
    metadata.onerror = () => { URL.revokeObjectURL(temporaryUrl); notify('영상을 읽을 수 없어요', '기존 원본과 편집 정보는 유지됩니다.', 'error'); };
    metadata.src = temporaryUrl;
  }} /></div>;
}

export function VideoPreview({ project, edit, time, playing, onTime, onPlaying }: {
  project: Project; edit: EditState; time: number; playing: boolean;
  onTime: (time: number) => void; onPlaying: (playing: boolean) => void;
}) {
  const { videos } = useWorkspace();
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [muted, setMuted] = useState(false);
  const [sampleMedia, setSampleMedia] = useState<{ source: string; url: string | null }>();
  const match = getSportsSample(project);
  const sampleSource = match?.videoUrl;
  const loadedSample =
  sampleMedia?.source === sampleSource
    ? sampleMedia
    : undefined;
// Spring Boot에 저장된 영상 조회 주소
  const serverVideoUrl =
  project.source === 'file'
    ? `http://localhost:8080/api/videos/projects/${project.id}`
    : undefined;
// 영상 주소 우선순위
  const url =
  videos[project.id] ??
  loadedSample?.url ??
  serverVideoUrl;

  const stillSample = project.source === 'sample' && !match && !url;
  const canMute = !!url && !match;
  const mediaError = error || loadedSample?.url === null;
  const profile = getOutputProfile(edit.aspectRatio);
  const invalidBounds = ![edit.start, edit.end, project.duration].every(Number.isFinite) || edit.start < 0 || edit.end <= edit.start || edit.end > project.duration;
  useEffect(() => {
    if (!sampleSource) return;
    let active = true;
    let objectUrl: string | undefined;
    void loadSampleVideo(sampleSource).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setSampleMedia({ source: sampleSource, url: objectUrl });
    }, () => {
      if (active) setSampleMedia({ source: sampleSource, url: null });
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sampleSource]);
  useEffect(() => {
    const node = video.current;
    if (node && Math.abs(node.currentTime - time) > .35) node.currentTime = time;
  }, [time, url]);
  useEffect(() => {
    const node = video.current;
    if (!node) return;
    if (playing) void node.play().catch(() => { onPlaying(false); setError(true); });
    else node.pause();
  }, [playing, url, onPlaying]);
  useEffect(() => {
    if (!stillSample || !playing) return;
    const timer = window.setInterval(() => onTime(time + .2 >= edit.end ? edit.start : time + .2), 200);
    return () => window.clearInterval(timer);
  }, [stillSample, playing, time, edit.start, edit.end, onTime]);
  useEffect(() => { setError(false); }, [url]);
  useEffect(() => { if (invalidBounds) onPlaying(false); }, [invalidBounds, onPlaying]);
  return <div className="preview-player">
    <div className="preview-stage"><div className={'portrait-frame output-frame' + (edit.layout === 'full' ? ' full-frame' : '')} data-aspect-ratio={profile.ratio} style={{ width: 'min(100%, calc(var(--output-frame-height) * ' + profile.width / profile.height + '))', height: 'auto', maxHeight: 'none', aspectRatio: profile.cssRatio }} ref={frame}>
      <div className="preview-source" style={{ transform: 'scale(' + edit.scale + ')' }}>
        {url ? <video ref={video} src={url} poster={match && (match.candidateThumbnails?.[edit.candidateId] ?? match.thumbnail)} muted={!!match || muted} playsInline preload="metadata" style={{ objectPosition: edit.cropX + '% ' + edit.cropY + '%' }} onLoadedMetadata={event => { event.currentTarget.currentTime = Math.min(Math.max(0, time), Math.max(0, event.currentTarget.duration - .05)); }} onTimeUpdate={event => {
          const value = event.currentTarget.currentTime;
          if (value >= edit.end && playing) { onPlaying(false); event.currentTarget.currentTime = edit.start; onTime(edit.start); }
          else onTime(value);
        }} onEnded={() => { onPlaying(false); onTime(edit.start); }} onError={() => { setError(true); onPlaying(false); }} /> : match || stillSample ? <div className="sample-visual" style={stillSample ? { transform: 'translate(' + (50 - edit.cropX) * .5 + '%, ' + (50 - edit.cropY) * .5 + '%)' } : undefined}><Poster project={project} candidateId={edit.candidateId} vertical /></div> : <div className="no-video"><FileVideo size={32} /><b>원본을 연결해 주세요</b><p>이 브라우저에서 영상을 재생합니다.</p></div>}
      </div>
      <span className="preview-watermark">{match ? '경기 샘플' : stillSample ? '샘플 이미지' : '원본 미리보기'}</span>
      {edit.subtitleVisible && edit.subtitle && <div className="subtitle-overlay" style={{ fontSize: edit.subtitleSize + 'px', color: edit.subtitleColor }}><span>{edit.subtitle}</span></div>}
      {edit.showSafeArea && <div className="preview-safe-area" aria-label="일반 안전영역 가이드"><span>일반 안전영역</span></div>}
      {stillSample && <span className="sample-frame-tag">이미지·구간 조작 예시</span>}
      {match && !url && !mediaError && <span className="sample-frame-tag" role="status">경기 영상 불러오는 중…</span>}
      
      {mediaError && (
          <div className="video-error" role="alert">
            영상을 재생할 수 없어요.
            <p>
              {match
                ? '샘플 영상을 다시 불러와 주세요.'
                : '서버 영상 등록 상태 또는 MP4 인코딩을 확인해 주세요.'}
            </p>
          </div>
      )}
  
    </div><span className="aspect-label">{profile.ratio} · 자막·구도 미리보기</span></div>
    <div className="player-controls"><button className="icon-button" aria-label="구간 처음으로" onClick={() => { onTime(edit.start); if (video.current) video.current.currentTime = edit.start; }}><RotateCcw size={16} /></button><button className="play-button" aria-label={playing ? '일시 정지' : '미리보기 재생'} disabled={(!url && !stillSample) || mediaError || invalidBounds} onClick={() => onPlaying(!playing)}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button><span className="player-time">{formatTime(Math.max(0, time - edit.start))}<span> / {formatTime(Math.max(0, edit.end - edit.start))}</span></span><button className="icon-button" disabled={!canMute} aria-label={match ? '무음 경기 영상' : muted ? '음소거 해제' : '음소거'} aria-pressed={!!match || muted} onClick={() => setMuted(value => !value)}>{match || muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button><button className="icon-button" aria-label="미리보기 전체 화면" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void frame.current?.requestFullscreen().catch(() => {}); }}><Maximize2 size={16} /></button></div>
  </div>;
}
