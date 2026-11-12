import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { refreshDefaultSamples, seedProjects } from './data';
import { passwordDigest } from './lib';
import { ApiError, authApi, SERVER_AUTH, workspaceApi } from './services/api';
import type { ServerWorkspace } from './services/api';
import { addProjectClip, getProjectClips, loadProjectCollection, normalizeProject, patchProject, selectProjectClip, updateProjectClip } from './workspace-model';
import type { LoadedProjects } from './workspace-model';
import type { Candidate, DemoAccount, DemoUser, EditState, Project, ToastMessage } from './types';

function read<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
function loadProjects(id: string): LoadedProjects {
  try {
    const loaded = loadProjectCollection(localStorage, `moment.projects.${id}.v1`, seedProjects);
    return loaded.writeAllowed && !loaded.notice ? { ...loaded, projects: refreshDefaultSamples(loaded.projects) } : loaded;
  }
  catch { return { projects: seedProjects().map(p => normalizeProject(p)!), writeAllowed: false, notice: '브라우저 저장소를 사용할 수 없어요. 변경 내용은 이 창에서만 유지됩니다.' }; }
}
interface Workspace {
  user: DemoUser | null; projects: Project[]; theme: 'light' | 'dark'; toasts: ToastMessage[]; storageError: boolean; storageNotice?: string;
  authLoading: boolean; authError: string; serverAuth: boolean;
  syncStatus: 'idle' | 'saving' | 'saved' | 'error' | 'conflict'; syncError: string;
  retrySave: () => void; reloadWorkspace: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProject: (id: string, patch: Partial<Project>) => void;
  addProject: (project: Project, file?: File) => void;
  deleteProject: (id: string) => void;
  createClip: (projectId: string, candidate?: Candidate) => string;
  selectClip: (projectId: string, clipId: string) => void;
  updateClip: (projectId: string, clipId: string, patch: Partial<EditState>) => void;
  renameClip: (projectId: string, clipId: string, title: string) => void;
  duplicateClip: (projectId: string, clipId: string) => string;
  deleteClip: (projectId: string, clipId: string) => void;
  attachVideo: (id: string, file: File) => void;
  videos: Record<string, string>;
  toggleTheme: () => void;
  notify: (title: string, description?: string, kind?: ToastMessage['kind']) => void;
  dismissToast: (id: number) => void;
}
const Context = createContext<Workspace | null>(null);
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<DemoUser | null>(() => { const u = read<DemoUser | null>('moment.session.v1', null); return u && typeof u.id === 'string' && typeof u.name === 'string' && (!SERVER_AUTH || u.guest === true) ? { ...u, role: 'user' } : null; });
  const [authLoading, setAuthLoading] = useState(SERVER_AUTH);
  const [authError, setAuthError] = useState('');
  const [syncStatus, setSyncStatus] = useState<Workspace['syncStatus']>('idle');
  const [syncError, setSyncError] = useState('');
  const [saveAttempt, setSaveAttempt] = useState(0);
  const [initialLoad] = useState(() => loadProjects(user?.id ?? 'guest'));
  const [projects, setProjects] = useState<Project[]>(initialLoad.projects);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => read<string>('moment.theme.v1', 'light') === 'dark' ? 'dark' : 'light');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [storageError, setStorageError] = useState(!initialLoad.writeAllowed);
  const [storageNotice, setStorageNotice] = useState(initialLoad.notice);
  const saveAllowed = useRef(initialLoad.writeAllowed);
  const [videos, setVideos] = useState<Record<string, string>>({});
  const urls = useRef(new Map<string, string>());
  const toastSeq = useRef(0);
  const identity = useRef(0);
  const serverVersion = useRef(0);
  const savedSnapshot = useRef('');
  const saveBlocked = useRef(false);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const currentUser = useRef(user); currentUser.current = user;
  const currentProjects = useRef(projects); currentProjects.current = projects;
  const notify: Workspace['notify'] = (title, description, kind = 'success') => setToasts(old => [{ id: ++toastSeq.current, title, description, kind }, ...old].slice(0, 4));
  const disconnectVideos = () => { urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current.clear(); setVideos({}); };
  const switchUser = (next: DemoUser) => {
    identity.current++; saveBlocked.current = false; setSyncStatus('idle'); setSyncError(''); setAuthError('');
    const loaded = loadProjects(next.id);
    saveAllowed.current = loaded.writeAllowed;
    setStorageError(!loaded.writeAllowed); setStorageNotice(loaded.notice);
    if (user?.id !== next.id) disconnectVideos();
    setProjects(loaded.projects); setUser(next);
    try { localStorage.setItem('moment.session.v1', JSON.stringify(next)); } catch { setStorageError(true); }
  };
  const adoptServer = (next: DemoUser, workspace: ServerWorkspace) => {
    const normalized = workspace.projects.map(project => normalizeProject(project));
    if (normalized.some(project => !project)) throw new Error('서버 프로젝트 형식을 확인하지 못했어요.');
    identity.current++; saveBlocked.current = false;
    serverVersion.current = workspace.version; savedSnapshot.current = JSON.stringify(normalized);
    disconnectVideos(); setProjects(normalized as Project[]); setUser(next); setAuthError('');
    setStorageError(false); setStorageNotice(undefined); setSyncStatus('saved'); setSyncError('');
    try { localStorage.removeItem('moment.session.v1'); } catch { /* Server sessions do not depend on browser storage. */ }
  };
  useEffect(() => {
    if (!SERVER_AUTH) return;
    let cancelled = false;
    (async () => {
      try { const result = await authApi.me(); const workspace = await workspaceApi.load(); if (!cancelled) adoptServer(result.user, workspace); }
      catch (error) { if (!cancelled && !(error instanceof ApiError && error.status === 401)) setAuthError(error instanceof Error ? error.message : '서버 연결을 확인해 주세요.'); }
      finally { if (!cancelled) setAuthLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);
  const queueSave = (payload: Project[]) => {
    const generation = identity.current; const snapshot = JSON.stringify(payload);
    const next = saveChain.current.catch(() => {}).then(async () => {
      if (generation !== identity.current || snapshot === savedSnapshot.current) return;
      if (saveBlocked.current) throw new Error('서버 저장 상태를 확인해 주세요.');
      try {
        const result = await workspaceApi.save(payload, serverVersion.current);
        if (generation !== identity.current) return;
        serverVersion.current = result.version; savedSnapshot.current = snapshot;
        if (snapshot === JSON.stringify(currentProjects.current)) setSyncStatus('saved');
        setSyncError('');
      } catch (error) {
        if (generation === identity.current) {
          saveBlocked.current = true;
          setSyncStatus(error instanceof ApiError && error.status === 409 ? 'conflict' : 'error');
          setSyncError(error instanceof Error ? error.message : '서버에 저장하지 못했어요.');
        }
        throw error;
      }
    });
    saveChain.current = next;
    return next;
  };
  const reloadWorkspace = async () => {
    if (!SERVER_AUTH || !user || user.guest) return;
    await saveChain.current.catch(() => {});
    const [me, workspace] = await Promise.all([authApi.me(), workspaceApi.load()]);
    adoptServer(me.user, workspace);
  };
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('moment.theme.v1', JSON.stringify(theme)); } catch { setStorageError(true); }
  }, [theme]);
  useEffect(() => {
    if (!user) return;
    if (SERVER_AUTH && !user.guest) {
      if (saveBlocked.current || JSON.stringify(projects) === savedSnapshot.current) return;
      setSyncStatus('saving');
      const timer = window.setTimeout(() => { queueSave(projects).catch(() => {}); }, 500);
      return () => window.clearTimeout(timer);
    }
    if (!saveAllowed.current) { setStorageError(true); return; }
    try { localStorage.setItem(`moment.projects.${user.id}.v1`, JSON.stringify(projects)); setStorageError(false); } catch { setStorageError(true); }
  }, [projects, user, saveAttempt]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (SERVER_AUTH && currentUser.current && !currentUser.current.guest && JSON.stringify(currentProjects.current) !== savedSnapshot.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, []);
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
    if (SERVER_AUTH) { const result = await authApi.login(email, password); adoptServer(result.user, await workspaceApi.load()); return; }
    const normalized = email.trim().toLowerCase();
    if (normalized === 'demo@moment.studio' && password === 'moment2026') { switchUser({ id: 'demo', name: '권준한', email: normalized, guest: false }); return; }
    const account = read<DemoAccount[]>('moment.accounts.v1', []).find(a => a.email === normalized);
    if (!account || await passwordDigest(password, account.salt) !== account.passwordHash) throw new Error('이메일 또는 비밀번호를 확인해 주세요.');
    switchUser({ id: account.id, name: account.name, email: account.email, guest: false });
  };
  const signup = async (name: string, email: string, password: string) => {
    if (SERVER_AUTH) { const result = await authApi.signup(name, email, password); adoptServer(result.user, await workspaceApi.load()); return; }
    const normalized = email.trim().toLowerCase();
    const accounts = read<DemoAccount[]>('moment.accounts.v1', []);
    if (normalized === 'demo@moment.studio' || accounts.some(a => a.email === normalized)) throw new Error('이미 등록된 데모 이메일이에요. 로그인해 주세요.');
    const salt = crypto.randomUUID();
    const account: DemoAccount = { id: crypto.randomUUID(), name: name.trim(), email: normalized, salt, passwordHash: await passwordDigest(password, salt) };
    localStorage.setItem('moment.accounts.v1', JSON.stringify([...accounts, account]));
    switchUser({ id: account.id, name: account.name, email: account.email, guest: false });
  };
  const updateProject = (id: string, patch: Partial<Project>) => setProjects(old => old.map(p => p.id === id ? patchProject(p, patch) : p));
  const createClip: Workspace['createClip'] = (projectId, candidate) => {
    const id = crypto.randomUUID();
    setProjects(old => old.map(p => p.id === projectId ? addProjectClip(p, id, candidate) : p));
    return id;
  };
  const selectClip: Workspace['selectClip'] = (projectId, clipId) => setProjects(old => old.map(p => p.id === projectId ? selectProjectClip(p, clipId) : p));
  const updateClip: Workspace['updateClip'] = (projectId, clipId, patch) => setProjects(old => old.map(p => p.id === projectId ? updateProjectClip(p, clipId, patch) : p));
  const renameClip: Workspace['renameClip'] = (projectId, clipId, title) => setProjects(old => old.map(p => p.id === projectId ? normalizeProject({ ...p, clips: getProjectClips(p).map(clip => clip.id === clipId ? { ...clip, title: title.trim() || clip.title, updatedAt: new Date().toISOString() } : clip), updatedAt: new Date().toISOString() })! : p));
  const duplicateClip: Workspace['duplicateClip'] = (projectId, clipId) => {
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    setProjects(old => old.map(p => {
      if (p.id !== projectId) return p;
      const original = getProjectClips(p).find(clip => clip.id === clipId);
      return original ? normalizeProject({ ...p, clips: [...getProjectClips(p), { ...original, id, title: `${original.title} 복사본`, edit: { ...original.edit }, createdAt: now, updatedAt: now }], activeClipId: id, updatedAt: now })! : p;
    }));
    return id;
  };
  const deleteClip: Workspace['deleteClip'] = (projectId, clipId) => setProjects(old => old.map(p => p.id === projectId ? normalizeProject({ ...p, clips: getProjectClips(p).filter(clip => clip.id !== clipId), updatedAt: new Date().toISOString() })! : p));
  return <Context.Provider value={{ user, projects, theme, toasts, storageError, storageNotice, authLoading, authError, serverAuth: SERVER_AUTH, syncStatus, syncError,
    retrySave: () => { saveBlocked.current = false; setSaveAttempt(value => value + 1); }, reloadWorkspace,
    login, signup, updateProject, videos, attachVideo, createClip, selectClip, updateClip, renameClip, duplicateClip, deleteClip,
    logout: async () => {
      if (SERVER_AUTH && user && !user.guest) { await queueSave(currentProjects.current); await authApi.logout(); }
      identity.current++; disconnectVideos(); setUser(null); setProjects([]); setSyncStatus('idle');
      try { localStorage.removeItem('moment.session.v1'); } catch { setStorageError(true); }
    },
    addProject: (project, file) => { setProjects(old => old.some(p => p.id === project.id) ? old : [normalizeProject(project)!, ...old]); if (file) attachVideo(project.id, file); },
    deleteProject: id => { const url = urls.current.get(id); if (url) URL.revokeObjectURL(url); urls.current.delete(id); setVideos(v => { const next = { ...v }; delete next[id]; return next; }); setProjects(old => old.filter(p => p.id !== id)); },
    toggleTheme: () => setTheme(t => t === 'light' ? 'dark' : 'light'), notify, dismissToast: id => setToasts(old => old.filter(t => t.id !== id)),
  }}>{children}</Context.Provider>;
}
export function useWorkspace() { const value = useContext(Context); if (!value) throw new Error('WorkspaceProvider is required'); return value; }
