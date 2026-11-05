import { useEffect, useRef, useState } from 'react';
import { FileVideo, Link2, Maximize2, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { Poster } from './Poster';
import { formatTime, validateVideo } from '../lib';
import { useWorkspace } from '../store';
import type { EditState, Project } from '../types';

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
  const url = videos[project.id];
  const sample = project.source === 'sample';
  const invalidBounds = ![edit.start, edit.end, project.duration].every(Number.isFinite) || edit.start < 0 || edit.end <= edit.start || edit.end > project.duration;
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
    if (!sample || !playing) return;
    const timer = window.setInterval(() => onTime(time + .2 >= edit.end ? edit.start : time + .2), 200);
    return () => window.clearInterval(timer);
  }, [sample, playing, time, edit.start, edit.end, onTime]);
  useEffect(() => { setError(false); }, [url]);
  useEffect(() => { if (invalidBounds) onPlaying(false); }, [invalidBounds, onPlaying]);
  return <div className="preview-player">
    <div className="preview-stage"><div className={'portrait-frame' + (edit.layout === 'full' ? ' full-frame' : '')} ref={frame}>
      <div className="preview-source" style={{ transform: 'scale(' + edit.scale + ')' }}>
        {url ? <video ref={video} src={url} muted={muted} playsInline preload="metadata" style={{ objectPosition: edit.cropX + '% ' + edit.cropY + '%' }} onLoadedMetadata={event => { event.currentTarget.currentTime = Math.min(Math.max(0, time), Math.max(0, event.currentTarget.duration - .05)); }} onTimeUpdate={event => {
          const value = event.currentTarget.currentTime;
          if (value >= edit.end && playing) { onPlaying(false); event.currentTarget.currentTime = edit.start; onTime(edit.start); }
          else onTime(value);
        }} onError={() => { setError(true); onPlaying(false); }} /> : sample ? <div className="sample-visual" style={{ transform: 'translate(' + (50 - edit.cropX) * .5 + '%, ' + (50 - edit.cropY) * .5 + '%)' }}><Poster genre={project.genre} vertical /></div> : <div className="no-video"><FileVideo size={32} /><b>원본을 연결해 주세요</b><p>이 브라우저에서 영상을 재생합니다.</p></div>}
      </div>
      <span className="preview-watermark">{sample ? '샘플 이미지' : '원본 미리보기'}</span>
      {edit.subtitleVisible && edit.subtitle && <div className="subtitle-overlay" style={{ fontSize: edit.subtitleSize + 'px', color: edit.subtitleColor }}><span>{edit.subtitle}</span></div>}
      {sample && <span className="sample-frame-tag">이미지·구간 조작 예시</span>}
      {error && <div className="video-error" role="alert">영상을 재생할 수 없어요.<br />H.264/AAC MP4로 다시 연결해 주세요.</div>}
    </div><span className="aspect-label">9:16 · 자막·구도 미리보기</span></div>
    <div className="player-controls"><button className="icon-button" aria-label="구간 처음으로" onClick={() => { onTime(edit.start); if (video.current) video.current.currentTime = edit.start; }}><RotateCcw size={16} /></button><button className="play-button" aria-label={playing ? '일시 정지' : '미리보기 재생'} disabled={(!url && !sample) || error || invalidBounds} onClick={() => onPlaying(!playing)}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button><span className="player-time">{formatTime(Math.max(0, time - edit.start))}<span> / {formatTime(Math.max(0, edit.end - edit.start))}</span></span><button className="icon-button" disabled={!url} aria-label={muted ? '음소거 해제' : '음소거'} aria-pressed={muted} onClick={() => setMuted(value => !value)}>{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button><button className="icon-button" aria-label="미리보기 전체 화면" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void frame.current?.requestFullscreen().catch(() => {}); }}><Maximize2 size={16} /></button></div>
  </div>;
}
