import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, Check, CircleHelp, Clapperboard, Download, FolderOpen, Layers3, Library, Link2, ListVideo, Palette, Play, Send, ShieldCheck, Users } from 'lucide-react';
import { useWorkspace } from '../store';
import { getProjectLabel } from '../data';
import { getProjectClips } from '../workspace-model';
import { describeProject } from '../project-presentation';
import { downloadText, formatTime } from '../lib';
import { PillTabs } from '../components/lucian/PillTabs';

function Heading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="page-heading"><div><div className="page-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div></div>;
}
function ConnectionState({ Icon, title, description, children }: { Icon: typeof Library; title: string; description: string; children?: React.ReactNode }) {
  return <section className="connection-state"><span className="connection-visual"><Icon size={32} /></span><span className="connection-status"><span />연결 전</span><h2>{title}</h2><p>{description}</p>{children}<Link className="btn secondary" to="/projects">프로젝트로 이동<ArrowRight size={15} /></Link></section>;
}
interface BrandPreset { name: string; color: string; caption: string }
const DEFAULT_BRAND: BrandPreset = { name: '나의 브랜드', color: '#3182f6', caption: 'clean' };
function loadBrand(key: string): BrandPreset {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
    return saved && typeof saved.name === 'string' && /^#[\da-f]{6}$/i.test(saved.color) && ['clean', 'bold', 'minimal'].includes(saved.caption) ? saved : DEFAULT_BRAND;
  } catch { return DEFAULT_BRAND; }
}

export function LibraryPage() {
  const { projects, user, notify } = useWorkspace();
  const [tab, setTab] = useState('assets');
  const key = 'horubak.brand.' + user!.id + '.v1';
  const [brand, setBrand] = useState<BrandPreset>(() => loadBrand(key));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const change = (patch: Partial<BrandPreset>) => { setBrand(value => ({ ...value, ...patch })); setSaved(false); setError(''); };
  return <div className="workspace-page library-page">
    <Heading eyebrow="제작에 필요한 것들" title="라이브러리" description="원본과 스타일을 한곳에 모아두세요." />
    <PillTabs label="라이브러리 보기" value={tab} onChange={setTab} options={[{ value: 'assets', label: '미디어' }, { value: 'brand', label: '브랜드·템플릿' }]} />
    {tab === 'assets' ? <section className="asset-section"><div className="section-heading"><h2>프로젝트 원본<span>{projects.length}</span></h2><Link className="text-link" to="/projects/new">영상 추가<ArrowRight size={14} /></Link></div>
      {projects.length ? <div className="asset-grid">{projects.map(project => <Link key={project.id} className="asset-card" to={'/projects/' + project.id + '?tab=source'}><span className={'asset-icon ' + (project.source === 'sample' ? 'sample' : '')}>{project.source === 'url' ? <Link2 size={24} /> : <Clapperboard size={24} />}</span><b title={project.sourceName}>{project.sourceName}</b><small>{getProjectLabel(project)} · {project.duration ? formatTime(project.duration) : '길이 미확인'}</small><span className="asset-foot">{project.source === 'sample' ? '샘플 원본' : project.source === 'file' ? '로컬 원본 · 재연결 가능' : '등록된 URL'}<ArrowRight size={14} /></span></Link>)}</div> : <div className="simple-empty"><FolderOpen size={28} /><h2>아직 원본이 없어요</h2><Link className="btn primary" to="/projects/new">첫 영상 등록</Link></div>}
      <p className="workspace-footnote">파일 자체는 저장하지 않습니다. 음악·B-roll 보관함은 서버 연결 후 제공됩니다.</p>
    </section> : <div className="brand-layout"><form className="workspace-panel brand-form" onSubmit={event => { event.preventDefault(); if (!brand.name.trim()) return; try { localStorage.setItem(key, JSON.stringify({ ...brand, name: brand.name.trim() })); setSaved(true); notify('브랜드 프리셋을 저장했어요', '현재 브라우저에 저장됩니다.'); } catch { setError('브라우저에 저장하지 못했어요.'); } }}>
      <div className="section-heading"><h2>브랜드 프리셋</h2><span className="tiny-tag">이 브라우저</span></div><label className="field-label" htmlFor="brand-name">이름</label><input className="text-input" id="brand-name" maxLength={40} required value={brand.name} onChange={event => change({ name: event.target.value })} />
      <fieldset className="brand-colors"><legend className="field-label">포인트 색상</legend><div>{['#3182f6', '#1d6b53', '#a34961', '#555e71', '#177e95'].map(color => <button type="button" className={brand.color === color ? 'selected' : ''} key={color} aria-label={color + ' 색상'} aria-pressed={brand.color === color} style={{ backgroundColor: color }} onClick={() => change({ color })}>{brand.color === color && <Check size={15} />}</button>)}</div></fieldset>
      <span className="field-label">자막 스타일</span><div className="brand-template-picker">{[{ value: 'clean', label: '기본' }, { value: 'bold', label: '강조' }, { value: 'minimal', label: '미니멀' }].map(item => <button type="button" key={item.value} aria-pressed={brand.caption === item.value} onClick={() => change({ caption: item.value })}>{item.label}</button>)}</div>
      <p className="form-hint">프리셋 저장과 미리보기만 제공합니다. 클립 일괄 적용·영상 합성은 연결 전입니다.</p>{error && <p className="field-error" role="alert">{error}</p>}<button className="btn primary" type="submit">{saved ? <><Check size={15} />저장됨</> : '프리셋 저장'}</button>
    </form><section className="brand-preview workspace-panel"><div className="section-heading"><h2>스타일 미리보기</h2><Palette size={16} /></div><div className={'brand-preview-canvas ' + brand.caption} style={{ '--brand-color': brand.color } as React.CSSProperties}><span>{brand.name || '나의 브랜드'}</span><div>기억하고 싶은<br /><b>바로 그 순간.</b></div><small>9:16 · 스타일 예시</small></div></section></div>}
  </div>;
}

export function JobsPage() {
  const { projects, videos, updateProject, notify } = useWorkspace();
  const [tab, setTab] = useState('preparation');
  return <div className="workspace-page jobs-page"><Heading eyebrow="작업 관리" title="작업센터" description="준비 상태와 결과를 확인하세요." /><PillTabs label="작업 유형" value={tab} onChange={setTab} options={[{ value: 'preparation', label: '화면 준비' }, { value: 'render', label: '영상 출력' }]} />
    {tab === 'render' ? <ConnectionState Icon={Clapperboard} title="영상 출력 작업이 연결되지 않았어요" description="편집 버전별 렌더와 일괄 출력은 서버 연결 후 사용할 수 있습니다." /> : <section className="workspace-panel jobs-panel"><div className="section-heading"><h2>프로젝트 상태</h2><span className="tiny-tag">데모</span></div><p className="workspace-footnote">실제 AI 작업이 아닌 브라우저의 화면 준비 상태입니다.</p>
      {projects.length ? <div className="job-list">{projects.map(project => { const info = describeProject(project, project.edit, !!videos[project.id]); return <div className="job-row" key={project.id}><span className="job-type-icon"><ListVideo size={19} /></span><div><Link to={'/projects/' + project.id}>{project.title}</Link><small>{getProjectClips(project).length}개 클립 · {getProjectLabel(project)}</small></div><span className={'project-status ' + project.status}><span />{info.statusLabel}</span>{project.status === 'processing' ? <button className="btn secondary" onClick={() => { updateProject(project.id, { status: 'cancelled' }); notify('화면 준비를 취소했어요'); }}>취소</button> : ['failed', 'cancelled'].includes(project.status) ? <button className="btn secondary" onClick={() => { updateProject(project.id, { status: 'processing', progress: 0, startedAt: Date.now() }); notify('데모 화면 준비를 다시 시작해요'); }}>다시 시작</button> : <Link className="icon-button" to={'/projects/' + project.id} aria-label={project.title + ' 열기'}><ArrowRight size={17} /></Link>}</div>; })}</div> : <div className="simple-empty"><ListVideo size={28} /><p>아직 준비할 프로젝트가 없어요.</p><Link className="btn secondary" to="/projects/new">새 영상</Link></div>}
    </section>}
  </div>;
}

export function PublishingPage() {
  return <div className="workspace-page"><Heading eyebrow="배포" title="게시·예약" description="완성한 클립을 채널에 맞춰 준비하세요." /><ConnectionState Icon={Send} title="채널 연결을 준비하고 있어요" description="현재는 외부 계정 연결과 게시·예약을 실행하지 않습니다. 먼저 프로젝트에서 클립을 편집해 보세요."><div className="planned-capabilities"><span>채널별 출력</span><span>예약 시각</span><span>실패한 게시 복구</span></div></ConnectionState></div>;
}
export function TeamPage() {
  return <div className="workspace-page"><Heading eyebrow="함께 작업하기" title="팀·검토" description="같은 편집 버전을 기준으로 의견을 모으세요." /><ConnectionState Icon={Users} title="지금은 개인 작업공간이에요" description="팀 초대·검토 링크·댓글·승인은 연결 전입니다. 개인 편집과 결과 확인은 프로젝트에서 계속할 수 있어요."><div className="planned-capabilities"><span>버전별 댓글</span><span>수정 요청</span><span>승인 이력</span></div></ConnectionState></div>;
}
export function AnalyticsPage() {
  const { projects, user, serverAuth } = useWorkspace();
  const clips = projects.reduce((count, project) => count + getProjectClips(project).length, 0);
  return <div className="workspace-page"><Heading eyebrow="작업 돌아보기" title="성과" description={serverAuth && !user?.guest ? "내 서버 작업공간의 현황을 확인하세요." : "이 브라우저의 작업 현황을 확인하세요."} /><div className="workspace-stat-grid"><div className="workspace-panel"><FolderOpen size={18} /><span>프로젝트</span><b>{projects.length}<small>개</small></b></div><div className="workspace-panel"><Layers3 size={18} /><span>저장된 클립</span><b>{clips}<small>개</small></b></div><div className="workspace-panel"><ShieldCheck size={18} /><span>영상 출력·게시</span><b className="stat-unavailable">미연결</b></div></div><ConnectionState Icon={BarChart3} title="게시 성과는 채널 연결 후 확인해요" description="조회수·참여·게시 가능 클립 수와 처리 비용을 임의의 수치로 표시하지 않습니다." /></div>;
}
export function SettingsPage() {
  const { user, projects, theme, toggleTheme, notify, serverAuth, syncStatus } = useWorkspace();
  const serverUser = serverAuth && !user?.guest;
  return <div className="workspace-page settings-page"><Heading eyebrow="작업공간 관리" title="설정" description="화면과 작업 저장 정보를 관리하세요." /><section className="workspace-panel settings-section"><div className="section-heading"><h2>내 작업공간</h2><span className="tiny-tag">{serverUser ? "서버 계정" : "로컬 데모"}</span></div><div className="settings-fact"><span>이름</span><b>{user?.name}</b></div><div className="settings-fact"><span>계정</span><b>{user?.guest ? '샘플 게스트' : user?.email}</b></div><div className="settings-fact"><span>저장 위치</span><b>{serverUser ? "서버 DB" : "현재 브라우저"}</b></div><div className="settings-fact"><span>화면 테마</span><div className="settings-theme"><button aria-pressed={theme === 'light'} onClick={() => { if (theme !== 'light') toggleTheme(); }}>라이트</button><button aria-pressed={theme === 'dark'} onClick={() => { if (theme !== 'dark') toggleTheme(); }}>다크</button></div></div></section>
    <section className="workspace-panel settings-section"><div className="section-heading"><h2>작업 백업</h2><Download size={17} /></div><p>프로젝트와 클립 편집 정보를 JSON으로 저장합니다. 원본 영상 파일과 계정 비밀번호는 포함하지 않습니다.</p><button className="btn secondary" onClick={() => { downloadText('horubak-workspace-backup.json', JSON.stringify({ schemaVersion: 3, exportedAt: new Date().toISOString(), mode: serverUser ? 'server-workspace' : 'browser-demo', projects }, null, 2), 'application/json;charset=utf-8'); notify('작업 백업을 내려받았어요'); }}><Download size={15} />편집 정보 백업</button></section>
    <section className="workspace-panel settings-section"><div className="section-heading"><h2>서비스 연결</h2><CircleHelp size={17} /></div><div className="settings-link-state"><span><Link2 size={16} />외부 계정·API·웹훅</span><small>연결 전</small></div><div className="settings-link-state"><span><ShieldCheck size={16} />사용량·플랜·결제</span><small>연결 전</small></div><p className="workspace-footnote">{serverUser ? "서버 인증·권한 검사가 적용됩니다. 영상 업로드·AI 분석·사용량·결제는 연결 전입니다." : "샘플은 브라우저에 저장됩니다. 실제 서비스는 계정으로 로그인해 주세요."}</p></section>
    {serverUser && <p className="workspace-footnote" role="status">{syncStatus === "saved" ? "편집 정보가 서버에 저장됐어요." : syncStatus === "saving" ? "서버에 저장 중이에요." : "상단에서 서버 저장 상태를 확인해 주세요."}</p>}
    <div className="settings-product"><Play size={15} /><span>호루박<small>AI 결합 영상물 하이라이트 숏폼 자동 제작 시스템</small></span></div>
  </div>;
}
