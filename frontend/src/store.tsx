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

export function createWorkspaceSaveQueue({ ownerId, projects, version: initialVersion }: ServerWorkspace, save = workspaceApi.save) {
  let version = initialVersion;
  let savedSnapshot: string | undefined = JSON.stringify(projects);
  let tail = Promise.resolve();
  let pending = 0;
  let failure: Error | undefined;
  let closed = false;

  return {
    needsSave: (next: Project[]) => pending > 0 || JSON.stringify(next) !== savedSnapshot,
    isBlocked: () => failure !== undefined,
    retry: () => { failure = undefined; },
    close: () => { closed = true; },
    wait: () => tail,
    enqueue(next: Project[]) {
      const snapshot = JSON.stringify(next);
      pending++;
      const operation = tail.then(async () => {
        if (closed) return false;
        if (failure) throw failure;
        if (snapshot === savedSnapshot) return true;
        try {
          const result = await save(next, version, ownerId);
          if (closed) return false;
          version = result.version;
          savedSnapshot = snapshot;
          return true;
        } catch (error) {
          savedSnapshot = undefined;
          failure = error instanceof Error ? error : new Error('서버에 저장하지 못했어요.');
          throw failure;
        }
      }).finally(() => { pending--; });
      tail = operation.then(() => {}, () => {});
      return operation;
    },
  };
}

type SaveQueue = ReturnType<typeof createWorkspaceSaveQueue>;
interface Workspace {
  user: DemoUser | null; projects: Project[]; theme: 'light' | 'dark'; toasts: ToastMessage[]; storageError: boolean; storageNotice?: string;
  authLoading: boolean; authError: string; serverAuth: boolean;
  syncStatus: 'idle' | 'saving' | 'saved' | 'error' | 'conflict'; syncError: string;
  retrySave: () => void; reloadWorkspace: () => Promise<void>;
  enterDemo: () => void;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: (options?: { discardUnsaved?: boolean }) => Promise<void>;
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
  const sessionRevision = useRef(0);
  const renderSession = sessionRevision.current;
  const saveQueue = useRef<SaveQueue | null>(null);
  const signingOut = useRef(false);
  const reloadingWorkspace = useRef(false);
  const currentProjects = useRef(projects); currentProjects.current = projects;
  const notify: Workspace['notify'] = (title, description, kind = 'success') => setToasts(old => [{ id: ++toastSeq.current, title, description, kind }, ...old].slice(0, 4));
  const disconnectVideos = () => { urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current.clear(); setVideos({}); };
  const replaceSaveQueue = (next: SaveQueue | null) => {
    sessionRevision.current++;
    saveQueue.current?.close();
    saveQueue.current = next;
  };
  const switchUser = (next: DemoUser) => {
    replaceSaveQueue(null); setSyncStatus('idle'); setSyncError(''); setAuthError('');
    const loaded = loadProjects(next.id);
    saveAllowed.current = loaded.writeAllowed;
    setStorageError(!loaded.writeAllowed); setStorageNotice(loaded.notice);
    if (user?.id !== next.id) disconnectVideos();
    setProjects(loaded.projects); setUser(next);
    try { localStorage.setItem('moment.session.v1', JSON.stringify(next)); } catch { setStorageError(true); }
  };
  const setServerSession = (next: DemoUser, workspace?: ServerWorkspace, error = '') => {
    replaceSaveQueue(workspace ? createWorkspaceSaveQueue(workspace) : null);
    disconnectVideos(); setProjects(workspace?.projects ?? []); setUser(next); setAuthError(error);
    setStorageError(false); setStorageNotice(undefined); setSyncStatus(workspace ? 'saved' : 'idle'); setSyncError('');
    try { localStorage.removeItem('moment.session.v1'); } catch { /* Server sessions do not depend on browser storage. */ }
  };
  const adoptServer = (next: DemoUser, workspace: ServerWorkspace) => {
    if (workspace.ownerId !== next.id) throw new ApiError(409, 'WORKSPACE_ACCOUNT_CHANGED', '로그인한 계정이 바뀌었어요. 작업공간을 다시 불러와 주세요.');
    const projects = workspace.projects.map(project => {
      const normalized = normalizeProject(project);
      if (!normalized) throw new Error('서버 프로젝트 형식을 확인하지 못했어요.');
      return normalized;
    });
    setServerSession(next, { ...workspace, projects });
  };
  const loadServerSession = async (next: DemoUser, active = () => true) => {
    const revision = sessionRevision.current;
    const isCurrent = () => active() && revision === sessionRevision.current && !signingOut.current;
    try {
      const workspace = await workspaceApi.load();
      if (isCurrent()) adoptServer(next, workspace);
    } catch (error) {
      if (isCurrent()) {
        const message = error instanceof Error && error.message ? error.message : '작업공간을 불러오지 못했어요.';
        setServerSession(next, undefined, message);
      }
    }
  };
  useEffect(() => {
    if (!SERVER_AUTH) return;
    let cancelled = false;
    (async () => {
      try { const result = await authApi.me(); if (!cancelled) await loadServerSession(result.user, () => !cancelled); }
      catch (error) { if (!cancelled && !(error instanceof ApiError && error.status === 401)) setAuthError(error instanceof Error ? error.message : '서버 연결을 확인해 주세요.'); }
      finally { if (!cancelled) setAuthLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);
  const saveWorkspace = async (queue: SaveQueue, payload: Project[]) => {
    try {
      const saved = await queue.enqueue(payload);
      if (!saved || saveQueue.current !== queue) return;
      if (!queue.needsSave(currentProjects.current)) setSyncStatus('saved');
      setSyncError('');
    } catch (error) {
      if (saveQueue.current === queue) {
        setSyncStatus(error instanceof ApiError && error.status === 409 ? 'conflict' : 'error');
        setSyncError(error instanceof Error ? error.message : '서버에 저장하지 못했어요.');
      }
      throw error;
    }
  };
  const reloadWorkspace = async () => {
    if (!SERVER_AUTH || !user || user.guest) return;
    if (reloadingWorkspace.current || signingOut.current) throw new Error('작업공간 상태가 바뀌는 중이에요.');
    const revision = sessionRevision.current;
    reloadingWorkspace.current = true;
    try {
      await saveQueue.current?.wait();
      const [me, workspace] = await Promise.all([authApi.me(), workspaceApi.load()]);
      if (revision === sessionRevision.current) adoptServer(me.user, workspace);
    } finally {
      reloadingWorkspace.current = false;
      setSaveAttempt(value => value + 1);
    }
  };
  const logout: Workspace['logout'] = async ({ discardUnsaved = false } = {}) => {
    if (signingOut.current) throw new Error('로그아웃 중이에요.');
    if (reloadingWorkspace.current) throw new Error('작업공간을 불러오는 중이에요.');
    signingOut.current = true;
    try {
      if (SERVER_AUTH && user && !user.guest) {
        const queue = saveQueue.current;
        if (queue) {
          if (discardUnsaved) {
            if (!queue.isBlocked()) throw new Error('저장 상태가 바뀌었어요. 다시 로그아웃해 주세요.');
            await queue.wait();
          } else {
            await saveWorkspace(queue, currentProjects.current);
            if (queue.needsSave(currentProjects.current)) throw new Error('저장할 변경이 생겼어요. 저장한 뒤 다시 로그아웃해 주세요.');
          }
        }
        await authApi.logout();
      }
      replaceSaveQueue(null); disconnectVideos(); setUser(null); setProjects([]);
      setAuthError(''); setSyncStatus('idle'); setSyncError('');
      try { localStorage.removeItem('moment.session.v1'); } catch { setStorageError(true); }
    } catch (error) {
      setSaveAttempt(value => value + 1);
      throw error;
    } finally {
      signingOut.current = false;
    }
  };
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('moment.theme.v1', JSON.stringify(theme)); } catch { setStorageError(true); }
  }, [theme]);
  useEffect(() => {
    if (!user) return;
    if (SERVER_AUTH && !user.guest) {
      const queue = saveQueue.current;
      if (!queue || signingOut.current || reloadingWorkspace.current || queue.isBlocked()) return;
      if (!queue.needsSave(projects)) { setSyncStatus('saved'); return; }
      setSyncStatus('saving');
      const timer = window.setTimeout(() => {
        if (!signingOut.current && !reloadingWorkspace.current && saveQueue.current === queue) void saveWorkspace(queue, projects).catch(() => {});
      }, 500);
      return () => window.clearTimeout(timer);
    }
    if (!saveAllowed.current) { setStorageError(true); return; }
    try { localStorage.setItem(`moment.projects.${user.id}.v1`, JSON.stringify(projects)); setStorageError(false); } catch { setStorageError(true); }
  }, [projects, user, saveAttempt]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (saveQueue.current?.needsSave(currentProjects.current)) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, []);
  const processing = projects.some(p => p.status === 'processing');
  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => {
      if (signingOut.current) return;
      setProjects(old => old.map(p => {
        if (p.status !== 'processing') return p;
        const progress = Math.min(100, Math.floor((Date.now() - (p.startedAt ?? Date.now())) / 160));
        return { ...p, progress, status: progress === 100 ? 'ready' : 'processing' };
      }));
    }, 400);
    return () => window.clearInterval(timer);
  }, [processing]);
  useEffect(() => { const ownedUrls = urls.current; return () => { ownedUrls.forEach(url => URL.revokeObjectURL(url)); ownedUrls.clear(); }; }, []);
  const attachVideo = (id: string, file: File) => {
    const old = urls.current.get(id); if (old) URL.revokeObjectURL(old);
    const url = URL.createObjectURL(file); urls.current.set(id, url); setVideos(v => ({ ...v, [id]: url }));
  };
  const login = async (email: string, password: string) => {
    if (SERVER_AUTH) { const result = await authApi.login(email, password); return loadServerSession(result.user); }
    const normalized = email.trim().toLowerCase();
    if (normalized === 'demo@moment.studio' && password === 'moment2026') { switchUser({ id: 'demo', name: '권준한', email: normalized, guest: false }); return; }
    const account = read<DemoAccount[]>('moment.accounts.v1', []).find(a => a.email === normalized);
    if (!account || await passwordDigest(password, account.salt) !== account.passwordHash) throw new Error('이메일 또는 비밀번호를 확인해 주세요.');
    switchUser({ id: account.id, name: account.name, email: account.email, guest: false });
  };
  const signup = async (name: string, email: string, password: string) => {
    if (SERVER_AUTH) { const result = await authApi.signup(name, email, password); return loadServerSession(result.user); }
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
  const addProject: Workspace['addProject'] = (project, file) => {
    // Reading video metadata can finish after the originating session has changed.
    if (signingOut.current || renderSession !== sessionRevision.current) throw new Error('로그인 상태를 다시 확인해 주세요.');
    setProjects(old => old.some(p => p.id === project.id) ? old : [normalizeProject(project)!, ...old]);
    if (file) attachVideo(project.id, file);
  };
  return <Context.Provider value={{ user, projects, theme, toasts, storageError, storageNotice, authLoading, authError, serverAuth: SERVER_AUTH, syncStatus, syncError,
    retrySave: () => { if (!signingOut.current) { saveQueue.current?.retry(); setSaveAttempt(value => value + 1); } }, reloadWorkspace,
    enterDemo: () => switchUser({ id: 'guest', name: '크리에이터', email: 'guest@moment.local', guest: true }),
    login, signup, logout, updateProject, videos, attachVideo, createClip, selectClip, updateClip, renameClip, duplicateClip, deleteClip,
    addProject,
    deleteProject: id => { const url = urls.current.get(id); if (url) URL.revokeObjectURL(url); urls.current.delete(id); setVideos(v => { const next = { ...v }; delete next[id]; return next; }); setProjects(old => old.filter(p => p.id !== id)); },
    toggleTheme: () => setTheme(t => t === 'light' ? 'dark' : 'light'), notify, dismissToast: id => setToasts(old => old.filter(t => t.id !== id)),
  }}>{children}</Context.Provider>;
}
export function useWorkspace() { const value = useContext(Context); if (!value) throw new Error('WorkspaceProvider is required'); return value; }
