/** Legacy presets remain readable; new video projects use the general profile. */
export type Genre = 'lecture' | 'speech' | 'podcast' | 'general';
export type ContentSignal = 'speech' | 'visual' | 'music' | 'screen';
export type AspectRatio = '9:16' | '1:1' | '16:9' | '4:5';
export interface ContentProfile { purpose: string; focus?: string; signals: ContentSignal[] }
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
  evidenceKind?: 'speech' | 'scene' | 'sound';
  warning?: { title: string; description: string; evidence: string; correctedStart: number; correctedEnd: number };
}
export interface VisualEvidence { id: string; start: number; end: number; title: string; description: string; kind: 'scene' | 'sound' }
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
  aspectRatio?: AspectRatio;
  showSafeArea?: boolean;
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
  sportsSampleId?: string;
  sourceUrl?: string;
  fileSize?: number;
  startedAt?: number;
  progress: number;
  edit?: EditState;
  schemaVersion?: 3;
  legacyGenre?: string;
  contentProfile?: ContentProfile;
  clips?: Clip[];
  activeClipId?: string;
  dismissedCandidateIds?: string[];
}
export interface Clip { id: string; title: string; edit: EditState; createdAt: string; updatedAt: string }
export interface DemoUser { id: string; name: string; email: string; guest: boolean; role?: 'user' | 'admin' }
export interface DemoAccount { id: string; name: string; email: string; salt: string; passwordHash: string }
export interface ToastMessage { id: number; title: string; description?: string; kind: 'success' | 'error' | 'info' }
export const GENRES: Record<Genre, string> = { lecture: '강의', speech: '연설', podcast: '팟캐스트', general: '영상' };
