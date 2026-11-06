import fs from "fs";
import path from "path";

export function ensureDirectory(directory: string): void {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

export function getExtension(filename: string): string {
  return path.extname(filename).toLowerCase();
}

export function isSupportedVideo(filename: string): boolean {
  const extension = getExtension(filename);

  return extension === ".mp4" || extension === ".mov";
}