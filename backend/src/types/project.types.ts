export type Genre = "lecture" | "speech" | "podcast" | "general";

export interface VideoMetadata {
  format: string;
  duration: number;
  width: number;
  height: number;
  videoCodec?: string;
  audioCodec?: string;
}

export type ContentSignal = "speech" | "visual" | "music" | "screen";

export interface StagedProject {
  projectId: string;
  projectName: string;
  genre: Genre;
  inputType: "FILE";
  contentProfile?: { purpose: string; focus?: string; signals: ContentSignal[] };
  metadata: VideoMetadata & { filename: string };
  file: { stagedPath: string; filename: string; size: number };
}

export interface RegisteredProject {
  project: object;
  version: number;
}
