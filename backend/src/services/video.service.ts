import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffprobe from 'ffprobe-static';
import { HttpError } from '../security.js';
import type { VideoMetadata } from '../types/project.types.js';

const runProbe = promisify(execFile);
const PROBE_TIMEOUT_MS = 15_000;
const MAX_DURATION_SECONDS = 7 * 86_400;

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  disposition?: { attached_pic?: number };
}

export async function probeVideo(filePath: string, signal?: AbortSignal): Promise<VideoMetadata> {
  let stdout: string;
  try {
    ({ stdout } = await runProbe(ffprobe.path, [
      '-hide_banner', '-v', 'error', '-max_alloc', '67108864',
      '-protocol_whitelist', 'file', '-f', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0',
      '-show_entries', 'format=format_name,duration:stream=codec_type,codec_name,width,height:stream_disposition=attached_pic',
      '-of', 'json', '-i', filePath,
    ], { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, maxBuffer: 256 * 1024, windowsHide: true, signal }));
  } catch (error) {
    if (signal?.aborted) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code && ['ENOENT', 'EACCES', 'ENOEXEC', 'EPERM'].includes(code)) {
      throw new HttpError(503, 'VIDEO_PROBE_UNAVAILABLE', '서버의 영상 분석 도구를 실행할 수 없습니다.');
    }
    throw new HttpError(400, 'INVALID_VIDEO', '영상을 분석할 수 없습니다. MP4 또는 MOV 파일을 확인해 주세요.');
  }

  let result: { format?: { format_name?: string; duration?: string }; streams?: ProbeStream[] };
  try { result = JSON.parse(stdout); }
  catch { throw new HttpError(400, 'INVALID_VIDEO', '영상 정보를 읽지 못했습니다.'); }
  const streams = result.streams ?? [];
  const video = streams.find(stream => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1);
  const audio = streams.find(stream => stream.codec_type === 'audio');
  const format = result.format?.format_name;
  const duration = Number(result.format?.duration);
  const width = video?.width ?? 0;
  const height = video?.height ?? 0;
  if (!format || !(duration > 0 && duration <= MAX_DURATION_SECONDS) ||
      !Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new HttpError(400, 'INVALID_VIDEO', '재생 시간과 영상 트랙이 있는 MP4 또는 MOV 파일을 선택해 주세요.');
  }
  return { format, duration, width, height, videoCodec: video?.codec_name, audioCodec: audio?.codec_name };
}
