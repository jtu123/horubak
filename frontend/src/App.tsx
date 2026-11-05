import { useEffect } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
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
export function App() {
  const { user } = useWorkspace(); const location = useLocation();
  useEffect(() => { window.scrollTo(0, 0); const heading = document.querySelector<HTMLElement>('h1'); if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); } }, [location.pathname]);
  return <><Routes><Route path="/login" element={<Login />} /><Route element={user ? <WorkspaceShell /> : <Navigate to="/login" replace />}><Route path="/projects" element={<Dashboard />} /><Route path="/projects/new" element={<NewProject />} /><Route path="/projects/:id" element={<ProjectHub />} /><Route path="/projects/:id/processing" element={<Processing />} /><Route path="/projects/:id/editor" element={<Editor />} /><Route path="/projects/:id/results" element={<Results />} /><Route path="/library" element={<LibraryPage />} /><Route path="/jobs" element={<JobsPage />} /><Route path="/publishing" element={<PublishingPage />} /><Route path="/team" element={<TeamPage />} /><Route path="/analytics" element={<AnalyticsPage />} /><Route path="/settings" element={<SettingsPage />} /></Route><Route path="/" element={<Navigate to={user ? '/projects' : '/login'} replace />} /><Route path="*" element={<div className="empty-state"><h1>이 페이지는 아직 없어요</h1><p>프로젝트 목록에서 다시 시작해 주세요.</p><Link className="btn primary" to="/projects">프로젝트 목록</Link></div>} /></Routes><ToastShelf />{user && <CommandPalette />}</>;
}
