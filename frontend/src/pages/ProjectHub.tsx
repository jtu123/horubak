import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Clapperboard, Copy, Eye, FileText, Film, Info, Layers3, Pencil, Play, Plus, RotateCcw, ScanLine, Trash2, Volume2, X } from 'lucide-react';
import { getProjectCandidates, getProjectEvidence, getProjectLabel, getProjectTranscript, initialEdit } from '../data';
import { formatTime } from '../lib';
import { useWorkspace } from '../store';
import { getActiveClip, getProjectClips } from '../workspace-model';
import type { Candidate, Clip, EditState } from '../types';
import { Modal } from '../components/Modal';
import { PillTabs } from '../components/lucian/PillTabs';
import { Poster } from '../components/Poster';
import { SourceReconnect, VideoPreview } from '../components/VideoPreview';
import '../styles/editor-v3.css';

type HubTab = 'candidates' | 'clips' | 'source' | 'jobs';
const HUB_TABS: Array<{ value: HubTab; label: string }> = [
  { value: 'candidates', label: '추천 후보' }, { value: 'clips', label: '내 클립' },
  { value: 'source', label: '원본 탐색' }, { value: 'jobs', label: '작업·출력' },
];

export function ProjectHub() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { projects, createClip, selectClip, duplicateClip, renameClip, deleteClip, updateProject, notify, storageError } = useWorkspace();
  const project = projects.find(p => p.id === id);
  const requested = params.get('tab');
  const tab: HubTab = HUB_TABS.some(t => t.value === requested) ? requested as HubTab : 'candidates';
  const [preview, setPreview] = useState<Candidate | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rename, setRename] = useState<Clip | null>(null);
  const [name, setName] = useState('');
  const [remove, setRemove] = useState<Clip | null>(null);
  const onTime = useCallback((value: number) => setTime(value), []);
  const onPlaying = useCallback((value: boolean) => setPlaying(value), []);
  useEffect(() => { setPreview(null); setPlaying(false); setTime(0); setRename(null); setRemove(null); }, [id, tab]);
  if (!project) return <div className="empty-state"><h1>프로젝트를 찾을 수 없어요</h1><Link className="btn primary" to="/projects">프로젝트 목록</Link></div>;
  const clips = getProjectClips(project);
  const active = getActiveClip(project);
  const candidates = getProjectCandidates(project);
  const transcript = getProjectTranscript(project);
  const evidence = getProjectEvidence(project);
  const hidden = project.dismissedCandidateIds ?? [];
  const visible = candidates.filter(c => !hidden.includes(c.id));
  const sample = project.source === 'sample';
  const editable = ['ready', 'completed'].includes(project.status) && project.duration >= 30;
  const sourceEdit: EditState = { ...initialEdit(project.genre), start: 0, end: project.duration, subtitleVisible: false, layout: 'full', cropX: 50, cropY: 50, scale: 1 };
  const openClip = (clip: Clip) => { selectClip(project.id, clip.id); navigate('/projects/' + project.id + '/editor?clip=' + encodeURIComponent(clip.id)); };
  const adopt = (candidate?: Candidate) => {
    const existing = candidate && clips.find(c => c.edit.candidateId === candidate.id);
    if (existing) { openClip(existing); return; }
    const clipId = createClip(project.id, candidate);
    if (!clipId) return;
    navigate('/projects/' + project.id + '/editor?clip=' + encodeURIComponent(clipId));
  };
  return <div className="v3-project-hub">
    <Link to="/projects" className="back-link"><ArrowLeft size={15} />프로젝트</Link>
    <div className="v3-hub-heading"><div><div className="v3-eyebrow">{getProjectLabel(project)}<span>·</span>{formatTime(project.duration)}<span>·</span>{sample ? '샘플' : '원본'}</div><h1>{project.title}</h1><p>{project.sourceName}</p></div><div className="v3-hub-heading-actions"><span className={'v3-save-status' + (storageError ? ' is-error' : '')}>{storageError ? '저장 실패' : '브라우저에 저장됨'}</span><button className="btn primary" disabled={!editable} onClick={() => adopt()} title={!editable ? '30초 이상의 원본과 편집 준비 상태가 필요합니다.' : undefined}><Plus size={16} />직접 클립 만들기</button></div></div>
    <div className="v3-hub-summary"><div><Film size={17} /><span>원본 1개</span></div><div><Layers3 size={17} /><span>내 클립 <b>{clips.length}</b></span></div><div><Info size={16} /><span>{sample ? '후보·근거는 제작 흐름을 위한 샘플입니다.' : '분석 연결 전 · 원본을 보며 직접 편집할 수 있어요.'}</span></div></div>
    <PillTabs label="프로젝트 탐색" value={tab} options={HUB_TABS} onChange={value => { const next = new URLSearchParams(params); next.set('tab', value); setParams(next); }} panelId="project-hub-panel" />
    <div id="project-hub-panel" role="tabpanel" className="v3-hub-panel">
      {tab === 'candidates' && <>
        <div className="v3-section-heading"><div><h2>어떤 순간을 남길까요?</h2><p>{sample ? '원본 근거를 확인하고, 원하는 후보를 클립으로 만드세요.' : '분석 결과를 연결하면 이곳에 추천 후보가 표시됩니다.'}</p></div><span className="v3-count">{visible.length}개 후보</span></div>
        {visible.length ? <div className="v3-candidate-grid">{visible.map((candidate, index) => {
          const saved = clips.some(c => c.edit.candidateId === candidate.id);
          return <article key={candidate.id} className="v3-hub-candidate">
            <button className="v3-candidate-cover" aria-label={candidate.title + ' 미리보기'} onClick={() => { setPreview(candidate); setTime(candidate.start); setPlaying(false); }}><Poster genre={project.genre} /><span className="v3-cover-play"><Play size={19} fill="currentColor" /></span><span className="v3-cover-duration">{(candidate.end - candidate.start).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}초</span><span className="v3-cover-index">{String(index + 1).padStart(2, '0')}</span></button>
            <div className="v3-hub-candidate-body"><div className="v3-candidate-meta"><span>{candidate.evidenceKind === 'scene' ? <ScanLine size={13} /> : candidate.evidenceKind === 'sound' ? <Volume2 size={13} /> : <FileText size={13} />}{candidate.evidenceKind === 'scene' ? '장면 근거' : candidate.evidenceKind === 'sound' ? '소리 근거' : '발화 근거'}</span>{saved && <span className="v3-saved-label"><Check size={12} />클립에 저장됨</span>}</div><h3>{candidate.title}</h3><p>{candidate.summary}</p><div className="v3-candidate-footnote"><span>{formatTime(candidate.start)} — {formatTime(candidate.end)}</span>{candidate.warning && <span className="v3-context-label"><Info size={12} />맥락 확인</span>}</div><div className="v3-candidate-actions"><button className="btn secondary" onClick={() => { setPreview(candidate); setTime(candidate.start); setPlaying(false); }}><Eye size={14} />살펴보기</button><button className="btn primary" disabled={!editable} onClick={() => adopt(candidate)}>{saved ? '클립 열기' : '클립 만들기'}<ArrowRight size={14} /></button><button className="icon-button" aria-label={candidate.title + ' 후보 숨기기'} onClick={() => updateProject(project.id, { dismissedCandidateIds: [...hidden, candidate.id] })}><X size={15} /></button></div></div>
          </article>;
        })}</div> : <div className="v3-hub-empty"><ScanLine size={32} /><h3>{candidates.length ? '모든 후보를 숨겼어요' : '아직 추천 후보가 없어요'}</h3><p>{sample ? '숨긴 후보를 복구하거나 직접 클립을 만들 수 있어요.' : '분석 서버 연결 전입니다. 원본 탐색에서 원하는 구간을 직접 골라보세요.'}</p><button className="btn secondary" onClick={() => setParams({ tab: 'source' })}>원본 탐색<ArrowRight size={14} /></button></div>}
        {hidden.length > 0 && <button className="v3-restore-link" onClick={() => updateProject(project.id, { dismissedCandidateIds: [] })}><RotateCcw size={14} />숨긴 후보 {hidden.length}개 복구</button>}
      </>}
      {tab === 'clips' && <><div className="v3-section-heading"><div><h2>내 클립</h2><p>클립마다 구간·자막·구도를 따로 저장합니다.</p></div><span className="v3-count">{clips.length}개</span></div>{clips.length ? <div className="v3-clip-list">{clips.map(clip => <article key={clip.id} className={'v3-clip-row' + (active?.id === clip.id ? ' is-active' : '')}><button className="v3-clip-thumb" aria-label={clip.title + ' 편집'} onClick={() => openClip(clip)}><Poster genre={project.genre} mini /><span><Play size={14} fill="currentColor" /></span></button><div className="v3-clip-row-title"><h3><button onClick={() => openClip(clip)}>{clip.title}</button></h3><p>{formatTime(clip.edit.start)} — {formatTime(clip.edit.end)}<span>·</span>{Math.max(0, clip.edit.end - clip.edit.start).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}초<span>·</span>브라우저 편집</p></div><span className="tiny-tag">MP4 연결 전</span><div className="v3-clip-row-actions"><button className="icon-button" aria-label={clip.title + ' 이름 변경'} onClick={() => { setRename(clip); setName(clip.title); }}><Pencil size={15} /></button><button className="icon-button" aria-label={clip.title + ' 복제'} onClick={() => { duplicateClip(project.id, clip.id); notify('클립을 복제했어요'); }}><Copy size={15} /></button><button className="icon-button" aria-label={clip.title + ' 삭제'} onClick={() => setRemove(clip)}><Trash2 size={15} /></button><button className="btn secondary" onClick={() => openClip(clip)}>편집<ArrowRight size={14} /></button></div></article>)}</div> : <div className="v3-hub-empty"><Clapperboard size={32} /><h3>첫 클립을 만들어보세요</h3><p>추천 후보를 채택하거나 원본에서 직접 구간을 정할 수 있어요.</p><button className="btn primary" onClick={() => setParams({ tab: 'candidates' })}>추천 후보 보기<ArrowRight size={14} /></button></div>}</>}
      {tab === 'source' && <div className="v3-source-layout"><section className="v3-source-player"><div className="v3-panel-caption"><Film size={16} /><h2>원본 미리보기</h2><span>{sample ? '샘플 이미지' : '로컬 원본'}</span></div><VideoPreview project={project} edit={sourceEdit} time={time} playing={playing} onTime={onTime} onPlaying={onPlaying} /><SourceReconnect project={project} /></section><section className="v3-source-evidence"><div className="v3-panel-caption"><h2>{transcript.length ? '원본 발화' : '장면·이벤트'}</h2><span>{transcript.length || evidence.length}개 근거</span></div>{transcript.length ? transcript.map(item => <button key={item.id} className="v3-evidence-row" onClick={() => { setTime(item.start); setPlaying(false); }}><span>{formatTime(item.start)}<b>{item.speaker}</b></span><p>{item.text}</p></button>) : evidence.length ? evidence.map(item => <button key={item.id} className="v3-evidence-row" onClick={() => { setTime(item.start); setPlaying(false); }}><span>{formatTime(item.start)}<b>{item.kind === 'sound' ? '소리' : '장면'}</b></span><h3>{item.title}</h3><p>{item.description}</p></button>) : <div className="v3-evidence-empty"><FileText size={28} /><h3>원본에서 직접 찾아보세요</h3><p>분석 결과는 연결 전입니다. 직접 구간과 자막을 편집할 수 있어요.</p></div>}{sample && !transcript.length && <div className="v3-inline-note"><Info size={14} />음성 없는 영상의 장면 근거 예시입니다.</div>}</section></div>}
      {tab === 'jobs' && <><div className="v3-section-heading"><div><h2>작업·출력</h2><p>편집 저장과 영상 출력은 별도의 단계입니다.</p></div></div><div className="v3-project-job"><div className="v3-job-icon"><Layers3 size={21} /></div><div><h3>브라우저 편집</h3><p>{clips.length}개 클립 · {storageError ? '저장 실패' : '이 브라우저에 저장'}</p></div><button className="btn secondary" onClick={() => setParams({ tab: 'clips' })}>클립 보기<ArrowRight size={14} /></button></div><div className="v3-project-job"><div className="v3-job-icon"><ScanLine size={21} /></div><div><h3>{sample ? '샘플 분석 자료' : '실제 영상 분석'}</h3><p>{sample ? '제작 흐름 확인용 · 실제 AI 분석 결과가 아닙니다.' : '분석 API 연결 전입니다.'}</p></div><span className="tiny-tag">{sample ? '샘플' : '미연결'}</span></div><div className="v3-project-job"><div className="v3-job-icon"><Film size={21} /></div><div><h3>MP4 영상 출력</h3><p>렌더 서버 연결 후 클립별 결과와 실패 이력을 표시합니다.</p></div><span className="tiny-tag">미연결</span></div></>}
    </div>
    {preview && <Modal title="후보 살펴보기" onClose={() => { setPreview(null); setPlaying(false); }}><div className="v3-candidate-modal"><VideoPreview project={project} edit={{ ...initialEdit(project.genre), candidateId: preview.id, start: preview.start, end: preview.end, subtitle: preview.title }} time={time} playing={playing} onTime={onTime} onPlaying={onPlaying} /><h3>{preview.title}</h3><p>{preview.reason}</p>{preview.warning && <div className="v3-inline-note"><Info size={14} />{preview.warning.title}</div>}<div className="modal-actions"><button className="btn secondary" onClick={() => setPreview(null)}>닫기</button><button className="btn primary" disabled={!editable} onClick={() => adopt(preview)}>클립 만들기<ArrowRight size={15} /></button></div></div></Modal>}
    {rename && <Modal title="클립 이름 변경" onClose={() => setRename(null)}><form onSubmit={event => { event.preventDefault(); if (!name.trim()) return; renameClip(project.id, rename.id, name.trim()); setRename(null); notify('클립 이름을 변경했어요'); }}><label className="field-label" htmlFor="clip-name">클립 이름</label><input className="text-input" id="clip-name" maxLength={160} value={name} onChange={event => setName(event.target.value)} autoFocus required /><div className="modal-actions"><button type="button" className="btn secondary" onClick={() => setRename(null)}>취소</button><button className="btn primary" disabled={!name.trim()}>저장</button></div></form></Modal>}
    {remove && <Modal title="클립을 삭제할까요?" onClose={() => setRemove(null)}><p className="muted">“{remove.title}”의 편집 정보를 삭제합니다. 원본과 다른 클립은 유지됩니다.</p><div className="modal-actions"><button className="btn secondary" onClick={() => setRemove(null)}>취소</button><button className="btn danger" onClick={() => { deleteClip(project.id, remove.id); setRemove(null); notify('클립을 삭제했어요'); }}>클립 삭제</button></div></Modal>}
  </div>;
}
