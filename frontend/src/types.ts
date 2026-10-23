export type Genre = 'lecture' | 'speech' | 'podcast';
export type ProjectStatus = 'ready' | 'processing' | 'completed' | 'cancelled' | 'failed';
export interface Utterance { id: string; start: number; end: number; text: string; speaker: string }
export interface Candidate {
  id: string;
  title: string;
  summary: string;
  start: number;
  end: number;
  reason: string;
  evidenceIds: string[];
  score: number;
  warning?: { title: string; description: string; evidence: string; correctedStart: number; correctedEnd: number };
}
export interface EditState {
  candidateId: string;
  start: number;
  end: number;
  subtitle: string;
  subtitleSize: number;
  subtitleColor: string;
  subtitleVisible: boolean;
  cropX: number;
  cropY: number;
  scale: number;
  contextApplied: boolean;
  layout: 'speaker' | 'full';
}
export interface Project {
  id: string;
  title: string;
  genre: Genre;
  status: ProjectStatus;
  duration: number;
  createdAt: string;
  updatedAt: string;
  favorite: boolean;
  source: 'sample' | 'file' | 'url';
  sourceName: string;
  sourceUrl?: string;
  fileSize?: number;
  startedAt?: number;
  progress: number;
  edit?: EditState;
}
export interface DemoUser { id: string; name: string; email: string; guest: boolean }
export interface DemoAccount { id: string; name: string; email: string; salt: string; passwordHash: string }
export interface ToastMessage { id: number; title: string; description?: string; kind: 'success' | 'error' | 'info' }
export const GENRES: Record<Genre, string> = { lecture: '강의', speech: '연설', podcast: '팟캐스트' };
