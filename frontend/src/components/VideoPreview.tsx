import { useEffect, useRef, useState } from 'react';
import { FileVideo, Link2, Maximize2, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { Poster } from './Poster';
import { formatTime, validateVideo } from '../lib';
import { useWorkspace } from '../store';
import type { EditState, Project } from '../types';
import { getOutputProfile } from '../output-profile';
import { getSportsSample } from '../sports-samples';
import { clipPlaybackStart, readVideoDuration, useVideoProbe } from '../video-metadata';
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
  const probe = useVideoProbe(project.id);
  const { replaceVideoSource, videos, notify } = useWorkspace();
  if (project.source === 'sample' || project.sourceUploaded) return null;
  const reconnect = async (file: File) => {
    const signal = probe.start();
    const invalid = validateVideo(file);
    if (invalid) { notify('영상을 확인해 주세요', invalid, 'error'); return; }
    try {
      const duration = await readVideoDuration(file, signal);
      if (!signal.aborted && replaceVideoSource(project.id, file, duration)) {
        notify('원본을 연결했어요', '기존 편집 구간이 새 길이에 맞는지 확인해 주세요.');
      }
    } catch (error) {
      if (!signal.aborted) notify('원본을 연결하지 못했어요', error instanceof Error ? error.message : '다시 시도해 주세요.', 'error');
    }
  };
  return <div className="v3-source-reconnect"><button className="btn secondary" onClick={() => input.current?.click()}><Link2 size={15} />{videos[project.id] ? '원본 교체' : '원본 다시 연결'}</button><span>편집 구간과 스타일은 유지됩니다.</span><input ref={input} type="file" className="sr-only" accept="video/mp4,video/quicktime,.mp4,.mov" aria-label="원본 다시 연결" onChange={event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void reconnect(file);
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
  const loadedSample = sampleMedia?.source === sampleSource ? sampleMedia : undefined;
  const uploadedSource = project.sourceUploaded ? '/api/projects/' + encodeURIComponent(project.id) + '/source' : undefined;
  const url = videos[project.id] ?? uploadedSource ?? loadedSample?.url ?? undefined;
  const stillSample = project.source === 'sample' && !match && !url;
  const canMute = !!url && !match;
  const mediaError = error || loadedSample?.url === null;
  const profile = getOutputProfile(edit.aspectRatio);
  const invalidBounds = ![edit.start, edit.end, project.duration].every(Number.isFinite) || edit.start < 0 || edit.end <= edit.start || edit.end > project.duration;
  const togglePlayback = () => {
    if (playing) { onPlaying(false); return; }
    const node = video.current;
    const position = clipPlaybackStart(time, edit);
    const mediaTime = node ? clipPlaybackStart(node.currentTime, edit) : position;
    if (node && (mediaTime !== node.currentTime || position !== time)) node.currentTime = position;
    if (position !== time) onTime(position);
    onPlaying(true);
  };
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
      {mediaError && <div className="video-error" role="alert">영상을 재생할 수 없어요.<br />{match ? '페이지를 새로고침해 주세요.' : uploadedSource ? '로그인 상태와 영상 형식을 확인해 주세요.' : 'H.264/AAC MP4로 다시 연결해 주세요.'}</div>}
    </div><span className="aspect-label">{profile.ratio} · 자막·구도 미리보기</span></div>
    <div className="player-controls"><button className="icon-button" aria-label="구간 처음으로" onClick={() => { onTime(edit.start); if (video.current) video.current.currentTime = edit.start; }}><RotateCcw size={16} /></button><button className="play-button" aria-label={playing ? '일시 정지' : '미리보기 재생'} disabled={(!url && !stillSample) || mediaError || invalidBounds} onClick={togglePlayback}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button><span className="player-time">{formatTime(Math.max(0, time - edit.start))}<span> / {formatTime(Math.max(0, edit.end - edit.start))}</span></span><button className="icon-button" disabled={!canMute} aria-label={match ? '무음 경기 영상' : muted ? '음소거 해제' : '음소거'} aria-pressed={!!match || muted} onClick={() => setMuted(value => !value)}>{match || muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button><button className="icon-button" aria-label="미리보기 전체 화면" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void frame.current?.requestFullscreen().catch(() => {}); }}><Maximize2 size={16} /></button></div>
  </div>;
}
