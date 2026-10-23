import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { seedProjects } from './data';
import { passwordDigest } from './lib';
import type { DemoAccount, DemoUser, Project, ToastMessage } from './types';

function read<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
function loadProjects(id: string): Project[] {
  const stored = read<unknown>(`moment.projects.${id}.v1`, null);
  return Array.isArray(stored) && stored.every(p => p && typeof p.id === 'string' && typeof p.title === 'string' && ['lecture', 'speech', 'podcast'].includes(p.genre)) ? stored as Project[] : seedProjects();
}
interface Workspace {
  user: DemoUser | null; projects: Project[]; theme: 'light' | 'dark'; toasts: ToastMessage[]; storageError: boolean;
  enterDemo: () => void;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  updateProject: (id: string, patch: Partial<Project>) => void;
  addProject: (project: Project, file?: File) => void;
  deleteProject: (id: string) => void;
  attachVideo: (id: string, file: File) => void;
  videos: Record<string, string>;
  toggleTheme: () => void;
  notify: (title: string, description?: string, kind?: ToastMessage['kind']) => void;
  dismissToast: (id: number) => void;
}
const Context = createContext<Workspace | null>(null);
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<DemoUser | null>(() => { const u = read<DemoUser | null>('moment.session.v1', null); return u && typeof u.id === 'string' && typeof u.name === 'string' ? u : null; });
  const [projects, setProjects] = useState<Project[]>(() => loadProjects(user?.id ?? 'guest'));
  const [theme, setTheme] = useState<'light' | 'dark'>(() => read<string>('moment.theme.v1', 'light') === 'dark' ? 'dark' : 'light');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [storageError, setStorageError] = useState(false);
  const [videos, setVideos] = useState<Record<string, string>>({});
  const urls = useRef(new Map<string, string>());
  const toastSeq = useRef(0);
  const notify: Workspace['notify'] = (title, description, kind = 'success') => setToasts(old => [{ id: ++toastSeq.current, title, description, kind }, ...old].slice(0, 4));
  const switchUser = (next: DemoUser) => {
    setProjects(loadProjects(next.id)); setUser(next);
    try { localStorage.setItem('moment.session.v1', JSON.stringify(next)); } catch { setStorageError(true); }
  };
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('moment.theme.v1', JSON.stringify(theme)); } catch { setStorageError(true); }
  }, [theme]);
  useEffect(() => {
    if (!user) return;
    try { localStorage.setItem(`moment.projects.${user.id}.v1`, JSON.stringify(projects)); setStorageError(false); } catch { setStorageError(true); }
  }, [projects, user]);
  const processing = projects.some(p => p.status === 'processing');
  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => setProjects(old => old.map(p => {
      if (p.status !== 'processing') return p;
      const progress = Math.min(100, Math.floor((Date.now() - (p.startedAt ?? Date.now())) / 160));
      return { ...p, progress, status: progress === 100 ? 'ready' : 'processing' };
    })), 400);
    return () => window.clearInterval(timer);
  }, [processing]);
  useEffect(() => { const ownedUrls = urls.current; return () => { ownedUrls.forEach(url => URL.revokeObjectURL(url)); ownedUrls.clear(); }; }, []);
  const attachVideo = (id: string, file: File) => {
    const old = urls.current.get(id); if (old) URL.revokeObjectURL(old);
    const url = URL.createObjectURL(file); urls.current.set(id, url); setVideos(v => ({ ...v, [id]: url }));
  };
  const login = async (email: string, password: string) => {
    const normalized = email.trim().toLowerCase();
    if (normalized === 'demo@moment.studio' && password === 'moment2026') { switchUser({ id: 'demo', name: '권준한', email: normalized, guest: false }); return; }
    const account = read<DemoAccount[]>('moment.accounts.v1', []).find(a => a.email === normalized);
    if (!account || await passwordDigest(password, account.salt) !== account.passwordHash) throw new Error('이메일 또는 비밀번호를 확인해 주세요.');
    switchUser({ id: account.id, name: account.name, email: account.email, guest: false });
  };
  const signup = async (name: string, email: string, password: string) => {
    const normalized = email.trim().toLowerCase();
    const accounts = read<DemoAccount[]>('moment.accounts.v1', []);
    if (normalized === 'demo@moment.studio' || accounts.some(a => a.email === normalized)) throw new Error('이미 등록된 데모 이메일이에요. 로그인해 주세요.');
    const salt = crypto.randomUUID();
    const account: DemoAccount = { id: crypto.randomUUID(), name: name.trim(), email: normalized, salt, passwordHash: await passwordDigest(password, salt) };
    localStorage.setItem('moment.accounts.v1', JSON.stringify([...accounts, account]));
    switchUser({ id: account.id, name: account.name, email: account.email, guest: false });
  };
  const updateProject = (id: string, patch: Partial<Project>) => setProjects(old => old.map(p => p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p));
  return <Context.Provider value={{ user, projects, theme, toasts, storageError, login, signup, updateProject, videos, attachVideo,
    enterDemo: () => switchUser({ id: 'guest', name: '크리에이터', email: 'guest@moment.local', guest: true }),
    logout: () => { setUser(null); try { localStorage.removeItem('moment.session.v1'); } catch { setStorageError(true); } },
    addProject: (project, file) => { setProjects(old => [project, ...old]); if (file) attachVideo(project.id, file); },
    deleteProject: id => { const url = urls.current.get(id); if (url) URL.revokeObjectURL(url); urls.current.delete(id); setVideos(v => { const next = { ...v }; delete next[id]; return next; }); setProjects(old => old.filter(p => p.id !== id)); },
    toggleTheme: () => setTheme(t => t === 'light' ? 'dark' : 'light'), notify, dismissToast: id => setToasts(old => old.filter(t => t.id !== id)),
  }}>{children}</Context.Provider>;
}
export function useWorkspace() { const value = useContext(Context); if (!value) throw new Error('WorkspaceProvider is required'); return value; }
