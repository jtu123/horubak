import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, AudioLines, Check, Clapperboard, Clock3, FolderOpen, Grid2X2, Image, Layers3, Link2, List, Plus, Search, SlidersHorizontal, Star, X } from 'lucide-react';
import { Modal } from '../components/Modal';
import { Poster } from '../components/Poster';
import { ProjectMenu } from '../components/lucian/ProjectMenu';
import { SearchRecovery } from '../components/lucian/SearchRecovery';
import { searchProjects } from '../project-search';
import type { FilterKey } from '../project-search';
import { describeProject } from '../project-presentation';
import { useWorkspace } from '../store';
import { createVisualSample, getProjectLabel } from '../data';
import { getProjectClips } from '../workspace-model';
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

export function Dashboard() {
  const { user, projects, updateProject, addProject, deleteProject, notify, videos } = useWorkspace();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const view = params.get('view') ?? 'all';
  const [signal, setSignal] = useState<ContentSignal | 'all'>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [layout, setLayout] = useState('grid');
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState<Project | null>(null);
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
  const clipCount = projects.reduce((total, project) => total + getProjectClips(project).length, 0);
  const favoriteCount = projects.filter(project => project.favorite).length;
  const connectedCount = projects.filter(project => project.source !== 'sample' && !!videos[project.id]).length;
  const metrics = [
    { label: '프로젝트', value: projects.length, Icon: FolderOpen, hint: '등록한 원본' },
    { label: '저장한 클립', value: clipCount, Icon: Layers3, hint: '브라우저 편집' },
    { label: '즐겨찾기', value: favoriteCount, Icon: Star, hint: '자주 여는 작업' },
    { label: '연결된 원본', value: connectedCount, Icon: Link2, hint: '현재 창의 로컬 파일' },
  ];
  const showOverview = !query && signal === 'all' && view === 'all';
  const title = view === 'favorites' ? '즐겨찾기' : view === 'exports' ? '편집 결과' : '프로젝트';
  const open = (project: Project) => navigate('/projects/' + project.id + (['processing', 'failed', 'cancelled'].includes(project.status) ? '/processing' : ''));
  const reset = () => { recoverFocus.current = true; setQuery(''); setSignal('all'); if (view !== 'all') navigate('/projects'); };
  const removeFilter = (key: FilterKey) => { recoverFocus.current = true; if (key === 'query') setQuery(''); else if (key === 'genre') setSignal('all'); else navigate('/projects'); };
  const sample = () => { const project = createVisualSample(); const existing = projects.find(item => item.id === project.id); if (existing) open(existing); else { addProject(project); notify('장면 기반 샘플을 추가했어요'); open(project); } };

  return <div className="dashboard dashboard-v3 reference-dashboard">
    <header className="page-heading dashboard-heading" data-overview={view === 'all'}>
      <div className="page-eyebrow"><span aria-hidden="true" />호루박 작업공간</div>
      <h1>{title}<span className="project-count" role="status" aria-label={filtered.length + '개 프로젝트'}>{filtered.length}</span></h1>
      <div className="ref-heading-footer">
        <p>안녕하세요, {user?.guest ? '크리에이터' : user?.name}님. 영상의 좋은 순간을 클립으로 남겨보세요.</p>
        <div className="heading-actions">
          <Link className="btn primary" to="/projects/new"><Plus size={17} />새 영상</Link>
          <button className="ref-text-action" onClick={sample}>샘플 둘러보기<ArrowRight size={15} /></button>
        </div>
      </div>
    </header>
    {showOverview && <div className="ref-showcase">
      {recent && <div className="ref-focus-grid">
        <section className="resume-card ref-focus-card" aria-label="최근 작업 이어서 보기">
          <div className="ref-focus-header">
            <span><Clock3 size={14} />최근 작업</span>
            <time className="ref-focus-date" dateTime={recent.updatedAt}>{new Date(recent.updatedAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} 수정</time>
          </div>
          <div className="ref-focus-body">
            <div className="resume-thumb ref-focus-art">
              <Poster genre={recent.genre} />
              <span>{recent.source === 'sample' ? '샘플 포스터' : videos[recent.id] ? '원본 연결됨' : '원본 프로젝트'}</span>
            </div>
            <div className="resume-copy ref-focus-copy">
              <span className={'ref-focus-state ' + recent.status}>{describeProject(recent, recent.edit, !!videos[recent.id]).statusLabel}</span>
              <h2 title={recent.title}>{recent.title}</h2>
              <p>{getProjectLabel(recent)}<i />{recent.duration ? formatTime(recent.duration) : '길이 미확인'}<i />{getProjectClips(recent).length}개 클립</p>
              <button className="btn secondary" onClick={() => open(recent)}>이어서 작업<ArrowRight size={15} /></button>
            </div>
          </div>
        </section>
        <aside className="ref-guide" aria-label="클립 제작 안내">
          <div className="ref-guide-heading"><Layers3 size={15} />제작 가이드</div>
          <h2>원본에서 클립까지</h2>
          <ol>
            <li><span>01</span><p>원본에서 원하는 순간 찾기</p></li>
            <li><span>02</span><p>후보를 내 클립에 보관하기</p></li>
            <li><span>03</span><p>자막과 구도를 확인하기</p></li>
          </ol>
          <div className="ref-guide-foot">
            <span><Check size={13} />편집은 이 브라우저에 저장돼요</span>
            <button onClick={() => open(recent)} className="ref-guide-action ref-text-action">프로젝트 열기<ArrowRight size={14} /></button>
          </div>
        </aside>
      </div>}
      <section className="ref-metrics" aria-label="작업공간 요약">
        {metrics.map(({ label, value, Icon, hint }) => <div className="ref-metric" key={label}>
          <div className="ref-metric-label"><Icon size={15} /><span>{label}</span></div>
          <div className="ref-metric-value"><strong>{value.toLocaleString('ko-KR')}</strong><span className="ref-metric-chip">{hint}</span></div>
        </div>)}
      </section>
    </div>}
    <div className="ref-collection-heading"><h2>프로젝트 모음</h2><span>원하는 작업을 이어서 시작하세요.</span></div>
    <div className="project-view-tabs" aria-label="프로젝트 모음"><Link to="/projects" aria-current={view === 'all' ? 'page' : undefined}>전체 프로젝트</Link><Link to="/projects?view=favorites" aria-current={view === 'favorites' ? 'page' : undefined}><Star size={14} />즐겨찾기</Link><Link to="/projects?view=exports" aria-current={view === 'exports' ? 'page' : undefined}>편집 결과</Link><span className="collection-summary">원본 {projects.length}개<span />클립 {clipCount}개</span></div>
    <div className="project-toolbar">
      <div className="search-field"><Search size={16} /><input ref={search} id="project-search" aria-label="프로젝트 이름 검색" placeholder="프로젝트 검색" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="icon-button" aria-label="검색 지우기" onClick={() => { setQuery(''); search.current?.focus(); }}><X size={14} /></button>}</div>
      <label className="signal-filter"><SlidersHorizontal size={15} /><span className="sr-only">콘텐츠 특성 필터</span><select aria-label="콘텐츠 특성 필터" value={signal} onChange={event => setSignal(event.target.value as ContentSignal | 'all')}>{SIGNALS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label className="sort-control"><span className="sr-only">프로젝트 정렬</span><select aria-label="프로젝트 정렬" value={sort} onChange={event => setSort(event.target.value)}><option value="recent">최근 수정순</option><option value="old">오래된 순</option><option value="name">이름순</option></select></label>
      <div className="view-toggle" role="group" aria-label="프로젝트 보기 방식"><button aria-label="카드 보기" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}><Grid2X2 size={16} /></button><button aria-label="목록 보기" aria-pressed={layout === 'list'} onClick={() => setLayout('list')}><List size={17} /></button></div>
    </div>
    <div className={'project-grid ' + (layout === 'list' ? 'list-view' : '')} role="region" aria-label="필터링한 프로젝트">
      {filtered.map((project, index) => {
        const info = describeProject(project, project.edit, !!videos[project.id]);
        const count = getProjectClips(project).length;
        return <ProjectMenu key={project.id} project={project} index={index} onOpen={() => open(project)} onRename={() => { setRenaming(project); setName(project.title); }} onFavorite={() => updateProject(project.id, { favorite: !project.favorite })} onDelete={() => setDeleting(project)}>{trigger => <>
          <button className="project-open" onClick={() => open(project)} aria-label={project.title + ' 열기'}>
            <div className={'project-cover project-cover-' + project.genre}><Poster genre={project.genre} /><span className="cover-source">{project.source === 'sample' ? '샘플' : project.source === 'file' ? '내 영상' : 'URL'}</span><span className="cover-play"><Clapperboard size={19} /></span><span className="cover-duration">{project.duration ? formatTime(project.duration) : '길이 미확인'}</span></div>
            <div className="project-card-body"><div className="card-status-row"><span className={'project-status ' + project.status}><span />{info.statusLabel}</span><span className="card-clip-count"><Clapperboard size={12} />{count}개 클립</span></div><h3 title={project.title}>{project.title}</h3><span className="card-content-label">{project.genre === 'general' ? <Image size={12} /> : <AudioLines size={12} />}{getProjectLabel(project)}</span></div>
          </button>
          <div className="card-actions"><time dateTime={project.updatedAt}>{new Date(project.updatedAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}</time><button className={'icon-button ' + (project.favorite ? 'favorited' : '')} aria-label={project.title + (project.favorite ? ' 즐겨찾기 해제' : ' 즐겨찾기')} aria-pressed={project.favorite} onClick={() => updateProject(project.id, { favorite: !project.favorite })}><Star size={16} fill={project.favorite ? 'currentColor' : 'none'} /></button>{trigger}</div>
        </>}</ProjectMenu>;
      })}
      {!query && signal === 'all' && view === 'all' && projects.length > 0 && <Link className="new-project-tile" to="/projects/new"><span><Plus size={24} /></span><b>다음 영상을 시작해 보세요</b><small>파일 또는 영상 URL</small></Link>}
    </div>
    {!filtered.length && <>{signal !== 'all' && <div className="signal-recovery"><p>{SIGNALS.find(item => item.value === signal)?.label} 특성에 맞는 프로젝트가 없어요.</p><button className="text-link" onClick={reset}>모든 영상 보기<ArrowRight size={14} /></button></div>}<SearchRecovery projects={projects} filter={{ query, genre: 'all', view }} onRemove={removeFilter} onReset={reset} onNew={() => navigate('/projects/new')} /></>}
    {renaming && <Modal title="이름 변경" onClose={() => setRenaming(null)}><form onSubmit={event => { event.preventDefault(); if (!name.trim()) return; updateProject(renaming.id, { title: name.trim() }); setRenaming(null); notify('프로젝트 이름을 바꿨어요'); }}><label className="field-label" htmlFor="rename">프로젝트 이름</label><input className="text-input" id="rename" autoFocus maxLength={80} required value={name} onChange={event => setName(event.target.value)} /><div className="modal-actions"><button type="button" className="btn secondary" onClick={() => setRenaming(null)}>취소</button><button className="btn primary" type="submit">변경</button></div></form></Modal>}
    {deleting && <Modal title="프로젝트를 삭제할까요?" onClose={() => setDeleting(null)}><p className="muted">이 브라우저에 저장된 <b>{deleting.title}</b> 프로젝트와 클립이 삭제됩니다.</p><div className="modal-actions"><button className="btn secondary" onClick={() => setDeleting(null)}>취소</button><button className="btn danger" onClick={() => { deleteProject(deleting.id); setDeleting(null); notify('프로젝트를 삭제했어요'); }}>삭제</button></div></Modal>}
  </div>;
}
