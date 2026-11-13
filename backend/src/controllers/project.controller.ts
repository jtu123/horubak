import type { Request } from 'express';
import { inspectStagedProject } from '../services/project.service.js';
import type { RegisteredProject, StagedProject } from '../types/project.types.js';

export async function createProject(
  req: Request,
  register: (project: StagedProject, request: Request) => RegisteredProject | Promise<RegisteredProject>,
  signal: AbortSignal,
) {
  const project = await inspectStagedProject(req.body, req.file, signal);
  signal.throwIfAborted();
  const registration = await register(project, req);
  return {
    success: true,
    data: {
      projectId: project.projectId,
      status: 'READY',
      inputType: project.inputType,
      genre: project.genre,
      metadata: project.metadata,
      ...registration,
      message: '영상이 정상적으로 등록되었습니다.',
    },
  };
}
