import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Download, FileJson, FileText, Film, Info, Layers3, PencilLine } from 'lucide-react';
import { useWorkspace } from '../store';
import { getProjectTranscript } from '../data';
import { getActiveClip, getProjectClips } from '../workspace-model';
import { buildSrt, downloadText, formatTime } from '../lib';
import { describeProject } from '../project-presentation';
import { VideoPreview } from '../components/VideoPreview';
import { getOutputProfile } from '../output-profile';
import '../styles/editor-v3.css';

export function Results() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { projects, notify, videos, storageError: localError, selectClip, serverAuth, user, syncStatus } = useWorkspace();
  const storageError = localError || ["error", "conflict"].includes(syncStatus);
  const storagePlace = serverAuth && !user?.guest ? (syncStatus === "saving" ? "서버 저장 중" : "서버 DB") : "현재 브라우저";
  const project = projects.find(item => item.id === id);
  const clips = project ? getProjectClips(project) : [];
  const clip = clips.find(item => item.id === params.get('clip')) ?? (project ? getActiveClip(project) : undefined);
  const [time, setTime] = useState(clip?.edit.start ?? 0);
  const [playing, setPlaying] = useState(false);
  const onTime = useCallback((value: number) => setTime(value), []);
  const onPlaying = useCallback((value: boolean) => setPlaying(value), []);
  useEffect(() => { setPlaying(false); setTime(clip?.edit.start ?? 0); }, [id, clip?.id]);
  useEffect(() => { if (project && clip && project.activeClipId !== clip.id) selectClip(project.id, clip.id); }, [project?.id, project?.activeClipId, clip?.id, selectClip]);
  if (!project) return <div className="empty-state"><h1>프로젝트를 찾을 수 없어요</h1><Link className="btn primary" to="/projects">프로젝트 목록</Link></div>;
  if (!clip) return <div className="v3-hub-empty"><Layers3 size={32} /><h1>확인할 클립이 없어요</h1><p>프로젝트에서 클립을 먼저 만들어주세요.</p><Link className="btn primary" to={'/projects/' + project.id}>프로젝트로<ArrowRight size={15} /></Link></div>;
  const edit = clip.edit;
  const profile = getOutputProfile(edit.aspectRatio);
  const info = describeProject(project, edit, !!videos[project.id]);
  const transcript = getProjectTranscript(project);
  const sampleSrt = info.canDownloadSrt ? buildSrt(transcript, edit) : '';
  const canSrt = sampleSrt.length > 0;
  const srtDescription = canSrt ? 'SRT · 샘플 전사 기준' : !transcript.length ? '전사 없음 · 생성 불가'
    : info.canDownloadSrt ? '선택 구간 내 발화 없음' : '클립 구간을 확인해 주세요';
  const editorPath = '/projects/' + project.id + '/editor?clip=' + encodeURIComponent(clip.id);
  const json = () => {
    if (!info.canDownloadJson) return;
    const { showSafeArea: _previewGuide, ...outputEdit } = edit;
    downloadText(clip.title + '_edit.json', JSON.stringify({ schemaVersion: 2, dataMode: 'frontend-demo', projectId: project.id, clipId: clip.id, clipTitle: clip.title, sourceName: project.sourceName, timeBase: 'source_seconds', contentProfile: project.contentProfile, legacyGenre: project.genre, edit: { ...outputEdit, aspectRatio: profile.ratio }, target: { width: profile.width, height: profile.height, videoCodec: 'h264', audioCodec: 'aac' }, rendered: false }, null, 2), 'application/json;charset=utf-8');
    notify('이 클립의 편집 정보를 내려받았어요', 'JSON은 영상 파일이 아닙니다.');
  };
  const srt = () => {
    if (!canSrt) return;
    downloadText(clip.title + '_sample.srt', sampleSrt, 'application/x-subrip;charset=utf-8');
    notify('이 클립 구간의 샘플 자막을 내려받았어요');
  };
  return <div className="results-page v3-results">
    <Link to={'/projects/' + project.id + '?tab=clips'} className="back-link"><ArrowLeft size={15} />내 클립</Link>
    <div className="v3-result-heading"><div><span className="v3-eyebrow">편집 결과</span><h1>{clip.title}</h1><p>{project.title}</p></div><span className="v3-result-state"><FileJson size={15} />편집 정보</span></div>
    <div className="results-layout"><div className="results-preview"><div className="v3-panel-caption"><h2>미리보기</h2><span>영상 합성 전</span></div><VideoPreview project={project} edit={edit} time={time} playing={playing} onTime={onTime} onPlaying={onPlaying} /></div>
      <section className="results-card"><div className="v3-output-heading"><h2>다운로드</h2><span className="tiny-tag">브라우저 데모</span></div><div className="result-tags"><span>{formatTime(edit.end - edit.start)}</span><span>{profile.ratio}</span><span>{info.sourceLabel}</span></div><div className="result-facts"><span>원본 구간<b>{formatTime(edit.start)} — {formatTime(edit.end)}</b></span><span>출력 목표<b>{profile.width} × {profile.height}</b></span><span>맥락 보정<b>{edit.contextApplied ? '확인 후 적용' : '미적용'}</b></span><span>저장 위치<b>{storageError ? '저장 실패' : storagePlace}</b></span><span>MP4 영상<b>출력 연결 전</b></span></div>
        {info.rangeIssue && <p className="field-error" role="alert">{info.rangeIssue} 편집 화면에서 수정해 주세요.</p>}
        <div className="download-list"><button onClick={json} disabled={!info.canDownloadJson}><span className="download-icon"><FileJson size={19} /></span><span><b>편집 정보</b><small>JSON · 선택한 클립</small></span><Download size={17} /></button><button onClick={srt} disabled={!canSrt}><span className="download-icon"><FileText size={19} /></span><span><b>샘플 자막</b><small>{srtDescription}</small></span><Download size={17} /></button><div className="download-unavailable"><span className="download-icon"><Film size={19} /></span><span><b>MP4 영상</b><small>렌더 서버 연결 전</small></span><span className="tiny-tag">미연결</span></div></div>
        <div className="v3-inline-note"><Info size={15} /><span>영상 출력은 연결 전입니다.</span></div><div className="result-actions"><Link className="btn secondary" to={editorPath}><PencilLine size={15} />다시 편집</Link><Link className="btn primary" to={'/projects/' + project.id + '?tab=clips'}>내 클립<ArrowRight size={15} /></Link></div>
      </section>
    </div>
  </div>;
}
