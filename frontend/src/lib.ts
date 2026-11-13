import type { EditState, Utterance } from './types';

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function formatSize(bytes: number): string { return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`; }
export function validateVideo(file: Pick<File, 'name' | 'size'>): string | undefined {
  if (!/\.(mp4|mov)$/i.test(file.name)) return 'MP4 또는 MOV 영상을 선택해 주세요.';
  if (file.name.length > 500 || /[\u0000-\u001f\u007f]/u.test(file.name)) return '파일 이름은 특수 제어 문자 없이 500자 이내여야 해요.';
  if (file.size === 0) return '비어 있는 파일은 사용할 수 없어요.';
  if (file.size > 4 * 1024 ** 3) return '초기 입력 기준은 파일당 최대 4GB예요.';
}
export const MAX_SOURCE_URL_LENGTH = 4096;
export function validateSourceUrl(input: string): string | undefined {
  if (/[\u0000-\u001f\u007f]/u.test(input)) return '영상 주소에 줄바꿈이나 특수 제어 문자를 넣을 수 없어요.';
  if (input.trim().length > MAX_SOURCE_URL_LENGTH) return `영상 주소는 ${MAX_SOURCE_URL_LENGTH.toLocaleString('ko-KR')}자 이내로 입력해 주세요.`;
  try { const url = new URL(input); if (url.protocol !== 'https:') return 'https로 시작하는 주소를 입력해 주세요.'; if (url.username || url.password) return '인증 정보가 포함된 주소는 사용할 수 없어요.'; }
  catch { return '올바른 영상 주소를 입력해 주세요.'; }
}
export function rangeError(start: number, end: number, duration: number): string | undefined {
  if (![start, end, duration].every(Number.isFinite) || start < 0 || end > duration || end <= start) return '원본 영상 안에서 시작과 종료 시간을 확인해 주세요.';
  if (end - start < 30 || end - start > 60) return '하이라이트 길이는 30~60초로 맞춰 주세요.';
}
function srtTime(sec: number) {
  const ms = Math.max(0, Math.round(sec * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
export function buildSrt(utterances: Utterance[], edit: Pick<EditState, 'start' | 'end'>): string {
  return utterances.filter(u => u.end > edit.start && u.start < edit.end).map((u, i) => `${i + 1}\n${srtTime(Math.max(0, u.start - edit.start))} --> ${srtTime(Math.min(edit.end, u.end) - edit.start)}\n${u.text}\n`).join('\n');
}
export function downloadText(name: string, content: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function passwordDigest(password: string, salt: string) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${password}`));
  return [...new Uint8Array(buffer)].map(n => n.toString(16).padStart(2, '0')).join('');
}
