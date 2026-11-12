import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useWorkspace } from './store';
import { WorkspaceShell } from './components/lucian/WorkspaceShell';
import { ToastShelf } from './components/lucian/ToastShelf';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { NewProject } from './pages/NewProject';
import { Processing } from './pages/Processing';
import { Editor } from './pages/Editor';
import { Results } from './pages/Results';
import { ProjectHub } from './pages/ProjectHub';
import { AnalyticsPage, JobsPage, LibraryPage, PublishingPage, SettingsPage, TeamPage } from './pages/WorkspacePages';
import { CommandPalette } from './components/lucian/CommandPalette';
import { AdminPage } from './pages/Admin';

function WorkspaceLoadError({ message, reloadWorkspace, logout }: {
  message: string; reloadWorkspace: () => Promise<void>; logout: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setActionError('');
    try { await action(); }
    catch (error) { setActionError(error instanceof Error ? error.message : '다시 시도해 주세요.'); }
    finally { setBusy(false); }
  }
  return <main className="empty-state" aria-busy={busy}>
    <h1>프로젝트를 불러오지 못했어요</h1>
    <p role="alert">{actionError || message}</p>
    <div className="modal-actions">
      <button type="button" className="btn secondary" disabled={busy} onClick={() => void run(logout)}>로그아웃</button>
      <button type="button" className="btn primary" disabled={busy} onClick={() => void run(reloadWorkspace)}>다시 불러오기</button>
    </div>
  </main>;
}

export function App() {
  const { user, authLoading, authError, serverAuth, reloadWorkspace, logout } = useWorkspace(); const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => { window.scrollTo(0, 0); const heading = document.querySelector<HTMLElement>('h1'); if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); } }, [location.pathname, authLoading, authError]);
  if (authLoading) return <div className="empty-state" role="status">로그인 상태를 확인하고 있어요…</div>;
  if (serverAuth && user && !user.guest && authError) {
    const recover = async () => {
      await reloadWorkspace();
      if (location.pathname === '/login') navigate('/projects', { replace: true });
    };
    return <WorkspaceLoadError message={authError} reloadWorkspace={recover} logout={logout} />;
  }
  const administrator = serverAuth && !user?.guest && user?.role === 'admin';
  return <><Routes>
    <Route path="/login" element={<Login />} />
    <Route element={user ? <WorkspaceShell /> : <Navigate to="/login" replace />}>
      <Route path="/projects" element={<Dashboard />} />
      <Route path="/projects/new" element={<NewProject />} />
      <Route path="/projects/:id" element={<ProjectHub />} />
      <Route path="/projects/:id/processing" element={<Processing />} />
      <Route path="/projects/:id/editor" element={<Editor />} />
      <Route path="/projects/:id/results" element={<Results />} />
      <Route path="/library" element={<LibraryPage />} /><Route path="/jobs" element={<JobsPage />} />
      <Route path="/publishing" element={<PublishingPage />} /><Route path="/team" element={<TeamPage />} />
      <Route path="/analytics" element={<AnalyticsPage />} /><Route path="/settings" element={<SettingsPage />} />
      <Route path="/admin" element={administrator ? <AdminPage /> : <div className="empty-state"><h1>관리자 권한이 필요해요</h1><p>관리자 계정으로 로그인해 주세요.</p><Link className="btn secondary" to="/projects">프로젝트로 이동</Link></div>} />
    </Route>
    <Route path="/" element={<Navigate to={user ? '/projects' : '/login'} replace />} />
    <Route path="*" element={<div className="empty-state"><h1>이 페이지는 아직 없어요</h1><p>프로젝트 목록에서 다시 시작해 주세요.</p><Link className="btn primary" to="/projects">프로젝트 목록</Link></div>} />
  </Routes><ToastShelf />{user && <CommandPalette />}</>;
}
