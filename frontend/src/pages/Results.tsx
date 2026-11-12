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
  const { projects, notify, videos, storageError, selectClip } = useWorkspace();
  const project = projects.find(item => item.id === id);
  const clips = project ? getProjectClips(project) : [];
  const clip = clips.find(item => item.id === params.get('clip')) ?? (project ? getActiveClip(project) : undefined);
  const [time, setTime] = useState(clip?.edit.start ?? 0);
  const [playing, setPlaying] = useState(false);
  const [savedClipUrl, setSavedClipUrl] = useState<string | null>(null);
  const [loadingMp4, setLoadingMp4] = useState(true);
  const onTime = useCallback((value: number) => setTime(value), []);
  const onPlaying = useCallback((value: boolean) => setPlaying(value), []);

useEffect(() => {
  if (!project?.id) {
    setSavedClipUrl(null);
    setLoadingMp4(false);
    return;
  }

  let cancelled = false;

  setLoadingMp4(true);
  setSavedClipUrl(null);

  const loadSavedMp4 = async () => {
    try {
      const response = await fetch(
        `http://localhost:8080/api/videos/projects/${project.id}/clips`
      );

      if (!response.ok) {
        throw new Error(`MP4 조회 실패 (HTTP ${response.status})`);
      }

      const savedClips: { clipFileName: string }[] =
        await response.json();

      if (cancelled) return;

      if (savedClips.length > 0) {
        const latestClip = savedClips[0];

        setSavedClipUrl(
          `http://localhost:8080/api/videos/clips/${encodeURIComponent(latestClip.clipFileName)}`
        );
      }
    } catch (error) {
      if (!cancelled) {
        console.error('저장된 MP4 조회 실패:', error);
      }
    } finally {
      if (!cancelled) {
        setLoadingMp4(false);
      }
    }
  };

  void loadSavedMp4();

  return () => {
    cancelled = true;
  };
}, [project?.id]);

  useEffect(() => { setPlaying(false); setTime(clip?.edit.start ?? 0); }, [id, clip?.id]);
  useEffect(() => { if (project && clip && project.activeClipId !== clip.id) selectClip(project.id, clip.id); }, [project?.id, project?.activeClipId, clip?.id, selectClip]);
  if (!project) return <div className="empty-state"><h1>프로젝트를 찾을 수 없어요</h1><Link className="btn primary" to="/projects">프로젝트 목록</Link></div>;
  if (!clip) return <div className="v3-hub-empty"><Layers3 size={32} /><h1>확인할 클립이 없어요</h1><p>프로젝트에서 클립을 먼저 만들어주세요.</p><Link className="btn primary" to={'/projects/' + project.id}>프로젝트로<ArrowRight size={15} /></Link></div>;
  const edit = clip.edit;
  const profile = getOutputProfile(edit.aspectRatio);
  const info = describeProject(project, edit, !!videos[project.id]);
  const transcript = getProjectTranscript(project);
  const canSrt = info.canDownloadSrt && transcript.length > 0;
  const editorPath = '/projects/' + project.id + '/editor?clip=' + encodeURIComponent(clip.id);
  const json = () => {
    if (!info.canDownloadJson) return;
    const { showSafeArea: _previewGuide, ...outputEdit } = edit;
    downloadText(clip.title + '_edit.json', JSON.stringify({ schemaVersion: 2, dataMode: 'frontend-demo', projectId: project.id, clipId: clip.id, clipTitle: clip.title, sourceName: project.sourceName, timeBase: 'source_seconds', contentProfile: project.contentProfile, legacyGenre: project.genre, edit: { ...outputEdit, aspectRatio: profile.ratio }, target: { width: profile.width, height: profile.height, videoCodec: 'h264', audioCodec: 'aac' }, rendered: false }, null, 2), 'application/json;charset=utf-8');
    notify('이 클립의 편집 정보를 내려받았어요', 'JSON은 영상 파일이 아닙니다.');
  };
  const srt = () => {
    if (!canSrt) return;
    downloadText(clip.title + '_sample.srt', buildSrt(transcript, edit), 'application/x-subrip;charset=utf-8');
    notify('이 클립 구간의 샘플 자막을 내려받았어요');
  };

const downloadMp4 = async () => {
  if (!savedClipUrl) return;

  try {
    const response = await fetch(savedClipUrl);

    if (!response.ok) {
      throw new Error(`다운로드 실패 (HTTP ${response.status})`);
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `${clip.title}_highlight.mp4`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

    notify('MP4 다운로드 완료', '영상 파일을 저장했습니다.');
  } catch (error) {
    console.error('MP4 다운로드 실패:', error);
    notify('다운로드 실패', 'MP4 파일을 가져오지 못했습니다.', 'error');
  }
};

  return <div className="results-page v3-results">
    <Link to={'/projects/' + project.id + '?tab=clips'} className="back-link"><ArrowLeft size={15} />내 클립</Link>
    <div className="v3-result-heading"><div><span className="v3-eyebrow">편집 결과</span><h1>{clip.title}</h1><p>{project.title}</p></div><span className="v3-result-state"><FileJson size={15} />편집 정보</span></div>
    <div className="results-layout"><div className="results-preview"><div className="v3-panel-caption"><h2>미리보기</h2><span>{savedClipUrl ? '생성된 MP4' : '원본 미리보기'}</span></div>
{loadingMp4 ? (
  <p>저장된 MP4를 불러오는 중...</p>
) : savedClipUrl ? (
  <video
    src={savedClipUrl}
    controls
    playsInline
    style={{
      width: '100%',
      borderRadius: 12,
      background: '#000'
    }}
  />
) : (
  <VideoPreview
    project={project}
    edit={edit}
    time={time}
    playing={playing}
    onTime={onTime}
    onPlaying={onPlaying}
  />
)}
</div>
      <section className="results-card"><div className="v3-output-heading"><h2>다운로드</h2><span className="tiny-tag">
  {savedClipUrl ? 'MP4 출력 완료' : '영상 생성 대기'}
</span></div><div className="result-tags"><span>{formatTime(edit.end - edit.start)}</span><span>{profile.ratio}</span><span>{info.sourceLabel}</span></div><div className="result-facts"><span>원본 구간<b>{formatTime(edit.start)} — {formatTime(edit.end)}</b></span><span>출력 목표<b>{profile.width} × {profile.height}</b></span><span>맥락 보정<b>{edit.contextApplied ? '확인 후 적용' : '미적용'}</b></span><span>저장 위치<b>{storageError ? '저장 실패' : '현재 브라우저'}</b></span><span>
  MP4 영상
  <b>{savedClipUrl ? '생성 완료' : '생성된 영상 없음'}</b>
</span></div>
        {info.rangeIssue && <p className="field-error" role="alert">{info.rangeIssue} 편집 화면에서 수정해 주세요.</p>}
        <div className="download-list"><button onClick={json} disabled={!info.canDownloadJson}><span className="download-icon"><FileJson size={19} /></span><span><b>편집 정보</b><small>JSON · 선택한 클립</small></span><Download size={17} /></button><button onClick={srt} disabled={!canSrt}><span className="download-icon"><FileText size={19} /></span><span><b>샘플 자막</b><small>{transcript.length ? 'SRT · 샘플 전사 기준' : '전사 없음 · 생성 불가'}</small></span><Download size={17} /></button>
<button
  onClick={downloadMp4}
  disabled={!savedClipUrl || loadingMp4}
>
  <span className="download-icon">
    <Film size={19} />
  </span>
  <span>
    <b>MP4 영상</b>
    <small>
      {loadingMp4
        ? '영상 확인 중...'
        : savedClipUrl
          ? 'MP4 · 다운로드 가능'
          : '생성된 영상 없음'}
    </small>
  </span>
  <Download size={17} />
</button>
</div>
        <div className="v3-inline-note"><Info size={15} /><span>{transcript.length ? '샘플 전사와 편집 정보를 내려받을 수 있습니다.' : '편집 정보를 내려받을 수 있습니다.'} {savedClipUrl
  ? '생성된 MP4 영상을 재생하고 다운로드할 수 있습니다.'
  : 'MP4 영상은 편집 화면에서 생성할 수 있습니다.'}</span></div><div className="result-actions"><Link className="btn secondary" to={editorPath}><PencilLine size={15} />다시 편집</Link><Link className="btn primary" to={'/projects/' + project.id + '?tab=clips'}>내 클립<ArrowRight size={15} /></Link></div>
      </section>
    </div>
  </div>;
}
