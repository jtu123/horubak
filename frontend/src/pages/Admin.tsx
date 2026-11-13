import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Database, FolderOpen, History, RefreshCw, Search, ShieldCheck, Users } from 'lucide-react';
import { AdminDetailPanel } from '../components/AdminDetails';
import type { AdminDetailSelection } from '../components/AdminDetails';
import { Modal } from '../components/Modal';
import { useWorkspace } from '../store';
import { ADMIN_LOGIN_METHOD_LABELS, ApiError, request } from '../services/api';
import type { Activity, AdminOverview, AdminProject, Member, Page } from '../services/api';
import '../styles/admin.css';

const SECTIONS = [
  { id: 'overview', label: '운영 현황', Icon: ShieldCheck },
  { id: 'users', label: '회원 관리', Icon: Users },
  { id: 'projects', label: '프로젝트 관리', Icon: FolderOpen },
  { id: 'activity', label: '감사 로그', Icon: History },
] as const;
type Tab = typeof SECTIONS[number]['id'];
const DATE_FORMAT = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Seoul' });
const DAY_FORMAT = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeZone: 'Asia/Seoul' });
function date(value: string | null) {
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? DATE_FORMAT.format(timestamp) : '—';
}
function adminHref(tab: Tab, filters: Record<string, string> = {}) {
  return '/admin?' + new URLSearchParams({ tab, ...filters });
}
type Resource<T> = { data?: T; error?: string; busy: boolean };
function useResource<T>(path: string | null, revision: number): Resource<T> {
  const key = `${revision}:${path}`;
  const [state, setState] = useState<Resource<T> & { key: string }>({ key, busy: true });
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setState({ key, busy: true });
    request<T>(path, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setState({ key, data, busy: false });
    }).catch(error => {
      if (controller.signal.aborted) return;
      const message = error instanceof ApiError && [401, 403].includes(error.status)
        ? '권한 또는 로그인 상태가 변경됐습니다. 다시 로그인해 주세요.'
        : error instanceof Error ? error.message : '정보를 불러오지 못했어요.';
      setState({ key, error: message, busy: false });
    });
    return () => controller.abort();
  }, [key, path]);
  return !path ? { busy: false } : state.key === key ? state : { busy: true };
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
    <label className="admin-label" htmlFor="admin-change-reason">변경 사유<textarea className="text-input" id="admin-change-reason" autoFocus required minLength={5} maxLength={300} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} placeholder="감사 로그에 남길 사유" /></label>
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="admin-dialog-actions"><button className="btn secondary" type="button" disabled={busy} onClick={onClose}>취소</button><button className="btn primary" disabled={busy} type="submit">{busy ? '변경 중…' : title}</button></div>
  </form></Modal>;
}
const ACTIVITY_TYPES = [
  ['account.signup', '회원가입'], ['account.login', '로그인'], ['user.update', '회원 권한·상태 변경'],
  ['user.bootstrap-admin', '관리자 지정'], ['project.archive', '프로젝트 보관'], ['project.restore', '프로젝트 복원'],
] as const;
function actionLabel(action: string) {
  const family = action.startsWith('user.update:') ? 'user.update' : action;
  return ACTIVITY_TYPES.find(([key]) => key === family)?.[1] ?? action;
}
const PROJECT_STATUS: Record<string, string> = { ready: '편집 준비', processing: '화면 준비 중', completed: '편집 확인됨', failed: '준비 실패', cancelled: '준비 취소' };

function Overview({ data, busy }: Resource<AdminOverview>) {
  const metrics = [
    { label: '최근 7일 가입', value: data?.recentSignups, href: data?.recentFrom && data.checkedAt ? adminHref('users', { from: data.recentFrom, to: DAY_FORMAT.format(new Date(data.checkedAt)) }) : undefined },
    { label: '전체 회원', value: data?.users, href: adminHref('users') },
    { label: '이용 정지', value: data ? data.users - data.activeUsers : undefined, href: adminHref('users', { filter: 'suspended' }) },
    { label: '활성 프로젝트', value: data?.projects, href: adminHref('projects') },
    { label: '보관 프로젝트', value: data?.archivedProjects, href: adminHref('projects', { filter: 'archived' }) },
  ];
  return <>
    <section className="admin-metrics" aria-label="운영 지표" aria-busy={busy}>
      {metrics.map(({ label, value, href }) => href && value !== undefined
        ? <Link key={label} to={href}><span>{label}</span><strong>{value.toLocaleString()}</strong><ArrowRight size={15} aria-hidden="true" /></Link>
        : <div key={label}><span>{label}</span><strong>—</strong></div>)}
    </section>
    <section className="workspace-panel admin-services">
      <div className="section-heading"><h2><Database size={17} aria-hidden="true" /> 인증·DB 확인</h2></div>
      <div><span>{data?.checkedAt ? `마지막 확인 ${date(data.checkedAt)}` : '인증 세션과 DB 응답'}</span>
        <span className={data?.database === 'connected' ? 'admin-state active' : 'admin-state'}>
          {data?.database === 'connected' && <Check size={12} aria-hidden="true" />}
          {busy ? '확인 중' : data?.database === 'connected' ? '응답 확인' : '확인 불가'}
        </span>
      </div>
    </section>
  </>;
}

const FILTER_KEYS = {
  users: ['q', 'filter', 'method', 'from', 'to'],
  projects: ['q', 'filter', 'ownerId', 'status', 'from', 'to'],
  activity: ['action', 'actor', 'target', 'from', 'to'],
} as const;
type ListTab = keyof typeof FILTER_KEYS;

function AdminFilters({ tab, params, onApply }: {
  tab: ListTab; params: URLSearchParams; onApply: (fields: Record<string, string>) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [rangeError, setRangeError] = useState(false);
  const qLabel = tab === 'users' ? '이름·아이디·이메일' : '제목·소유자 이름·이메일';
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fields = Object.fromEntries(FILTER_KEYS[tab].map(key => [key, String(form.get(key) ?? '').trim()]));
    if (fields.from && fields.to && fields.from > fields.to) {
      setRangeError(true);
      return;
    }
    setRangeError(false);
    onApply(fields);
  }
  const ownerId = tab === 'projects' ? params.get('ownerId') ?? '' : '';
  return <form ref={formRef} className="admin-toolbar" role="search" aria-label={tab === 'activity' ? '감사 로그 검색' : tab === 'users' ? '회원 검색' : '프로젝트 검색'} onSubmit={submit}>
    {tab !== 'activity' && <label className="admin-filter admin-filter-search">{qLabel}
      <span className="admin-search"><Search size={16} aria-hidden="true" /><input type="search" className="text-input" name="q" defaultValue={params.get('q') ?? ''} placeholder={`${qLabel} 검색`} maxLength={200} /></span>
    </label>}
    {tab === 'users' && <>
      <label className="admin-filter">회원 상태<select className="text-input" name="filter" defaultValue={params.get('filter') ?? ''}>
        <option value="">전체</option><option value="active">이용 중</option><option value="suspended">이용 정지</option>
      </select></label>
      <label className="admin-filter">로그인 방식<select className="text-input" name="method" defaultValue={params.get('method') ?? ''}>
        <option value="">전체</option>{Object.entries(ADMIN_LOGIN_METHOD_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
    </>}
    {tab === 'projects' && <>
      <label className="admin-filter">보관 상태<select className="text-input" name="filter" defaultValue={params.get('filter') ?? ''}>
        <option value="">활성</option><option value="archived">보관됨</option>
      </select></label>
      <label className="admin-filter">편집 상태<select className="text-input" name="status" defaultValue={params.get('status') ?? ''}>
        <option value="">전체</option>{Object.entries(PROJECT_STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      {ownerId && <input type="hidden" name="ownerId" value={ownerId} />}
    </>}
    {tab === 'activity' && <>
      <label className="admin-filter">작업 종류<select className="text-input" name="action" defaultValue={params.get('action') ?? ''}>
        <option value="">전체</option>{ACTIVITY_TYPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label className="admin-filter">실행자<input type="search" className="text-input" name="actor" defaultValue={params.get('actor') ?? ''} placeholder="이름·아이디·이메일" maxLength={200} /></label>
      <label className="admin-filter">대상 ID<input type="search" className="text-input" name="target" defaultValue={params.get('target') ?? ''} placeholder="회원 또는 프로젝트 대상 ID" maxLength={200} /></label>
    </>}
    <fieldset className="admin-filter-dates">
      <legend>{tab === 'users' ? '가입일' : tab === 'projects' ? '등록일' : '기록일'}</legend>
      <input type="date" className="text-input" name="from" aria-label="시작일" defaultValue={params.get('from') ?? ''} />
      <span aria-hidden="true">~</span>
      <input type="date" className="text-input" name="to" aria-label="종료일" defaultValue={params.get('to') ?? ''} />
    </fieldset>
    <div className="admin-filter-actions">
      <button type="submit" className="btn primary">검색</button>
      <button type="button" className="btn secondary" onClick={() => {
        formRef.current?.reset();
        setRangeError(false);
        onApply(Object.fromEntries(FILTER_KEYS[tab].map(key => [key, ''])));
      }}>초기화</button>
    </div>
    {ownerId && <div className="admin-filter-context">선택한 회원의 프로젝트 <Link to={adminHref('users', { memberId: ownerId })}>회원 상세</Link></div>}
    {rangeError && <p className="field-error admin-filter-context" role="alert">종료일을 시작일과 같거나 이후로 선택해 주세요.</p>}
  </form>;
}

function activityTarget(item: Activity) {
  if (item.targetKind === 'user') return adminHref('users', { memberId: item.targetId });
  if (item.targetKind === 'project') {
    const [detailOwnerId, projectId] = item.targetId.split('/');
    if (detailOwnerId && projectId) return adminHref('projects', { detailOwnerId, projectId });
  }
}

function ActivityRows({ items }: { items: Activity[] }) {
  return <>
    <thead><tr><th scope="col">작업</th><th scope="col">실행자</th><th scope="col">대상·사유</th><th scope="col">시각</th></tr></thead>
    <tbody>{items.map(item => {
      const href = activityTarget(item);
      return <tr key={item.id}>
        <td>{actionLabel(item.action)}{item.action.startsWith('user.update:') && <small className="admin-action-code">{item.action.slice('user.update:'.length)}</small>}</td>
        <td><div className="admin-cell-stack"><b>{item.actorName ?? '서버 운영자'}</b><small>{item.actorEmail ?? 'CLI'}</small></div></td>
        <td><div className="admin-cell-stack">
          {href ? <Link className="admin-target admin-detail-link" to={href} title={item.targetId}>{item.targetId}</Link> : <small className="admin-target">{item.targetId}</small>}
          {item.reason && <small className="admin-reason" title={item.reason}>{item.reason}</small>}
        </div></td>
        <td className="admin-date">{date(item.createdAt)}</td>
      </tr>;
    })}</tbody>
  </>;
}

export function AdminPage() {
  const { user, notify } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const section = SECTIONS.find(item => item.id === params.get('tab')) ?? SECTIONS[0];
  const tab = section.id;
  const rawPage = Number(params.get('page') ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const [revision, setRevision] = useState(0);
  const [action, setAction] = useState<Action | null>(null);
  const hadSelection = useRef(false);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const memberId = params.get('memberId');
  const projectId = params.get('projectId');
  const ownerId = params.get('detailOwnerId') ?? params.get('ownerId');
  let selection: AdminDetailSelection | undefined;
  if (tab === 'users' && memberId) selection = { kind: 'user', id: memberId };
  if (tab === 'projects' && projectId && ownerId) selection = { kind: 'project', id: projectId, ownerId };
  const hasSelection = !!selection;
  useEffect(() => {
    if (hadSelection.current && !hasSelection) listHeading.current?.focus();
    hadSelection.current = hasSelection;
  }, [hasSelection]);
  const withParams = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) value ? next.set(key, value) : next.delete(key);
    return next;
  };
  const closeHref = '/admin?' + withParams({ memberId: '', detailOwnerId: '', projectId: '' });
  const detailHref = (patch: Record<string, string>) => '/admin?' + withParams(patch);
  const filters = new URLSearchParams();
  if (tab !== 'overview') {
    for (const key of FILTER_KEYS[tab]) {
      const value = params.get(key);
      if (!value) continue;
      if (key === 'filter' && tab === 'projects') filters.set('archived', String(value === 'archived'));
      else filters.set(key === 'filter' ? 'status' : key, value);
    }
  }
  const filterKey = filters.toString();
  filters.set('page', String(page));
  const path = tab === 'overview' ? '/api/admin/activity?size=5' : `/api/admin/${tab}?${filters}`;
  const overview = useResource<AdminOverview>(tab === 'overview' ? '/api/admin/overview' : null, revision);
  const resource = useResource<Page<Member | AdminProject | Activity>>(path, revision);
  const refresh = () => setRevision(value => value + 1);
  const listTitle = tab === 'overview' ? '최근 감사 로그' : section.label;
  const selectedKind = selection?.kind;
  const selectedId = selection?.id;
  const selectedOwner = selection?.kind === 'project' ? selection.ownerId : undefined;
  return <div className="workspace-page admin-page">
    <div className="page-heading admin-heading">
      <h1>관리자</h1>
      <button className="btn secondary" onClick={refresh} disabled={resource.busy || overview.busy}><RefreshCw size={15} aria-hidden="true" />새로고침</button>
    </div>
    <div className="admin-layout">
      <nav className="admin-nav" aria-label="관리자 메뉴">
        {SECTIONS.map(({ id, label, Icon }) => <Link key={id} to={adminHref(id)} aria-current={tab === id ? 'page' : undefined}><Icon size={16} aria-hidden="true" />{label}</Link>)}
      </nav>
      <div className="admin-content">
        {tab === 'overview' ? overview.error
          ? <div className="admin-error" role="alert"><h2>인증·DB 상태를 확인하지 못했어요</h2><p>{overview.error}</p><button className="btn secondary" onClick={refresh}>다시 시도</button></div>
          : <Overview {...overview} />
          : <AdminFilters key={`${tab}:${filterKey}`} tab={tab} params={params} onApply={fields => setParams(withParams({ ...fields, page: '' }))} />}
        <div className={selection ? 'admin-list-layout has-detail' : 'admin-list-layout'}>
          <section className="workspace-panel admin-table-panel" aria-busy={resource.busy}>
            <div className="section-heading">
              <h2 ref={listHeading} tabIndex={-1}>{listTitle}<span>{resource.data?.total ?? '—'}</span></h2>
              {tab === 'overview' && <Link className="text-link" to={adminHref('activity')}>전체 로그<ArrowRight size={14} aria-hidden="true" /></Link>}
            </div>
            {resource.error ? <div className="admin-inline-error" role="alert">
              <p>{resource.error}</p><button className="btn secondary" onClick={refresh}>다시 시도</button>
            </div> : resource.busy ? <div className="admin-loading" role="status">서버 정보를 불러오고 있어요…</div>
              : !resource.data?.items.length ? <div className="admin-empty">
                <Search size={24} aria-hidden="true" /><h3>{filterKey ? '검색 결과가 없어요' : tab === 'projects' ? '프로젝트가 없어요' : '기록이 없어요'}</h3>
                {filterKey && <Link className="text-link" to={adminHref(tab)}>필터 초기화</Link>}
              </div> : <div className="admin-table-scroll"><table className={tab === 'activity' || tab === 'overview' ? 'admin-table admin-table-activity' : 'admin-table'}>
                <caption className="sr-only">{listTitle}</caption>
                {tab === 'users' ? <>
                  <thead><tr><th scope="col">회원</th><th scope="col">로그인 방식</th><th scope="col">역할·상태</th><th scope="col">프로젝트</th><th scope="col">최근 로그인</th></tr></thead>
                  <tbody>{(resource.data.items as Member[]).map(member => <tr key={member.id} data-selected={selectedKind === 'user' && selectedId === member.id || undefined}>
                    <td><div className="admin-person"><span className="admin-avatar" aria-hidden="true">{member.name.slice(0, 1)}</span><div>
                      <Link className="admin-detail-link" to={detailHref({ memberId: member.id })}>{member.name}{member.id === user?.id && <span className="admin-self">나</span>}</Link>
                      <small title={member.email}>{member.username ? `@${member.username} · ` : ''}{member.email}</small>
                    </div></div></td>
                    <td>{member.loginMethods?.map(method => ADMIN_LOGIN_METHOD_LABELS[method]).join(', ') || '—'}</td>
                    <td><div className="admin-cell-stack"><b>{member.role === 'admin' ? '관리자' : '일반 회원'}</b><span className={'admin-state ' + member.status}>{member.status === 'active' ? '이용 중' : '이용 정지'}</span></div></td>
                    <td>{member.projectCount}개</td><td className="admin-date">{date(member.lastLoginAt)}</td>
                  </tr>)}</tbody>
                </> : tab === 'projects' ? <>
                  <thead><tr><th scope="col">프로젝트</th><th scope="col">소유자</th><th scope="col">편집 상태</th><th scope="col">클립</th><th scope="col">수정일</th></tr></thead>
                  <tbody>{(resource.data.items as AdminProject[]).map(project => <tr key={project.ownerId + '/' + project.id} data-selected={selectedKind === 'project' && selectedId === project.id && selectedOwner === project.ownerId || undefined}>
                    <td><div className="admin-project-name"><FolderOpen size={16} aria-hidden="true" />
                      <Link className="admin-detail-link" to={detailHref({ detailOwnerId: project.ownerId, projectId: project.id })}>{project.title}</Link>
                    </div></td>
                    <td><div className="admin-cell-stack"><b>{project.ownerName}</b><small title={project.ownerEmail}>{project.ownerEmail}</small></div></td>
                    <td>{PROJECT_STATUS[project.status] ?? '—'}</td><td>{project.clipCount}개</td><td className="admin-date">{date(project.updatedAt)}</td>
                  </tr>)}</tbody>
                </> : <ActivityRows items={resource.data.items as Activity[]} />}
              </table></div>}
            {tab !== 'overview' && !resource.error && <div className="admin-pagination">
              <span>총 {resource.data?.total ?? '—'}개 · {page}페이지</span>
              <div><button className="icon-button" aria-label="이전 페이지" disabled={page === 1 || resource.busy} onClick={() => setParams(withParams({ page: String(page - 1) }))}><ArrowLeft size={16} /></button>
                <button className="icon-button" aria-label="다음 페이지" disabled={!resource.data || page * resource.data.size >= resource.data.total || resource.busy} onClick={() => setParams(withParams({ page: String(page + 1) }))}><ArrowRight size={16} /></button></div>
            </div>}
          </section>
          {selection && <AdminDetailPanel selection={selection} revision={revision} closeHref={closeHref} currentUserId={user?.id}
            onRole={member => setAction({ kind: 'role', member })} onStatus={member => setAction({ kind: 'status', member })}
            onArchive={project => setAction({ kind: 'archive', project })} />}
        </div>
      </div>
    </div>
    {action && <ChangeDialog action={action} onClose={() => setAction(null)} onChanged={() => {
      setAction(null);
      notify('변경 내용을 저장했어요', '감사 로그에 기록했습니다.');
      refresh();
    }} />}
  </div>;
}
