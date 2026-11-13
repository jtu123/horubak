import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Request } from 'express';
import env from './config/env.js';
import type { Database } from './database-contract.js';
import { createProjectRouter } from './routes/project.routes.js';
import { HttpError } from './security.js';
import type { ServerOptions } from './server.js';
import type { StagedProject } from './types/project.types.js';

export function mountProjectSources(db: Database, directory = env.uploadDir): NonNullable<ServerOptions['mountSources']> {
  const uploadDir = resolve(directory);
  const originals = join(uploadDir, 'files');
  mkdirSync(originals, { recursive: true, mode: 0o700 });

  return (app, security) => {
    function expectedOwner(req: Request) {
      const user = security.user(req);
      if (req.get('x-workspace-owner') !== user.id) throw new HttpError(409, 'WORKSPACE_ACCOUNT_CHANGED', '로그인한 계정을 다시 확인해 주세요.');
      return user;
    }

    function expectedVersion(req: Request) {
      const header = req.get('x-workspace-version');
      const version = Number(header);
      if (!header || !/^\d+$/.test(header) || !Number.isSafeInteger(version)) throw new HttpError(400, 'INVALID_WORKSPACE', '작업공간 버전을 확인해 주세요.');
      return version;
    }

    function register(staged: StagedProject, req: Request) {
      const owner = expectedOwner(req);
      const version = expectedVersion(req);
      const path = join(originals, staged.file.filename);
      let moved = false;
      try {
        return db.transaction(() => {
          if (owner.workspace_version !== version) throw new HttpError(409, 'VERSION_CONFLICT', '작업공간이 변경됐어요. 서버 내용을 다시 불러와 주세요.');
          const count = db.prepare('SELECT count(*) AS count FROM projects WHERE owner_id=? AND archived_at IS NULL').get(owner.id);
          if (Number(count?.count) >= 100) throw new HttpError(400, 'PROJECT_LIMIT', '프로젝트는 최대 100개까지 만들 수 있어요.');
          if (db.prepare('SELECT 1 FROM projects WHERE owner_id=? AND id=?').get(owner.id, staged.projectId)) {
            throw new HttpError(409, 'PROJECT_EXISTS', '이미 등록된 프로젝트 ID입니다. 작업공간을 다시 불러와 주세요.');
          }
          const now = new Date().toISOString();
          const project = {
            id: staged.projectId, title: staged.projectName, genre: staged.genre, status: 'ready',
            duration: staged.metadata.duration, source: 'file', sourceName: staged.metadata.filename,
            fileSize: staged.file.size, sourceUploaded: true, createdAt: now, updatedAt: now,
            favorite: false, progress: 100, clips: [], contentProfile: staged.contentProfile,
          };
          renameSync(staged.file.stagedPath, path);
          moved = true;
          db.prepare('INSERT INTO projects(owner_id,id,document) VALUES(?,?,?)').run(owner.id, project.id, JSON.stringify(project));
          db.prepare('INSERT INTO project_sources(owner_id,project_id,filename) VALUES(?,?,?)').run(owner.id, project.id, staged.file.filename);
          db.prepare('UPDATE users SET workspace_version=workspace_version+1 WHERE id=?').run(owner.id);
          return { project, version: version + 1 };
        });
      } catch (error) {
        if (moved) {
          try { rmSync(path, { force: true }); }
          catch (cleanupError) { console.error('Original file cleanup failed:', (cleanupError as NodeJS.ErrnoException).code ?? 'unknown'); }
        }
        throw error;
      }
    }

    app.use('/api/projects', createProjectRouter({
      uploadDir,
      authorize(req, _res, next) {
        security.verifyMutation(req);
        const owner = expectedOwner(req);
        if (owner.workspace_version !== expectedVersion(req)) throw new HttpError(409, 'VERSION_CONFLICT', '작업공간이 변경됐어요. 서버 내용을 다시 불러와 주세요.');
        next();
      },
      register,
    }));
    app.get('/api/projects/:id/source', (req, res, next) => {
      const user = security.user(req);
      const source = db.prepare(`SELECT s.filename FROM project_sources s
        JOIN projects p ON p.owner_id=s.owner_id AND p.id=s.project_id
        WHERE s.owner_id=? AND s.project_id=? AND p.archived_at IS NULL`).get(user.id, String(req.params.id));
      if (typeof source?.filename !== 'string' || !/^[0-9a-f-]{36}\.(?:mp4|mov)$/i.test(source.filename)) {
        throw new HttpError(404, 'NOT_FOUND', '원본 영상을 찾을 수 없습니다.');
      }
      res.sendFile(source.filename, { root: originals, cacheControl: false, acceptRanges: true }, error => {
        if (!error) return;
        const { code, status } = error as NodeJS.ErrnoException & { status?: number };
        if (code === 'ENOENT') return next(new HttpError(404, 'NOT_FOUND', '원본 영상을 찾을 수 없습니다.'));
        if (status === 416) return next(new HttpError(416, 'INVALID_RANGE', '영상의 요청 구간을 확인해 주세요.'));
        next(error);
      });
    });
  };
}

export function validatePrivateUploadDirectory(staticDirectory: string, uploadDirectory = env.uploadDir) {
  const relativePath = relative(resolve(staticDirectory), resolve(uploadDirectory));
  if (!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith('..' + sep)) {
    throw new Error('UPLOAD_DIR은 FRONTEND_DIST 밖의 비공개 경로여야 합니다.');
  }
}
