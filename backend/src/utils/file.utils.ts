import path from 'node:path';

export function getExtension(filename: string): string {
  return path.extname(filename).toLowerCase();
}

export function isSupportedVideo(filename: string): boolean {
  const extension = getExtension(filename);

  return extension === ".mp4" || extension === ".mov";
}
