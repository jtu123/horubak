import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Archive, ArrowLeft, ArrowRight, Check, Database, FolderOpen, History, RefreshCw, Search, ShieldCheck, Users } from 'lucide-react';
import { Modal } from '../components/Modal';
import { useWorkspace } from '../store';
import { ApiError, request } from '../services/api';
import type { Activity, AdminOverview, AdminProject, Member, Page } from '../services/api';
import '../styles/admin.css';

const SECTIONS = [{ id: 'overview', label: '운영 현황', Icon: ShieldCheck }, { id: 'users', label: '회원', Icon: Users }, { id: 'projects', label: '프로젝트', Icon: FolderOpen }, { id: 'activity', label: '작업 이력', Icon: History }];
function date(value: string | null) { return value ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'; }
function useResource<T>(path: string, revision: number) {
  const [state, setState] = useState<{ data?: T; error?: string; busy: boolean }>({ busy: true });
  useEffect(() => {
    const controller = new AbortController(); setState({ busy: true });
    request<T>(path, { signal: controller.signal }).then(data => setState({ data, busy: false })).catch(error => {
      if (!controller.signal.aborted) setState({ busy: false, error: error instanceof ApiError && [401, 403].includes(error.status) ? '권한 또는 로그인 상태가 변경됐습니다. 다시 로그인해 주세요.' : error.message });
    });
    return () => controller.abort();
  }, [path, revision]);
  return state;
}
type Action = { kind: 'role'; member: Member } | { kind: 'status'; member: Member } | { kind: 'archive'; project: AdminProject };
function ChangeDialog({ action, onClose, onChanged }: { action: Action; onClose: () => void; onChanged: () => void }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [role, setRole] = useState(action.kind === 'role' && action.member.role === 'admin' ? 'user' : 'admin');
  const title = action.kind === 'role' ? '회원 권한 변경' : action.kind === 'status' ? (action.member.status === 'active' ? '회원 이용 정지' : '회원 이용 복구') : action.project.archivedAt ? '프로젝트 복원' : '프로젝트 보관';
  const target = action.kind === 'archive' ? action.project.title : action.member.name;
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    if (reason.trim().length < 5) { setError('변경 사유를 5자 이상 입력해 주세요.'); return; }
    setBusy(true); setError('');
    const path = action.kind === 'archive' ? `/api/admin/projects/${encodeURIComponent(action.project.ownerId)}/${encodeURIComponent(action.project.id)}` : '/api/admin/users/' + encodeURIComponent(action.member.id);
    const patch = action.kind === 'role' ? { role } : action.kind === 'status' ? { status: action.member.status === 'active' ? 'suspended' : 'active' } : { archived: !action.project.archivedAt };
    try { await request(path, { method: 'PATCH', body: JSON.stringify({ ...patch, reason: reason.trim() }) }); onChanged(); }
    catch (error) { setError(error instanceof Error ? error.message : '변경하지 못했어요.'); }
    finally { setBusy(false); }
  }
  return <Modal title={title} onClose={() => { if (!busy) onClose(); }}><form className="admin-change" onSubmit={submit} aria-busy={busy}>
    <p><b>{target}</b>{action.kind === 'archive' ? action.project.archivedAt ? '을 프로젝트 목록으로 복원합니다.' : '을 사용자 프로젝트 목록에서 보관합니다. 편집 정보는 유지됩니다.' : action.kind === 'role' ? '의 역할을 변경합니다. 해당 회원은 다시 로그인해야 합니다.' : action.member.status === 'active' ? '의 모든 세션을 종료하고 로그인을 차단합니다.' : '의 로그인을 다시 허용합니다.'}</p>
    {action.kind === 'role' && <label className="admin-label">역할<select className="text-input" value={role} disabled={busy} onChange={event => setRole(event.target.value)}><option value="user">일반 회원</option><option value="admin">관리자</option></select></label>}
    <label className="admin-label" htmlFor="admin-change-reason">변경 사유<textarea className="text-input" id="admin-change-reason" autoFocus required minLength={5} maxLength={300} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} placeholder="작업 이력에 남길 사유" /></label>
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="admin-dialog-actions"><button className="btn secondary" type="button" disabled={busy} onClick={onClose}>취소</button><button className="btn primary" disabled={busy} type="submit">{busy ? '변경 중…' : title}</button></div>
  </form></Modal>;
}
function actionLabel(action: string) {
  if (action.startsWith('user.update:')) return '회원 권한·상태 변경';
  return ({ 'account.signup': '회원가입', 'account.login': '로그인', 'user.bootstrap-admin': '관리자 지정', 'project.archive': '프로젝트 보관', 'project.restore': '프로젝트 복원' } as Record<string, string>)[action] ?? action;
}
const PROJECT_STATUS: Record<string, string> = { ready: '편집 준비', processing: '화면 준비 중', completed: '편집 확인됨', failed: '준비 실패', cancelled: '준비 취소' };
export function AdminPage() {
  const { user, notify } = useWorkspace(); const [params, setParams] = useSearchParams();
  const tab = SECTIONS.some(section => section.id === params.get('tab')) ? params.get('tab')! : 'overview';
  const rawPage = Number(params.get('page') ?? 1); const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const q = params.get('q') ?? ''; const filter = params.get('filter') ?? '';
  const [query, setQuery] = useState(q); const [revision, setRevision] = useState(0); const [action, setAction] = useState<Action | null>(null);
  useEffect(() => { setQuery(q); }, [q, tab]);
  const overview = useResource<AdminOverview>('/api/admin/overview', revision);
  const url = tab === 'overview' ? '/api/admin/activity?size=5' : `/api/admin/${tab}?` + new URLSearchParams({ page: String(page), q, ...(tab === 'users' ? { status: filter } : tab === 'projects' ? { archived: String(filter === 'archived') } : {}) });
  const resource = useResource<Page<Member | AdminProject | Activity>>(url, revision);
  const refresh = () => setRevision(value => value + 1);
  const update = (patch: Record<string, string>) => { const next = new URLSearchParams(params); Object.entries(patch).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key)); setParams(next); };
  const error = overview.error ?? resource.error;
  const activities = (resource.data?.items ?? []) as Activity[];
  return <div className="workspace-page admin-page">
    <div className="page-heading admin-heading"><div><div className="page-eyebrow">호루박 운영</div><h1>관리자</h1><p>회원과 프로젝트의 서버 저장 정보를 관리합니다.</p></div><button className="btn secondary" onClick={refresh} disabled={resource.busy || overview.busy}><RefreshCw size={15} />새로고침</button></div>
    <nav className="admin-nav" aria-label="관리자 메뉴">{SECTIONS.map(({ id, label, Icon }) => <Link key={id} to={'/admin?tab=' + id} aria-current={tab === id ? 'page' : undefined}><Icon size={16} />{label}</Link>)}</nav>
    {error ? <section className="admin-error" role="alert"><h2>정보를 불러오지 못했어요</h2><p>{error}</p><button className="btn secondary" onClick={refresh}>다시 시도</button></section> : <>
      {tab === 'overview' && <>
        <section className="admin-metrics" aria-label="운영 현황">
          {[{ label: '전체 회원', value: overview.data?.users, meta: `활성 ${overview.data?.activeUsers ?? '—'}명` }, { label: '프로젝트', value: overview.data?.projects, meta: `보관 ${overview.data?.archivedProjects ?? '—'}개` }, { label: '활성 관리자', value: overview.data?.admins, meta: '서버 권한 적용' }].map(metric => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value?.toLocaleString() ?? '—'}</strong><small>{metric.meta}</small></div>)}
        </section>
        <section className="workspace-panel admin-services"><div className="section-heading"><h2>서비스 연결</h2><Database size={17} /></div><div><span>회원·세션·프로젝트 DB</span><span className="admin-state active"><Check size={12} />연결됨</span></div><div><span>AI 분석 작업 큐</span><span className="admin-state">미연결</span></div><div><span>영상 렌더·게시</span><span className="admin-state">미연결</span></div></section>
      </>}
      {(tab === 'users' || tab === 'projects') && <form className="admin-toolbar" role="search" aria-label={tab === 'users' ? '회원 검색' : '프로젝트 검색'} onSubmit={event => { event.preventDefault(); update({ q: query.trim(), page: '' }); }}>
        <div className="admin-search"><Search size={16} /><input className="text-input" aria-label={tab === 'users' ? '이름 또는 이메일' : '제목 또는 소유자 이메일'} placeholder={tab === 'users' ? '이름 또는 이메일 검색' : '제목 또는 소유자 이메일 검색'} maxLength={200} value={query} onChange={event => setQuery(event.target.value)} /><button className="btn secondary" type="submit">검색</button></div>
        <select className="text-input" aria-label="목록 필터" value={filter} onChange={event => update({ filter: event.target.value, page: '' })}>{tab === 'users' ? <><option value="">모든 회원</option><option value="active">이용 중</option><option value="suspended">이용 정지</option></> : <><option value="">활성 프로젝트</option><option value="archived">보관된 프로젝트</option></>}</select>
      </form>}
      <section className="workspace-panel admin-table-panel" aria-busy={resource.busy}>
        <div className="section-heading"><h2>{tab === 'overview' ? '최근 작업 이력' : SECTIONS.find(section => section.id === tab)?.label}<span>{resource.data?.total ?? '—'}</span></h2>{tab === 'overview' && <Link className="text-link" to="/admin?tab=activity">전체 이력<ArrowRight size={14} /></Link>}</div>
        {resource.busy ? <div className="admin-loading" role="status">서버 정보를 불러오고 있어요…</div> : !resource.data?.items.length ? <div className="admin-empty"><Search size={24} /><h3>{q ? '검색 결과가 없어요' : tab === 'projects' ? '프로젝트가 없어요' : '기록이 없어요'}</h3><p>{q ? '검색어나 필터를 바꿔 보세요.' : '서버에 저장되는 정보가 여기에 표시됩니다.'}</p>{q && <button className="btn secondary" onClick={() => update({ q: '', filter: '', page: '' })}>검색 초기화</button>}</div> : <div className="admin-table-scroll"><table className="admin-table">
          <caption className="sr-only">{tab === 'users' ? '회원 목록' : tab === 'projects' ? '프로젝트 목록' : '관리자와 회원의 작업 이력'}</caption>
          {tab === 'users' ? <><thead><tr><th scope="col">회원</th><th scope="col">역할</th><th scope="col">상태</th><th scope="col">프로젝트</th><th scope="col">최근 로그인</th><th scope="col">관리</th></tr></thead><tbody>{(resource.data.items as Member[]).map(member => <tr key={member.id}><td><div className="admin-person"><span className="admin-avatar" aria-hidden="true">{member.name.slice(0, 1)}</span><div><b title={member.name}>{member.name}{member.id === user?.id && <span className="admin-self">나</span>}</b><small title={member.email}>{member.email}</small></div></div></td><td>{member.role === 'admin' ? '관리자' : '일반 회원'}</td><td><span className={'admin-state ' + member.status}>{member.status === 'active' ? '이용 중' : '이용 정지'}</span></td><td>{member.projectCount}개</td><td className="admin-date">{date(member.lastLoginAt)}</td><td><div className="admin-row-actions"><button className="btn secondary" disabled={member.id === user?.id} title={member.id === user?.id ? '자신의 권한은 변경할 수 없습니다' : undefined} onClick={() => setAction({ kind: 'role', member })}>권한 변경</button><button className={'btn secondary' + (member.status === 'active' ? ' admin-danger' : '')} disabled={member.id === user?.id} onClick={() => setAction({ kind: 'status', member })}>{member.status === 'active' ? '이용 정지' : '이용 복구'}</button></div></td></tr>)}</tbody></> : tab === 'projects' ? <><thead><tr><th scope="col">프로젝트</th><th scope="col">소유자</th><th scope="col">편집 상태</th><th scope="col">클립</th><th scope="col">수정일</th><th scope="col">관리</th></tr></thead><tbody>{(resource.data.items as AdminProject[]).map(project => <tr key={project.ownerId + '/' + project.id}><td><div className="admin-project-name"><FolderOpen size={17} /><b title={project.title}>{project.title}</b></div></td><td><div className="admin-cell-stack"><b>{project.ownerName}</b><small title={project.ownerEmail}>{project.ownerEmail}</small></div></td><td>{PROJECT_STATUS[project.status] ?? project.status}</td><td>{project.clipCount}개</td><td className="admin-date">{date(project.updatedAt)}</td><td><button className="btn secondary" onClick={() => setAction({ kind: 'archive', project })}><Archive size={13} />{project.archivedAt ? '복원' : '보관'}</button></td></tr>)}</tbody></> : <><thead><tr><th scope="col">작업</th><th scope="col">실행자</th><th scope="col">대상·사유</th><th scope="col">시각</th></tr></thead><tbody>{activities.map(item => <tr key={item.id}><td>{actionLabel(item.action)}</td><td><div className="admin-cell-stack"><b>{item.actorName ?? '서버 운영자'}</b><small>{item.actorEmail ?? 'CLI'}</small></div></td><td><div className="admin-cell-stack"><b className="admin-reason" title={item.reason}>{item.reason || '—'}</b><small className="admin-target" title={item.targetId}>{item.targetId}</small>{item.action.startsWith('user.update:') && <small>{item.action.slice('user.update:'.length)}</small>}</div></td><td className="admin-date">{date(item.createdAt)}</td></tr>)}</tbody></>}
        </table></div>}
        {tab !== 'overview' && <div className="admin-pagination"><span>총 {resource.data?.total ?? 0}개 · {page}페이지</span><div><button className="icon-button" aria-label="이전 페이지" disabled={page === 1 || resource.busy} onClick={() => update({ page: String(page - 1) })}><ArrowLeft size={16} /></button><button className="icon-button" aria-label="다음 페이지" disabled={!resource.data || page * resource.data.size >= resource.data.total || resource.busy} onClick={() => update({ page: String(page + 1) })}><ArrowRight size={16} /></button></div></div>}
      </section>
    </>}
    {action && <ChangeDialog action={action} onClose={() => setAction(null)} onChanged={() => { setAction(null); notify('변경 내용을 저장했어요', '작업 이력에 기록했습니다.'); refresh(); }} />}
  </div>;
}
