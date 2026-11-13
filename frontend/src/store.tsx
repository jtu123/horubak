import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { refreshDefaultSamples, seedProjects } from './data';
import { passwordDigest } from './lib';
import { ApiError, authApi, SERVER_AUTH, workspaceApi } from './services/api';
import type { ServerWorkspace } from './services/api';
import { addProjectClip, getProjectClips, loadProjectCollection, normalizeProject, patchProject, selectProjectClip, updateProjectClip } from './workspace-model';
import type { LoadedProjects } from './workspace-model';
import { workspaceLimitError } from './workspace-limits';
import { normalizeSignupUsername, normalizeUsername, USERNAME_RULES } from './username';
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
  const recordFailure = (error: unknown) => {
    savedSnapshot = undefined;
    failure = error instanceof Error ? error : new Error('서버에 저장하지 못했어요.');
    return failure;
  };

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
          throw recordFailure(error);
        }
      }).finally(() => { pending--; });
      tail = operation.then(() => {}, () => {});
      return operation;
    },
    async registerFile(current: Project[], id: string, register: (version: number, ownerId: string) => Promise<{ project: Project; version: number }>) {
      await tail;
      if (closed) throw new Error('작업공간 상태가 바뀌었어요. 다시 시도해 주세요.');
      if (failure) throw failure;

      try {
        const result = await register(version, ownerId);
        const project = normalizeProject(result.project);
        if (!project || project.id !== id || project.sourceUploaded !== true || result.version !== version + 1) {
          throw new Error('서버에 등록된 프로젝트를 다시 불러와 주세요.');
        }
        const projects = [project, ...current];
        version = result.version;
        savedSnapshot = JSON.stringify(projects);
        return { project, projects };
      } catch (error) {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500 && ![408, 409].includes(error.status)) throw error;
        throw recordFailure(error);
      }
    },
  };
}

type SaveQueue = ReturnType<typeof createWorkspaceSaveQueue>;
const CLIP_TITLE_LIMIT = 200;
const COPY_TITLE_SUFFIX = ' 복사본';
const DEMO_ACCOUNTS_KEY = 'moment.accounts.v1';
const DEMO_USERNAME = 'demo';
const DEMO_EMAIL = 'demo@moment.studio';

function availableDemoUsername(value: string, accounts: DemoAccount[]) {
  const username = normalizeSignupUsername(value);
  if (!username) throw new Error(USERNAME_RULES);
  if (username === DEMO_USERNAME || accounts.some(account => account.username === username)) throw new Error('이미 사용 중인 아이디예요.');
  return username;
}

function demoProfile({ id, name, email, username }: DemoAccount): DemoUser {
  return { id, name, email, username, guest: false };
}
interface Workspace {
  user: DemoUser | null; projects: Project[]; theme: 'light' | 'dark'; toasts: ToastMessage[]; storageError: boolean; storageNotice?: string;
  authLoading: boolean; authError: string; serverAuth: boolean;
  syncStatus: 'idle' | 'saving' | 'saved' | 'error' | 'conflict'; syncError: string;
  retrySave: () => void; reloadWorkspace: () => Promise<void>;
  enterDemo: () => void;
  login: (username: string, password: string) => Promise<void>;
  signup: (name: string, email: string, username: string, password: string) => Promise<void>;
  logout: (options?: { discardUnsaved?: boolean }) => Promise<void>;
  updateProject: (id: string, patch: Partial<Project>) => boolean;
  addProject: (project: Project, file?: File) => void;
  registerProjectFile: (project: Project, file: File, signal?: AbortSignal) => Promise<Project>;
  deleteProject: (id: string) => boolean;
  createClip: (projectId: string, candidate?: Candidate) => string;
  createClips: (projectId: string, candidates: Candidate[]) => boolean;
  selectClip: (projectId: string, clipId: string) => void;
  updateClip: (projectId: string, clipId: string, patch: Partial<EditState>) => boolean;
  renameClip: (projectId: string, clipId: string, title: string) => boolean;
  duplicateClip: (projectId: string, clipId: string) => string;
  deleteClip: (projectId: string, clipId: string) => boolean;
  replaceVideoSource: (projectId: string, file: File, duration: number) => boolean;
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
  const sessionOperation = useRef<'logout' | 'reload' | 'upload' | null>(null);
  const currentProjects = useRef(projects);
  const notify: Workspace['notify'] = (title, description, kind = 'success') => setToasts(old => [{ id: ++toastSeq.current, title, description, kind }, ...old].slice(0, 4));
  const disconnectVideos = () => { urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current.clear(); setVideos({}); };
  const replaceProjects = (next: Project[]) => { currentProjects.current = next; setProjects(next); };
  const canEdit = () => renderSession === sessionRevision.current && !sessionOperation.current;
  const limitError = (next: Project[]) => SERVER_AUTH && user && !user.guest ? workspaceLimitError(next, user.id) : undefined;
  const editProjects = (edit: (current: Project[]) => Project[], { removing = false, report = true } = {}) => {
    if (!canEdit()) {
      if (report) notify('변경 내용을 저장할 수 없어요', '작업공간 상태가 바뀌었어요. 잠시 후 다시 시도해 주세요.', 'error');
      return false;
    }
    const current = currentProjects.current;
    const next = edit(current);
    if (next === current) return false;
    const error = removing ? undefined : limitError(next);
    if (error) {
      if (report) notify('변경 내용을 저장할 수 없어요', error, 'error');
      return false;
    }
    replaceProjects(next);
    return true;
  };
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
    replaceProjects(loaded.projects); setUser(next);
    try { localStorage.setItem('moment.session.v1', JSON.stringify(next)); } catch { setStorageError(true); }
  };
  const setServerSession = (next: DemoUser, workspace?: ServerWorkspace, error = '') => {
    replaceSaveQueue(workspace ? createWorkspaceSaveQueue(workspace) : null);
    disconnectVideos(); replaceProjects(workspace?.projects ?? []); setUser(next); setAuthError(error);
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
    const isCurrent = () => active() && revision === sessionRevision.current && sessionOperation.current !== 'logout';
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
    if (sessionOperation.current) throw new Error('작업공간 상태가 바뀌는 중이에요.');
    const revision = sessionRevision.current;
    sessionOperation.current = 'reload';
    try {
      await saveQueue.current?.wait();
      const [me, workspace] = await Promise.all([authApi.me(), workspaceApi.load()]);
      if (revision === sessionRevision.current) adoptServer(me.user, workspace);
    } finally {
      sessionOperation.current = null;
      setSaveAttempt(value => value + 1);
    }
  };
  const logout: Workspace['logout'] = async ({ discardUnsaved = false } = {}) => {
    if (sessionOperation.current === 'logout') throw new Error('로그아웃 중이에요.');
    if (sessionOperation.current === 'reload') throw new Error('작업공간을 불러오는 중이에요.');
    if (sessionOperation.current === 'upload') throw new Error('원본 영상을 서버에 올리는 중이에요.');
    sessionOperation.current = 'logout';
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
        try { await authApi.logout(user.id); }
        catch (error) {
          if (!(error instanceof ApiError && error.status === 409 && error.code === 'WORKSPACE_ACCOUNT_CHANGED')) throw error;
        }
      }
      replaceSaveQueue(null); disconnectVideos(); setUser(null); replaceProjects([]);
      setAuthError(''); setSyncStatus('idle'); setSyncError('');
      try { localStorage.removeItem('moment.session.v1'); } catch { setStorageError(true); }
    } catch (error) {
      setSaveAttempt(value => value + 1);
      throw error;
    } finally {
      sessionOperation.current = null;
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
      if (!queue || sessionOperation.current || queue.isBlocked()) return;
      if (!queue.needsSave(projects)) { setSyncStatus('saved'); return; }
      setSyncStatus('saving');
      const timer = window.setTimeout(() => {
        if (!sessionOperation.current && saveQueue.current === queue) void saveWorkspace(queue, projects).catch(() => {});
      }, 500);
      return () => window.clearTimeout(timer);
    }
    if (!saveAllowed.current) { setStorageError(true); return; }
    try { localStorage.setItem(`moment.projects.${user.id}.v1`, JSON.stringify(projects)); setStorageError(false); } catch { setStorageError(true); }
  }, [projects, user, saveAttempt]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (sessionOperation.current === 'upload' || saveQueue.current?.needsSave(currentProjects.current)) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, []);
  const processing = projects.some(p => p.status === 'processing');
  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => {
      if (!canEdit()) return;
      replaceProjects(currentProjects.current.map(p => {
        if (p.status !== 'processing') return p;
        const progress = Math.min(100, Math.floor((Date.now() - (p.startedAt ?? Date.now())) / 160));
        return { ...p, progress, status: progress === 100 ? 'ready' : 'processing' };
      }));
    }, 400);
    return () => window.clearInterval(timer);
  }, [processing, renderSession]);
  useEffect(() => { const ownedUrls = urls.current; return () => { ownedUrls.forEach(url => URL.revokeObjectURL(url)); ownedUrls.clear(); }; }, []);
  const attachVideo = (id: string, file: File) => {
    const url = URL.createObjectURL(file);
    const old = urls.current.get(id); if (old) URL.revokeObjectURL(old);
    urls.current.set(id, url); setVideos(v => ({ ...v, [id]: url }));
  };
  const replaceVideoSource: Workspace['replaceVideoSource'] = (id, file, duration) => {
    if (!canEdit()) return false;
    const current = currentProjects.current;
    const project = current.find(item => item.id === id);
    if (!project || project.source === 'sample' || project.sourceUploaded) return false;
    const replacement = patchProject(project, { duration, sourceName: file.name, source: 'file', fileSize: file.size, sourceUrl: undefined, sportsSampleId: undefined });
    const next = current.map(item => item.id === id ? replacement : item);
    const error = limitError(next);
    if (error) { notify('원본을 연결할 수 없어요', error, 'error'); return false; }
    attachVideo(id, file);
    replaceProjects(next);
    return true;
  };
  const login: Workspace['login'] = async (username, password) => {
    if (SERVER_AUTH) { const result = await authApi.login(username, password); return loadServerSession(result.user); }
    const normalized = normalizeUsername(username);
    if (normalized === DEMO_USERNAME && password === 'moment2026') {
      switchUser({ id: 'demo', name: '권준한', email: DEMO_EMAIL, username: DEMO_USERNAME, guest: false });
      return;
    }
    const account = normalized ? read<DemoAccount[]>(DEMO_ACCOUNTS_KEY, []).find(item => item.username === normalized) : undefined;
    if (!account || await passwordDigest(password, account.salt) !== account.passwordHash) throw new Error('아이디 또는 비밀번호를 확인해 주세요.');
    switchUser(demoProfile(account));
  };
  const signup: Workspace['signup'] = async (name, email, username, password) => {
    if (SERVER_AUTH) { const result = await authApi.signup(name, email, username, password); return loadServerSession(result.user); }
    const address = email.trim().toLowerCase();
    const salt = crypto.randomUUID();
    const passwordHash = await passwordDigest(password, salt);
    const accounts = read<DemoAccount[]>(DEMO_ACCOUNTS_KEY, []);
    const normalized = availableDemoUsername(username, accounts);
    if (address === DEMO_EMAIL || accounts.some(account => account.email === address)) throw new Error('이미 등록된 데모 이메일이에요.');
    const account = { id: crypto.randomUUID(), name: name.trim(), email: address, username: normalized, salt, passwordHash };
    localStorage.setItem(DEMO_ACCOUNTS_KEY, JSON.stringify([...accounts, account]));
    switchUser(demoProfile(account));
  };
  const editProject = (id: string, edit: (project: Project) => Project, options?: Parameters<typeof editProjects>[1]) => editProjects(current => {
    const project = current.find(item => item.id === id);
    if (!project) return current;
    const next = edit(project);
    return next === project ? current : current.map(item => item.id === id ? next : item);
  }, options);
  const updateProject: Workspace['updateProject'] = (id, patch) => editProject(id, project => patchProject(project, patch));
  const createClip: Workspace['createClip'] = (projectId, candidate) => {
    const id = crypto.randomUUID();
    return editProject(projectId, project => addProjectClip(project, id, candidate)) ? id : '';
  };
  const createClips: Workspace['createClips'] = (projectId, candidates) => candidates.length === 0 || editProject(projectId, project => {
    for (const candidate of candidates) project = addProjectClip(project, crypto.randomUUID(), candidate);
    return project;
  });
  const selectClip: Workspace['selectClip'] = (projectId, clipId) => { editProject(projectId, project => selectProjectClip(project, clipId), { report: false }); };
  const updateClip: Workspace['updateClip'] = (projectId, clipId, patch) => editProject(projectId, project => updateProjectClip(project, clipId, patch));
  const renameClip: Workspace['renameClip'] = (projectId, clipId, title) => editProject(projectId, project => {
    const now = new Date().toISOString();
    const clips = getProjectClips(project).map(clip => clip.id === clipId ? { ...clip, title: title.trim() || clip.title, updatedAt: now } : clip);
    return normalizeProject({ ...project, clips, updatedAt: now })!;
  });
  const duplicateClip: Workspace['duplicateClip'] = (projectId, clipId) => {
    const id = crypto.randomUUID();
    const duplicated = editProject(projectId, project => {
      const clips = getProjectClips(project);
      const original = clips.find(clip => clip.id === clipId);
      if (!original) return project;
      const now = new Date().toISOString();
      const title = original.title.slice(0, CLIP_TITLE_LIMIT - COPY_TITLE_SUFFIX.length) + COPY_TITLE_SUFFIX;
      const copy = { ...original, id, title, edit: { ...original.edit }, createdAt: now, updatedAt: now };
      return normalizeProject({ ...project, clips: [...clips, copy], activeClipId: id, updatedAt: now })!;
    });
    return duplicated ? id : '';
  };
  const deleteClip: Workspace['deleteClip'] = (projectId, clipId) => editProject(projectId, project => normalizeProject({ ...project, clips: getProjectClips(project).filter(clip => clip.id !== clipId), updatedAt: new Date().toISOString() })!, { removing: true });
  const addProject: Workspace['addProject'] = (project, file) => {
    // Reading video metadata can finish after the originating session has changed.
    if (!canEdit()) throw new Error('작업공간 상태가 바뀌었어요. 다시 시도해 주세요.');
    const current = currentProjects.current;
    if (current.some(item => item.id === project.id)) return;
    const next = [normalizeProject(project)!, ...current];
    const error = limitError(next);
    if (error) throw new Error(error);
    if (file) attachVideo(project.id, file);
    replaceProjects(next);
  };
  const registerProjectFile: Workspace['registerProjectFile'] = async (project, file, signal) => {
    signal?.throwIfAborted();
    if (!canEdit()) throw new Error('작업공간 상태가 바뀌었어요. 다시 시도해 주세요.');
    if (!SERVER_AUTH || !user || user.guest || !await workspaceApi.sourceUploadsEnabled()) {
      signal?.throwIfAborted();
      addProject(project, file);
      return project;
    }

    signal?.throwIfAborted();
    if (!canEdit()) throw new Error('작업공간 상태가 바뀌었어요. 다시 시도해 주세요.');
    const queue = saveQueue.current;
    if (!queue) throw new Error('작업공간을 다시 불러온 뒤 시도해 주세요.');
    const normalized = normalizeProject({ ...project, sourceUploaded: true })!;
    const current = currentProjects.current;
    const error = limitError([normalized, ...current]);
    if (error) throw new Error(error);

    sessionOperation.current = 'upload';
    try {
      await saveWorkspace(queue, current);
      signal?.throwIfAborted();
      const saved = await queue.registerFile(current, project.id, (version, ownerId) => workspaceApi.registerFile(file, normalized, version, ownerId));
      if (saveQueue.current === queue) {
        replaceProjects(saved.projects);
        setSyncStatus('saved');
        setSyncError('');
      }
      return saved.project;
    } catch (error) {
      if (saveQueue.current === queue && queue.isBlocked()) {
        setSyncStatus(error instanceof ApiError && error.status === 409 ? 'conflict' : 'error');
        setSyncError(error instanceof Error ? error.message : '서버에 저장하지 못했어요.');
      }
      throw error;
    } finally {
      sessionOperation.current = null;
      setSaveAttempt(value => value + 1);
    }
  };
  return <Context.Provider value={{ user, projects, theme, toasts, storageError, storageNotice, authLoading, authError, serverAuth: SERVER_AUTH, syncStatus, syncError,
    retrySave: () => { if (!sessionOperation.current) { saveQueue.current?.retry(); setSaveAttempt(value => value + 1); } }, reloadWorkspace,
    enterDemo: () => switchUser({ id: 'guest', name: '크리에이터', email: 'guest@moment.local', guest: true }),
    login, signup, logout, updateProject, videos, replaceVideoSource, createClip, createClips, selectClip, updateClip, renameClip, duplicateClip, deleteClip,
    addProject, registerProjectFile,
    deleteProject: id => {
      const removed = editProjects(current => current.some(project => project.id === id) ? current.filter(project => project.id !== id) : current, { removing: true });
      if (!removed) return false;
      const url = urls.current.get(id);
      if (url) URL.revokeObjectURL(url);
      urls.current.delete(id);
      setVideos(v => { const next = { ...v }; delete next[id]; return next; });
      return true;
    },
    toggleTheme: () => setTheme(t => t === 'light' ? 'dark' : 'light'), notify, dismissToast: id => setToasts(old => old.filter(t => t.id !== id)),
  }}>{children}</Context.Provider>;
}
export function useWorkspace() { const value = useContext(Context); if (!value) throw new Error('WorkspaceProvider is required'); return value; }
