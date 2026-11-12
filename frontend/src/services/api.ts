import type { DemoUser, Project } from '../types';

export const SERVER_AUTH = import.meta.env.VITE_AUTH_MODE !== 'demo';
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
let csrf = '';
let pendingCsrf: Promise<void> | undefined;
async function csrfToken() {
  if (csrf) return;
  if (!pendingCsrf) pendingCsrf = request<{ csrfToken: string }>('/api/auth/csrf').then(result => { csrf = result.csrfToken; }).finally(() => { pendingCsrf = undefined; });
  await pendingCsrf;
}
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const mutating = !!options.method && !['GET', 'HEAD'].includes(options.method);
  if (mutating) await csrfToken();
  let response: Response;
  try {
    const timeout = AbortSignal.timeout(15000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    response = await fetch(path, { ...options, signal, credentials: 'same-origin', headers: { ...(mutating ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}), ...options.headers } });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(0, 'UNREACHABLE', '서버에 연결하지 못했어요. 서버 실행 상태를 확인해 주세요.');
  }
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) throw new ApiError(response.status, 'API_UNAVAILABLE', '인증 서버가 연결되지 않았어요. 샘플은 별도로 이용할 수 있어요.');
  let body;
  try { body = await response.json(); } catch { throw new ApiError(response.status, 'INVALID_RESPONSE', '서버 응답을 읽지 못했어요. 다시 시도해 주세요.'); }
  if (!response.ok) {
    if (body.code === 'CSRF_REJECTED' || response.status === 401) csrf = '';
    throw new ApiError(response.status, body.code ?? 'REQUEST_FAILED', body.message ?? '요청을 처리하지 못했어요.');
  }
  if (typeof body.csrfToken === 'string') csrf = body.csrfToken;
  return body as T;
}
export interface ServerWorkspace { ownerId: string; projects: Project[]; version: number }
export type SocialProvider = 'naver' | 'google' | 'apple';
export const authApi = {
  me: () => request<{ user: DemoUser }>('/api/auth/me'),
  login: (email: string, password: string) => request<{ user: DemoUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  signup: (name: string, email: string, password: string) => request<{ user: DemoUser }>('/api/auth/signup', { method: 'POST', body: JSON.stringify({ name, email, password }) }),
  startSocialLogin: (provider: SocialProvider) => request<{ authorizationUrl: string }>(`/api/auth/social/${provider}/start`, { method: 'POST', body: '{}' }),
  logout: async () => { csrf = ''; await request('/api/auth/logout', { method: 'POST', body: '{}' }); csrf = ''; },
};
export const workspaceApi = {
  load: () => request<ServerWorkspace>('/api/workspace'),
  save: (projects: Project[], version: number, ownerId: string) => request<{ version: number }>('/api/workspace', { method: 'PUT', body: JSON.stringify({ projects, version, ownerId }) }),
};
export interface AdminOverview { users: number; activeUsers: number; admins: number; projects: number; archivedProjects: number; database: string; analysis: string; rendering: string }
export interface Member { id: string; name: string; email: string; role: 'user' | 'admin'; status: 'active' | 'suspended'; createdAt: string; lastLoginAt: string | null; projectCount: number }
export interface AdminProject { id: string; ownerId: string; ownerName: string; ownerEmail: string; archivedAt: string | null; title: string; status: string; updatedAt: string; clipCount: number }
export interface Activity { id: string; action: string; targetId: string; reason: string; createdAt: string; actorName: string | null; actorEmail: string | null }
export interface Page<T> { items: T[]; total: number; page: number; size: number }
