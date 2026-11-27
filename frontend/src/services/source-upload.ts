import type { Project } from '../types';

const uploads = new Set<string>();
export const sourceUploadKey = (ownerId: string | undefined, project: Project) => JSON.stringify([
  ownerId, project.id, project.source, project.sourceName, project.duration, project.fileSize, project.sourceUrl, project.sportsSampleId,
]);

/** Both analysis panels share this guard; an upload capability stays only in memory. */
export async function withSourceUpload<T>(key: string, signal: AbortSignal, upload: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  if (uploads.has(key)) throw new Error('다른 화면에서 이 원본을 업로드 중이에요. 완료 후 다시 불러와 주세요.');
  uploads.add(key);
  try { return await upload(); }
  finally { uploads.delete(key); }
}
