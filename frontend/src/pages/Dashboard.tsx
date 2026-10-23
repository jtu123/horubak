// Lucian UX/UI Prompt #214 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#214
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDownWideNarrow, ArrowUpRight, AudioLines, Captions, ChevronDown, Clapperboard, Grid2X2, List, Plus, Search, Sparkles, Star, X } from 'lucide-react';
import { Poster } from '../components/Poster';
import { FeatureBento, useBentoInteraction, useTyping } from '../components/lucian/FeatureBento';
import { PillTabs } from '../components/lucian/PillTabs';
import { Modal } from '../components/Modal';
import { ProjectMenu } from '../components/lucian/ProjectMenu';
import { SearchRecovery } from '../components/lucian/SearchRecovery';
import { searchProjects } from '../project-search';
import type { FilterKey } from '../project-search';
import { useWorkspace } from '../store';
import { formatTime } from '../lib';
import { GENRES } from '../types';
import type { Genre, Project } from '../types';


export function Dashboard() {
  const { projects, updateProject, deleteProject, notify } = useWorkspace();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const view = params.get('view') ?? 'all';
  const [genre, setGenre] = useState<Genre | 'all'>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [layout, setLayout] = useState('grid');
  const [storageInfo, setStorageInfo] = useState(false);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState<Project | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const recoverFocus = useRef(false);
  useEffect(() => { if (recoverFocus.current) { recoverFocus.current = false; search.current?.focus({ preventScroll: true }); } }, [query,genre,view]);
  const { tileProps, isOn, reduced } = useBentoInteraction();
  const typed = useTyping('영상 등록 → 분석 → 편집', '나만의 하이라이트 만들기', isOn(0), reduced);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'k' && !event.isComposing) {
        event.preventDefault();
        search.current?.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'center' });
        search.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [reduced]);

  const filtered = searchProjects(projects, { query, genre, view }).sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title, 'ko') : sort === 'old' ? a.updatedAt.localeCompare(b.updatedAt) : b.updatedAt.localeCompare(a.updatedAt));
  const sample = projects.find(project => project.source === 'sample');
  const recent = [...filtered].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0,3);
  const ready = projects.filter(project => project.status === 'ready').length;
  const processing = projects.filter(project => project.status === 'processing').length;
  const completed = projects.filter(project => project.status === 'completed').length;
  const favorites = projects.filter(project => project.favorite).length;
  const genreCounts = Object.keys(GENRES).map(key => projects.filter(project => project.genre === key).length);
  const bars = [...genreCounts,...genreCounts];
  const maxBar = Math.max(1,...bars);
  const mediaIcons = [Captions,AudioLines,Clapperboard,Sparkles];
  const pageTitle = view === 'favorites' ? '즐겨찾기' : view === 'exports' ? '결과 보관함' : '내 프로젝트';
  const open = (project: Project) => navigate(`/projects/${project.id}/${['processing', 'cancelled', 'failed'].includes(project.status) ? 'processing' : project.status === 'completed' && view === 'exports' ? 'results' : 'editor'}`);
  const resetFilters = () => { setQuery(''); setGenre('all'); };
  const removeFilter = (key: FilterKey) => { recoverFocus.current = true; if (key === 'query') setQuery(''); else if (key === 'genre') setGenre('all'); else navigate('/projects'); };
  const recoverAll = () => { recoverFocus.current = true; resetFilters(); if (view !== 'all') navigate('/projects'); };

  return <>
    <FeatureBento heading={<h1>{pageTitle}</h1>}>
      <section {...tileProps(0,'a')} aria-labelledby="bento-welcome-title">
        <div className="u214-av bento-genre-orbs" aria-hidden="true"><i><Captions /></i><i><AudioLines /></i><i><Clapperboard /></i></div>
        <h2 id="bento-welcome-title">새 하이라이트</h2>
        <p className="bento-welcome-copy">강의 · 연설 · 팟캐스트</p>
        <div className="bento-welcome-actions"><Link className="btn primary" to="/projects/new"><Plus size={18} />새 영상 등록</Link>{sample && <button className="bento-sample-link" onClick={() => open(sample)}>샘플 보기<ArrowUpRight size={15} /></button>}</div>
        <div className="u214-ty bento-typing" aria-hidden="true">{typed}</div>
      </section>
      <section {...tileProps(1,'b')} aria-labelledby="bento-search-title">
        <h2 id="bento-search-title">{query ? '검색 결과' : '최근 작업'}</h2>
        <div className="u214-sb bento-search-field"><Search aria-hidden="true" /><input ref={search} id="bento-project-search" aria-label="프로젝트 이름 검색" placeholder="프로젝트 검색" value={query} onChange={event => setQuery(event.target.value)} />{query ? <button type="button" aria-label="검색 지우기" onClick={() => { setQuery(''); search.current?.focus(); }}><X size={16} /></button> : <kbd>Ctrl K</kbd>}</div>
        <div className="u214-rs bento-recent-list">{recent.map((project,index) => <button key={project.id} className="bento-recent-project" style={{ '--i': index } as CSSProperties} onClick={() => open(project)}><span className="bento-recent-cover" aria-hidden="true">{project.genre === 'lecture' ? <Captions size={19} /> : project.genre === 'speech' ? <Clapperboard size={19} /> : <AudioLines size={19} />}</span><span className="bento-recent-copy"><strong>{project.title}</strong><span>{GENRES[project.genre]} · {formatTime(project.duration)}</span></span><ArrowUpRight size={15} /></button>)}
          {!recent.length && <p className="bento-recent-empty">{projects.length ? '검색 결과가 없어요' : '등록한 프로젝트가 없어요'}</p>}
        </div>
      </section>
      <section {...tileProps(2,'c')} tabIndex={0} aria-labelledby="bento-activity-title">
        <h2 id="bento-activity-title">프로젝트</h2>
        <div className="bento-total"><strong>{projects.length}</strong><span>개</span></div>
        <div className="bento-counts"><span>편집 가능 <b>{ready}</b></span><span>준비 중 <b>{processing}</b></span><span>완료 <b>{completed}</b></span></div>
        <div className="u214-br bento-activity-bars" aria-hidden="true">{bars.map((count,index) => <i key={index} style={{ '--h': count/maxBar, '--i': index } as CSSProperties} />)}</div>
      </section>
      <section {...tileProps(3,'d')} aria-labelledby="bento-space-title">
        <h2 id="bento-space-title">내 공간</h2>
        <div className="bento-space-links"><Link to="/projects?view=favorites"><Star size={16} /><span>즐겨찾기</span><strong>{favorites}</strong></Link><Link to="/projects?view=exports"><Clapperboard size={16} /><span>결과 보관함</span><strong>{completed}</strong></Link></div>
        <button className="bento-storage-link" onClick={() => setStorageInfo(true)}>브라우저 저장<ArrowUpRight size={13} /></button>
        <span className="u214-sh bento-space-shield" aria-hidden="true"><svg viewBox="0 0 30 34"><path d="M15 2l11 4.5v8.5c0 8-5 13.5-11 16.5C9 28.5 4 23 4 15V6.5z" fill="currentColor" opacity=".18" /><path d="M15 2l11 4.5v8.5c0 8-5 13.5-11 16.5C9 28.5 4 23 4 15V6.5z" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M10.5 16.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
      </section>
      <section {...tileProps(4,'e')} aria-label="프로젝트 목록">
        <div className="bento-library-heading"><h2>프로젝트 목록 <span className="project-count" role="status" aria-atomic="true" aria-label={filtered.length + '개 프로젝트'}>{filtered.length}</span></h2><div className="view-controls"><button className={layout === 'grid' ? 'active' : ''} aria-label="카드로 보기" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}><Grid2X2 size={17} /></button><button className={layout === 'list' ? 'active' : ''} aria-label="목록으로 보기" aria-pressed={layout === 'list'} onClick={() => setLayout('list')}><List size={18} /></button></div></div>
        <div className="bento-library-toolbar"><PillTabs label="영상 장르" panelId="project-grid" value={genre} onChange={setGenre} options={[{ value: 'all', label: '전체' }, { value: 'lecture', label: '강의' }, { value: 'speech', label: '연설' }, { value: 'podcast', label: '팟캐스트' }]} /><label className="sort-control"><ArrowDownWideNarrow size={16} /><select aria-label="정렬 방식" value={sort} onChange={event => setSort(event.target.value)}><option value="recent">최근 수정순</option><option value="old">오래된 순</option><option value="name">이름순</option></select><ChevronDown size={12} /></label></div>
        <div id="project-grid" className={`project-grid ${layout === 'list' ? 'list-view' : ''}`} role="region" aria-label="필터링한 프로젝트">
          {filtered.map((project, index) => <ProjectMenu key={project.id} project={project} index={index} onOpen={() => open(project)} onRename={() => { setRenaming(project); setName(project.title); }} onFavorite={() => updateProject(project.id, { favorite: !project.favorite })} onDelete={() => setDeleting(project)}>{trigger => <>
            <button className="project-open" onClick={() => open(project)} aria-label={`${project.title} 열기`}><div className="project-cover"><Poster genre={project.genre} /><span className="cover-genre">{GENRES[project.genre]}</span><span className="cover-duration">{formatTime(project.duration)}</span><span className="cover-play"><ArrowUpRight size={23} /></span></div><div className="project-card-body"><div className="card-status-row"><span className={`project-status ${project.status}`}><span />{project.status === 'processing' ? '준비 중' : project.status === 'completed' ? '편집 완료' : project.status === 'cancelled' ? '취소됨' : project.status === 'failed' ? '확인 필요' : project.source === 'sample' ? '편집 가능' : '분석 대기'}</span>{project.source === 'sample' && <span className="source-badge">샘플</span>}</div><h3>{project.title}</h3></div></button>
            <div className="card-actions"><time dateTime={project.updatedAt}>{new Date(project.updatedAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}</time><button className={`icon-button ${project.favorite ? 'favorited' : ''}`} aria-label={`${project.title} ${project.favorite ? '즐겨찾기 해제' : '즐겨찾기'}`} aria-pressed={project.favorite} onClick={() => updateProject(project.id, { favorite: !project.favorite })}><Star size={16} fill={project.favorite ? 'currentColor' : 'none'} /></button>{trigger}</div>
          </>}</ProjectMenu>)}
        </div>
        {filtered.length === 0 && <SearchRecovery projects={projects} filter={{ query,genre,view }} onRemove={removeFilter} onReset={recoverAll} onNew={() => navigate('/projects/new')} />}
        <div className="bento-library-footer" aria-hidden="true"><div className="u214-lg bento-media-loop"><div className="u214-lt">{[...mediaIcons,...mediaIcons].map((Icon,index) => <i key={index}><Icon size={16} /></i>)}</div></div></div>
      </section>
    </FeatureBento>

    {storageInfo && <Modal title="저장 안내" onClose={() => setStorageInfo(false)}><p className="muted">프로필과 편집 정보는 이 브라우저에만 저장됩니다. 서버 저장은 연결 전입니다.</p><button className="btn primary full" onClick={() => setStorageInfo(false)}>확인</button></Modal>}
    {renaming && <Modal title="이름 변경" onClose={() => setRenaming(null)}><form onSubmit={event => { event.preventDefault(); if (!name.trim()) return; updateProject(renaming.id, { title: name.trim() }); setRenaming(null); notify('프로젝트 이름을 바꿨어요'); }}><label className="field-label" htmlFor="rename">프로젝트 이름</label><input className="text-input" id="rename" autoFocus maxLength={80} required value={name} onChange={event => setName(event.target.value)} /><div className="modal-actions"><button type="button" className="btn secondary" onClick={() => setRenaming(null)}>취소</button><button className="btn primary" type="submit">변경</button></div></form></Modal>}
    {deleting && <Modal title="프로젝트를 삭제할까요?" onClose={() => setDeleting(null)}><p className="muted">이 브라우저에 저장된 <b>{deleting.title}</b> 프로젝트와 편집 정보가 삭제됩니다.</p><div className="modal-actions"><button className="btn secondary" onClick={() => setDeleting(null)}>취소</button><button className="btn danger" onClick={() => { deleteProject(deleting.id); setDeleting(null); notify('프로젝트를 삭제했어요'); }}>삭제</button></div></Modal>}
  </>;
}
