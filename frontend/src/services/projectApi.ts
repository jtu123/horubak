
import type { Genre, Project } from '../types';

const API_URL = 'http://localhost:8080/api/projects';

// Spring Boot에서 반환하는 프로젝트 형식
interface ProjectResponse {
  id: string;
  title: string;
  genre: string;
  source: string;
  sourceName: string | null;
  sourceUrl: string | null;
  duration: number | null;
  status: string;
  createdAt: string;
}

// Spring Boot 응답을 React 프로젝트 형식으로 변환
function toProject(data: ProjectResponse): Project {
  return {
    id: data.id,
    title: data.title,
    genre: (
      ['lecture', 'speech', 'podcast', 'general'].includes(data.genre)
        ? data.genre
        : 'general'
    ) as Genre,
    status: data.status === 'CREATED' ? 'ready' : 'processing',
    duration: data.duration ?? 0,
    createdAt: data.createdAt,
    updatedAt: data.createdAt,
    favorite: false,
    source: data.source === 'file' || data.source === 'url'
      ? data.source
      : 'sample',
    sourceName: data.sourceName ?? '',
    sourceUrl: data.sourceUrl ?? undefined,
    progress: 0,
  };
}

// 전체 프로젝트 조회
export async function fetchProjects(): Promise<Project[]> {
  const response = await fetch(API_URL);

  if (!response.ok) {
    throw new Error('프로젝트 목록을 불러오지 못했습니다.');
  }

  const data: ProjectResponse[] = await response.json();

  return data.map(toProject);
}


export async function createProject(input: {
  title: string;
  genre: Genre;
  sourceUrl: string;
}): Promise<Project> {

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: input.title,
      genre: input.genre,
      source: 'url',
      sourceName: input.sourceUrl,
      sourceUrl: input.sourceUrl,
      duration: 0,
    }),
  });

  if (!response.ok) {
    throw new Error('프로젝트 생성에 실패했습니다.');
  }

  const data: ProjectResponse = await response.json();

  return toProject(data);
}
