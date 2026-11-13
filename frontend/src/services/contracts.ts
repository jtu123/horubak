/** Team integration boundary. Real auth/workspace HTTP adapters live in api.ts; AI/render gateways remain unconnected. */
import type { Candidate, DemoUser, EditState, Genre, Project, Utterance } from '../types';

export interface ApiError { code: string; message: string; requestId?: string }
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface JobView {
  id: string; projectId: string; inputVersion: number; status: JobStatus;
  stage: 'preprocess' | 'stt' | 'candidates' | 'context' | 'tracking' | 'render';
  progress: number; error?: ApiError;
}
export interface ProjectGateway {
  list(): Promise<Project[]>;
  get(id: string): Promise<Project>;
  create(input: { title: string; genre: Genre; source: File | URL }): Promise<Project>;
  rename(id: string, title: string): Promise<Project>;
  remove(id: string): Promise<void>;
}
export interface AuthGateway {
  csrf(): Promise<{ token: string; headerName: string }>;
  me(): Promise<DemoUser>;
  login(username: string, password: string): Promise<DemoUser>;
  signup(name: string, email: string, username: string, password: string): Promise<DemoUser>;
  logout(): Promise<void>;
}
export interface JobGateway { start(projectId: string, inputVersion: number): Promise<JobView>; get(id: string): Promise<JobView>; cancel(id: string): Promise<JobView> }
export interface AnalysisGateway { transcript(projectId: string): Promise<Utterance[]>; candidates(projectId: string): Promise<Candidate[]> }
export interface EditGateway { save(projectId: string, baseVersion: number, edit: EditState): Promise<{ version: number; edit: EditState }> }
export interface RenderGateway { request(projectId: string, editVersion: number): Promise<JobView>; result(projectId: string, editVersion: number): Promise<{ videoUrl: string; subtitleUrl?: string }> }
