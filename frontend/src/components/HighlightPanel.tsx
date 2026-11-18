import { useEffect, useState } from 'react';
import { apiFetch } from '../api';


type Genre = 'lecture' | 'speech' | 'podcast';

type Highlight = {
  startSegmentIndex: number;
  endSegmentIndex: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  title: string;
  reason: string;
};

async function readJson<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    throw new Error('로그인 세션을 다시 확인해 주세요.');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      body?.detail || body?.message || `요청 실패 (${response.status})`,
    );
  }

  return response.json();
}

export function HighlightPanel({ projectId }: { projectId: string }) {
  const [genre, setGenre] = useState<Genre>('lecture');
  const [highlights, setHighlights] = useState<Highlight[] | null>(null);
  const [busy, setBusy] = useState<'recommend' | 'create' | null>(null);
  const [error, setError] = useState('');
  const [clipFileName, setClipFileName] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');

    useEffect(() => {
    return () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    }, [previewUrl]);

  const projectPath = encodeURIComponent(projectId);

  async function recommend() {
    setBusy('recommend');
    setError('');
    setHighlights(null);

    try {
      const response = await apiFetch(
        `/api/transcripts/projects/${projectPath}/highlights?genre=${genre}`,
        { method: 'POST' },
      );
      const result = await readJson<{ highlights: Highlight[] }>(response);
      setHighlights(result.highlights);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '추천에 실패했어요.');
    } finally {
      setBusy(null);
    }
  }

  async function createClip(highlight: Highlight) {
    setBusy('create');
    setError('');
    setClipFileName('');
    setPreviewUrl('');

    const params = new URLSearchParams({
      start: String(highlight.startSeconds),
      duration: String(highlight.durationSeconds),
    });

    try {
      const response = await apiFetch(
        `/api/videos/projects/${projectPath}/clips?${params.toString()}`,
        { method: 'POST' },
      );
      const result = await readJson<{ clipFileName: string }>(response);
      setClipFileName(result.clipFileName);
      const videoResponse = await apiFetch(
  `/api/videos/clips/${encodeURIComponent(result.clipFileName)}`,
);

if (!videoResponse.ok) {
  throw new Error(
    `MP4는 생성됐지만 재생 파일을 불러오지 못했어요 (${videoResponse.status}).`,
  );
}

setPreviewUrl(URL.createObjectURL(await videoResponse.blob()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '클립 생성에 실패했어요.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="AI 하이라이트">
      <h2>AI 하이라이트</h2>

      <label>
        장르{' '}
        <select
          value={genre}
          disabled={busy !== null}
          onChange={event => {
            setGenre(event.target.value as Genre);
            setHighlights(null);
            setError('');
          }}
        >
          <option value="lecture">강의</option>
          <option value="speech">연설</option>
          <option value="podcast">팟캐스트</option>
        </select>
      </label>

      <button type="button" disabled={busy !== null} onClick={recommend}>
        하이라이트 추천
      </button>

      {busy && (
        <p role="status">
          {busy === 'recommend' ? '추천 구간을 찾는 중…' : 'MP4를 만드는 중…'}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {highlights?.length === 0 && <p>조건을 충족하는 추천 구간이 없어요.</p>}

      {highlights && highlights.length > 0 && (
        <ul>
          {highlights.map(highlight => (
            <li key={`${highlight.startSegmentIndex}-${highlight.endSegmentIndex}`}>
              <strong>{highlight.title}</strong>
              <p>{highlight.reason}</p>
              <p>
                {highlight.startSeconds}초 ~ {highlight.endSeconds}초
                {' '}({highlight.durationSeconds}초)
              </p>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => createClip(highlight)}
              >
                이 구간으로 MP4 만들기
              </button>
            </li>
          ))}
        </ul>
      )}

      {clipFileName && <p role="status">MP4 생성 완료 · {clipFileName}</p>}
      {previewUrl && (
  <video
    controls
    src={previewUrl}
    aria-label="생성한 하이라이트 클립"
    style={{ display: 'block', width: '100%', maxWidth: 640 }}
  />
)}
    </section>
  );
}