import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import multer from 'multer';
import env from '../config/env.js';
import { createProject } from '../controllers/project.controller.js';
import { HttpError } from '../security.js';
import type { RegisteredProject, StagedProject } from '../types/project.types.js';
import { getExtension, isSupportedVideo } from '../utils/file.utils.js';

const MIB = 1024 * 1024;
const MAX_UPLOADS = 2;
const RECEIVE_TIMEOUT_MS = 5 * 60 * 1000;

interface ProjectRouterOptions {
  authorize: RequestHandler;
  register: (project: StagedProject, request: Request) => RegisteredProject | Promise<RegisteredProject>;
  uploadDir?: string;
  maxFileSizeMb?: number;
}

function uploadError(error: unknown) {
  if (error instanceof HttpError) return error;
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') return new HttpError(413, 'VIDEO_TOO_LARGE', '서버의 영상 파일 크기 제한을 초과했습니다.');
    return new HttpError(400, 'INVALID_MULTIPART', '영상 한 개와 프로젝트 정보를 확인해 주세요.');
  }
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOSPC' || code === 'EDQUOT') return new HttpError(507, 'UPLOAD_STORAGE_FULL', '서버에 영상을 저장할 공간이 부족합니다.');
  if (code) return error;
  return new HttpError(400, 'INVALID_MULTIPART', '영상 등록 요청 형식을 확인해 주세요.');
}

export function createProjectRouter({
  authorize,
  register,
  uploadDir = env.uploadDir,
  maxFileSizeMb = env.maxFileSizeMb,
}: ProjectRouterOptions) {
  if (!Number.isFinite(maxFileSizeMb) || maxFileSizeMb < 1 || maxFileSizeMb > 4096) {
    throw new RangeError('MAX_FILE_SIZE_MB must be between 1 and 4096');
  }

  const fileSize = Math.floor(maxFileSizeMb * MIB);
  const stagingRoot = join(resolve(uploadDir), '.staging');
  const directories = new WeakMap<Request, string>();
  let activeUploads = 0;
  const upload = multer({
    storage: multer.diskStorage({
      destination(req, _file, next) { next(null, directories.get(req)!); },
      filename(_req, file, next) { next(null, randomUUID() + getExtension(file.originalname)); },
    }),
    defParamCharset: 'utf8',
    fileFilter(_req, file, next) {
      if (!isSupportedVideo(file.originalname)) {
        next(new HttpError(400, 'UNSUPPORTED_VIDEO', 'MP4 또는 MOV 파일만 등록할 수 있습니다.'));
        return;
      }
      next(null, true);
    },
    limits: { fileSize: fileSize + 1, files: 1, fields: 5, parts: 7, fieldSize: 2048, fieldNameSize: 32, headerPairs: 16 },
  }).single('file');

  const router = Router();
  router.post('/', authorize, async (req, res, next) => {
    if (!req.is('multipart/form-data')) throw new HttpError(415, 'MULTIPART_REQUIRED', '영상 등록에는 multipart/form-data가 필요합니다.');
    const contentLength = Number(req.get('content-length'));
    if (contentLength > fileSize + 64 * 1024) throw new HttpError(413, 'VIDEO_TOO_LARGE', '서버의 영상 파일 크기 제한을 초과했습니다.');
    if (activeUploads >= MAX_UPLOADS) throw new HttpError(503, 'UPLOAD_BUSY', '서버가 다른 영상을 등록 중입니다. 잠시 후 다시 시도해 주세요.');

    activeUploads++;
    const abort = new AbortController();
    const disconnect = () => { if (!res.writableEnded) abort.abort(); };
    const timer = setTimeout(() => req.destroy(), RECEIVE_TIMEOUT_MS);
    res.once('close', disconnect);
    if (res.destroyed) abort.abort();
    let result: Awaited<ReturnType<typeof createProject>> | undefined;
    let failure: unknown;
    try {
      // A private per-request directory covers parser failures as well as files
      // successfully streamed before validation or project registration fails.
      await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
      const directory = await mkdtemp(join(stagingRoot, 'project-'));
      directories.set(req, directory);
      abort.signal.throwIfAborted();
      await new Promise<void>((complete, fail) => {
        upload(req, res, error => error ? fail(uploadError(error)) : complete());
      });
      clearTimeout(timer);
      if (req.file && req.file.size > fileSize) {
        throw new HttpError(413, 'VIDEO_TOO_LARGE', '서버의 영상 파일 크기 제한을 초과했습니다.');
      }
      abort.signal.throwIfAborted();
      result = await createProject(req, register, abort.signal);
    } catch (error) {
      failure = error ?? new HttpError(500, 'UPLOAD_FAILED', '영상을 등록하지 못했습니다.');
    } finally {
      clearTimeout(timer);
      res.off('close', disconnect);
      const directory = directories.get(req);
      directories.delete(req);
      try {
        if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch (error) {
        console.error('Upload staging cleanup failed:', (error as NodeJS.ErrnoException).code ?? 'unknown');
      } finally {
        activeUploads--;
      }
    }
    if (abort.signal.aborted || res.destroyed) return;
    if (result) res.status(201).json(result);
    else next(failure);
  });
  return router;
}
