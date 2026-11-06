export type Genre = "lecture" | "speech" | "podcast";

export type InputType = "FILE" | "URL";

export interface VideoMetadata {
  filename?: string;
  format?: string;
  duration?: number;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
}

export interface CreateProjectResponse {
  success: boolean;
  projectId: string;
  status: string;
  inputType: InputType;
  genre: Genre;
  metadata?: VideoMetadata;
  message: string;
  nextAction?: string;
}