import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, ArrowRight, X } from 'lucide-react';
import { formatTime } from '../lib';
import { ADMIN_LOGIN_METHOD_LABELS, ApiError, request } from '../services/api';
import type { AdminMemberDetail, AdminProject, AdminProjectDetail, Member } from '../services/api';
import '../styles/admin-detail.css';

export type AdminDetailSelection = { kind: 'user'; id: string } | { kind: 'project'; ownerId: string; id: string };

interface AdminDetailProps {
  selection: AdminDetailSelection;
  revision: number;
  closeHref: string;
  onRole: (member: Member) => void;
  onStatus: (member: Member) => void;
  onArchive: (project: AdminProject) => void;
  currentUserId?: string;
}

type Detail = { kind: 'user'; member: AdminMemberDetail } | { kind: 'project'; project: AdminProjectDetail };
type DetailState = { key: string; detail: Detail } | { key: string; error: string; retryable: boolean };
const DATE = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Seoul' });
const PROJECT_STATUS: Record<string, string> = {
  ready: '편집 준비', processing: '화면 준비 중', completed: '편집 확인됨', failed: '준비 실패', cancelled: '준비 취소',
};
const SOURCE: Record<string, string> = { sample: '샘플', file: '파일', url: 'URL' };

function date(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return <time dateTime={value}>{DATE.format(new Date(value))}</time>;
}

function href(params: Record<string, string>) {
  return '/admin?' + new URLSearchParams(params);
}

function MemberDetail({ member, currentUserId, onRole, onStatus }: {
  member: AdminMemberDetail;
  currentUserId?: string;
  onRole: AdminDetailProps['onRole'];
  onStatus: AdminDetailProps['onStatus'];
}) {
  const self = member.id === currentUserId;
  return <>
    <h3>{member.name}{self && <span className="admin-self">나</span>}</h3>
    <dl className="admin-detail-list">
      <dt>아이디</dt><dd>{member.username ?? '—'}</dd>
      <dt>이메일</dt><dd>{member.email}</dd>
      <dt>로그인 방식</dt><dd>{member.loginMethods.map(method => ADMIN_LOGIN_METHOD_LABELS[method]).join(', ') || '—'}</dd>
      <dt>역할</dt><dd>{member.role === 'admin' ? '관리자' : '일반 회원'}</dd>
      <dt>상태</dt><dd><span className={'admin-state ' + member.status}>{member.status === 'active' ? '이용 중' : '이용 정지'}</span></dd>
      <dt>가입일</dt><dd>{date(member.createdAt)}</dd>
      <dt>최근 로그인</dt><dd>{date(member.lastLoginAt)}</dd>
      <dt>프로젝트</dt><dd>활성 {member.projectCount.toLocaleString('ko-KR')}개 · 보관 {member.archivedProjectCount.toLocaleString('ko-KR')}개</dd>
      <dt>계정 ID</dt><dd className="admin-detail-id">{member.id}</dd>
    </dl>
    <div className="admin-detail-actions">
      <button type="button" className="btn secondary" disabled={self} onClick={() => onRole(member)}>권한 변경</button>
      <button type="button" className={'btn secondary' + (member.status === 'active' ? ' admin-danger' : '')} disabled={self} onClick={() => onStatus(member)}>
        {member.status === 'active' ? '이용 정지' : '이용 복구'}
      </button>
    </div>
    <div className="admin-detail-links">
      <Link to={href({ tab: 'projects', ownerId: member.id })}>활성 프로젝트<ArrowRight size={14} aria-hidden="true" /></Link>
      <Link to={href({ tab: 'projects', ownerId: member.id, filter: 'archived' })}>보관 프로젝트<ArrowRight size={14} aria-hidden="true" /></Link>
      <Link to={href({ tab: 'activity', target: member.id })}>회원 감사 로그<ArrowRight size={14} aria-hidden="true" /></Link>
    </div>
  </>;
}

function ProjectDetail({ project, onArchive }: { project: AdminProjectDetail; onArchive: AdminDetailProps['onArchive'] }) {
  return <>
    <h3>{project.title}</h3>
    <dl className="admin-detail-list">
      <dt>소유자</dt>
      <dd><Link to={href({ tab: 'users', memberId: project.ownerId })}>{project.ownerName}</Link><span className="admin-detail-muted">{project.ownerEmail}</span></dd>
      <dt>편집 상태</dt><dd>{PROJECT_STATUS[project.status] ?? '—'}</dd>
      <dt>보관 상태</dt><dd>{project.archivedAt ? '보관됨' : '활성'}</dd>
      <dt>원본 유형</dt><dd>{project.source ? SOURCE[project.source] ?? '기타' : '—'}</dd>
      <dt>영상 길이</dt><dd>{project.duration === null ? '—' : formatTime(project.duration)}</dd>
      <dt>클립</dt><dd>{project.clipCount.toLocaleString('ko-KR')}개</dd>
      <dt>등록일</dt><dd>{date(project.createdAt)}</dd>
      <dt>수정일</dt><dd>{date(project.updatedAt)}</dd>
      {project.archivedAt && <><dt>보관일</dt><dd>{date(project.archivedAt)}</dd></>}
      <dt>프로젝트 ID</dt><dd className="admin-detail-id">{project.id}</dd>
    </dl>
    <div className="admin-detail-actions">
      <button type="button" className="btn secondary" onClick={() => onArchive(project)}>
        <Archive size={14} aria-hidden="true" />{project.archivedAt ? '프로젝트 복원' : '프로젝트 보관'}
      </button>
    </div>
    <div className="admin-detail-links">
      <Link to={href({ tab: 'activity', target: project.ownerId + '/' + project.id })}>프로젝트 감사 로그<ArrowRight size={14} aria-hidden="true" /></Link>
    </div>
  </>;
}

export function AdminDetailPanel({ selection, revision, closeHref, onRole, onStatus, onArchive, currentUserId }: AdminDetailProps) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DetailState>();
  const kind = selection.kind;
  const id = encodeURIComponent(selection.id);
  const path = kind === 'user' ? '/api/admin/users/' + id : '/api/admin/projects/' + encodeURIComponent(selection.ownerId) + '/' + id;
  const key = `${path}:${revision}:${attempt}`;
  const current = state?.key === key ? state : undefined;
  const title = kind === 'user' ? '회원 상세' : '프로젝트 상세';

  useEffect(() => {
    heading.current?.focus();
  }, [path]);

  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const read: Promise<Detail> = kind === 'user'
      ? request<AdminMemberDetail>(path, options).then(member => ({ kind, member }))
      : request<AdminProjectDetail>(path, options).then(project => ({ kind, project }));
    read.then(detail => {
      if (!controller.signal.aborted) setState({ key, detail });
    }).catch(reason => {
      if (controller.signal.aborted) return;
      const status = reason instanceof ApiError ? reason.status : 0;
      if (status === 404) setState({ key, error: '선택한 정보를 찾을 수 없습니다.', retryable: false });
      else if (status === 401 || status === 403) setState({ key, error: '로그인 상태와 관리자 권한을 확인해 주세요.', retryable: false });
      else setState({ key, error: '상세 정보를 불러오지 못했습니다.', retryable: true });
    });
    return () => controller.abort();
  }, [key, kind, path]);

  return <aside className="workspace-panel admin-detail" aria-labelledby={headingId}>
    <div className="admin-detail-header">
      <h2 ref={heading} id={headingId} tabIndex={-1}>{title}</h2>
      <Link className="icon-button" to={closeHref} aria-label={title + ' 닫기'}><X size={18} aria-hidden="true" /></Link>
    </div>
    {!current ? <p className="admin-detail-muted" role="status">상세 정보를 불러오고 있어요…</p>
      : 'error' in current ? <div className="admin-detail-error">
        <p role="alert">{current.error}</p>
        {current.retryable && <button type="button" className="btn secondary" onClick={() => {
          heading.current?.focus();
          setAttempt(count => count + 1);
        }}>다시 시도</button>}
      </div>
      : current.detail.kind === 'user' ? <MemberDetail member={current.detail.member} currentUserId={currentUserId} onRole={onRole} onStatus={onStatus} />
      : <ProjectDetail project={current.detail.project} onArchive={onArchive} />}
  </aside>;
}
