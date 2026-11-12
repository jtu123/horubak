import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, AudioLines, Clapperboard, Clock3, Film, Grid2X2, Image, Link2, List, Plus, Search, SlidersHorizontal, Star, X } from 'lucide-react';
import { Modal } from '../components/Modal';
import { Poster } from '../components/Poster';
import { ProjectMenu } from '../components/lucian/ProjectMenu';
import { SearchRecovery } from '../components/lucian/SearchRecovery';
import { useProjectView } from '../components/lucian/useProjectView';
import { searchProjects } from '../project-search';
import type { FilterKey } from '../project-search';
import { describeProject } from '../project-presentation';
import { useWorkspace } from '../store';
import { getProjectLabel } from '../data';
import { createSportsSample, SPORTS_SAMPLES, type SportsSample } from '../sports-samples';
import { getActiveClip, getProjectClips } from '../workspace-model';
import { formatTime } from '../lib';
import type { ContentSignal, Project } from '../types';
import '../styles/reference-dashboard.css';

const SIGNALS: Array<{ value: ContentSignal | 'all'; label: string }> = [
  { value: 'all', label: '모든 영상' }, { value: 'speech', label: '발화·대화' },
  { value: 'visual', label: '장면·행동' }, { value: 'music', label: '음악·소리' }, { value: 'screen', label: '화면·자료' },
];
function hasSignal(project: Project, signal: ContentSignal) {
  const signals = project.contentProfile?.signals;
  return signals ? signals.includes(signal) : project.genre !== 'general' && signal === 'speech';
}
function projectPath(project: Project) {
  const base = '/projects/' + encodeURIComponent(project.id);
  return ['processing', 'failed', 'cancelled'].includes(project.status) ? base + '/processing' : base;
}

export function Dashboard() {
  const { projects, updateProject, addProject, deleteProject, notify, videos } = useWorkspace();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const view = params.get('view') ?? 'all';
  const [signal, setSignal] = useState<ContentSignal | 'all'>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const { layout, changeLayout, gridRef } = useProjectView();
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [browsingSamples, setBrowsingSamples] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const recoverFocus = useRef(false);

  useEffect(() => { if (recoverFocus.current) { recoverFocus.current = false; search.current?.focus({ preventScroll: true }); } }, [query, signal, view]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'k' && !event.isComposing) { event.preventDefault(); search.current?.scrollIntoView({ block: 'center', behavior: 'instant' }); search.current?.focus({ preventScroll: true }); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const filtered = searchProjects(projects, { query, genre: 'all', view })
    .filter(project => signal === 'all' || hasSignal(project, signal))
    .sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title, 'ko') : sort === 'old' ? a.updatedAt.localeCompare(b.updatedAt) : b.updatedAt.localeCompare(a.updatedAt));
  const recent = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const recentPath = recent ? projectPath(recent) : '';
  const recentClip = recent && (recent.status === 'ready' || recent.status === 'completed') ? getActiveClip(recent) : undefined;
  const title = view === 'favorites' ? '즐겨찾기' : view === 'exports' ? '편집 결과' : '프로젝트';
  const open = (project: Project) => navigate(projectPath(project));
  const reset = () => { recoverFocus.current = true; setQuery(''); setSignal('all'); if (view !== 'all') navigate('/projects'); };
  const removeFilter = (key: FilterKey) => { recoverFocus.current = true; if (key === 'query') setQuery(''); else if (key === 'genre') setSignal('all'); else navigate('/projects'); };
  const openSample = (match: SportsSample) => {
    const project = createSportsSample(match);
    const existing = projects.find(item => item.id === project.id);
    if (!existing) {
      addProject(project);
      notify('경기 샘플을 추가했어요');
    }
    setBrowsingSamples(false);
    open(existing ?? project);
  };

  return <div className="dashboard dashboard-v3 reference-dashboard">
    <header className="page-heading dashboard-heading">
      <h1>{title}</h1>
      <div className="heading-actions">
        <button className="ref-text-action" type="button" onClick={() => setBrowsingSamples(true)}>샘플 둘러보기<ArrowRight size={15} /></button>
        <Link className="btn primary" to="/projects/new"><Plus size={17} />새 영상</Link>
      </div>
    </header>
    {recent && !query && signal === 'all' && view === 'all' && <section className="dashboard-recent" aria-label="최근 작업">
      <div className="dashboard-recent-copy">
        <span><Clock3 size={14} aria-hidden="true" />최근 작업</span>
        <h2 title={recent.title}>{recent.title}</h2>
      </div>
      {recentClip ? <div className="dashboard-recent-range">
        <span className="sr-only">클립 구간</span>
        <span>{formatTime(recentClip.edit.start)}</span>
        <span className="dashboard-range-mark" aria-hidden="true" />
        <span>{formatTime(recentClip.edit.end)}</span>
        <small>{Math.max(0, recentClip.edit.end - recentClip.edit.start).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}초</small>
      </div> : <p className="dashboard-recent-status">{describeProject(recent).statusLabel} · {recent.duration ? formatTime(recent.duration) : '길이 미확인'}</p>}
      <Link className="btn secondary dashboard-resume" to={recentClip ? recentPath + '/editor?clip=' + encodeURIComponent(recentClip.id) : recentPath}>
        {recentClip ? '편집 이어서' : '프로젝트 열기'}<ArrowRight size={15} />
      </Link>
    </section>}
    <nav className="project-view-tabs" aria-label="프로젝트 모음"><Link to="/projects" aria-current={view === 'all' ? 'page' : undefined}>전체 프로젝트</Link><Link to="/projects?view=favorites" aria-current={view === 'favorites' ? 'page' : undefined}><Star size={14} />즐겨찾기</Link><Link to="/projects?view=exports" aria-current={view === 'exports' ? 'page' : undefined}>편집 결과</Link><span className="collection-summary" role="status">{filtered.length}개 프로젝트</span></nav>
    <div className="project-toolbar">
      <div className="search-field"><Search size={16} /><input ref={search} id="project-search" aria-label="프로젝트 이름 검색" placeholder="프로젝트 검색" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="icon-button" aria-label="검색 지우기" onClick={() => { setQuery(''); search.current?.focus(); }}><X size={14} /></button>}</div>
      <label className="signal-filter"><SlidersHorizontal size={15} /><span className="sr-only">콘텐츠 특성 필터</span><select aria-label="콘텐츠 특성 필터" value={signal} onChange={event => setSignal(event.target.value as ContentSignal | 'all')}>{SIGNALS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label className="sort-control"><span className="sr-only">프로젝트 정렬</span><select aria-label="프로젝트 정렬" value={sort} onChange={event => setSort(event.target.value)}><option value="recent">최근 수정순</option><option value="old">오래된 순</option><option value="name">이름순</option></select></label>
      <div className="view-toggle" role="group" aria-label="프로젝트 보기 방식"><button aria-label="카드 보기" aria-pressed={layout === 'grid'} onClick={() => changeLayout('grid')}><Grid2X2 size={16} /></button><button aria-label="목록 보기" aria-pressed={layout === 'list'} onClick={() => changeLayout('list')}><List size={17} /></button></div>
    </div>
    <div ref={gridRef} className={'project-grid u308' + (layout === 'list' ? ' list-view' : '')} role="region" aria-label="필터링한 프로젝트">
      {filtered.map((project, index) => {
        const info = describeProject(project, project.edit, !!videos[project.id]);
        const count = getProjectClips(project).length;
        const isSample = project.source === 'sample';
        const waitingForSource = !isSample && (project.status === 'ready' || project.status === 'completed') && !videos[project.id];
        return <ProjectMenu key={project.id} project={project} index={index} onOpen={() => open(project)} onRename={() => { setRenaming(project); setName(project.title); }} onFavorite={() => updateProject(project.id, { favorite: !project.favorite })} onDelete={() => setDeleting(project)}>{trigger => <>
          <button className="project-open" onClick={() => open(project)} aria-label={project.title + ' 열기'}>
            <div className={'project-cover project-cover-' + project.genre}>
              {isSample ? <Poster project={project} /> : <span className="dashboard-source-icon" aria-hidden="true">{project.source === 'url' ? <Link2 size={22} /> : <Film size={22} />}</span>}
              <span className="cover-source">{info.sourceLabel}</span><span className="cover-play" aria-hidden="true"><Clapperboard size={19} /></span><span className="cover-duration">{project.duration ? formatTime(project.duration) : '길이 미확인'}</span>
            </div>
            <div className="project-card-body">
              <h3 title={project.title}>{project.title}</h3>
              <span className="card-content-label">{project.genre === 'general' ? <Image size={12} /> : <AudioLines size={12} />}{getProjectLabel(project)}</span>
              <div className="card-status-row"><span className={'project-status' + (waitingForSource ? '' : ' ' + project.status)}><span />{waitingForSource ? info.mediaLabel : info.statusLabel}</span><span className="card-clip-count"><Clapperboard size={12} />{count}개 클립</span></div>
            </div>
          </button>
          <div className="card-actions"><time dateTime={project.updatedAt}>{new Date(project.updatedAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}</time><button className={'icon-button ' + (project.favorite ? 'favorited' : '')} aria-label={project.title + (project.favorite ? ' 즐겨찾기 해제' : ' 즐겨찾기')} aria-pressed={project.favorite} onClick={() => updateProject(project.id, { favorite: !project.favorite })}><Star size={16} fill={project.favorite ? 'currentColor' : 'none'} /></button>{trigger}</div>
        </>}</ProjectMenu>;
      })}
    </div>
    {!filtered.length && <>{signal !== 'all' && <div className="signal-recovery"><p>{SIGNALS.find(item => item.value === signal)?.label} 특성에 맞는 프로젝트가 없어요.</p><button className="text-link" onClick={reset}>모든 영상 보기<ArrowRight size={14} /></button></div>}<SearchRecovery projects={projects} filter={{ query, genre: 'all', view }} onRemove={removeFilter} onReset={reset} onNew={() => navigate('/projects/new')} /></>}
    {browsingSamples && <Modal title="경기 샘플" onClose={() => setBrowsingSamples(false)}>
      <div className="sports-sample-options">
        {SPORTS_SAMPLES.map(match => <button type="button" className="sports-sample-option" key={match.id} onClick={() => openSample(match)}>
          <img src={match.thumbnail} alt="" />
          <span><small>{match.competition}</small><b>{match.title}</b></span>
          <ArrowRight size={16} />
        </button>)}
      </div>
    </Modal>}
    {renaming && <Modal title="이름 변경" onClose={() => setRenaming(null)}><form onSubmit={event => { event.preventDefault(); if (!name.trim()) return; updateProject(renaming.id, { title: name.trim() }); setRenaming(null); notify('프로젝트 이름을 바꿨어요'); }}><label className="field-label" htmlFor="rename">프로젝트 이름</label><input className="text-input" id="rename" autoFocus maxLength={80} required value={name} onChange={event => setName(event.target.value)} /><div className="modal-actions"><button type="button" className="btn secondary" onClick={() => setRenaming(null)}>취소</button><button className="btn primary" type="submit">변경</button></div></form></Modal>}
    {deleting && <Modal title="프로젝트를 삭제할까요?" onClose={() => setDeleting(null)}><p className="muted">작업공간의 <b>{deleting.title}</b> 프로젝트와 클립이 목록에서 제거됩니다.</p><div className="modal-actions"><button className="btn secondary" onClick={() => setDeleting(null)}>취소</button><button className="btn danger" onClick={() => { deleteProject(deleting.id); setDeleting(null); notify('프로젝트를 삭제했어요'); }}>삭제</button></div></Modal>}
  </div>;
}
