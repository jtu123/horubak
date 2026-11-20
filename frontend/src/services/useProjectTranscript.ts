import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project, Utterance } from '../types';
import { analysisApi } from './analysis';
import { getProjectTranscript } from '../data';
import { ApiError } from './api';

export function useProjectTranscript(project: Project | undefined, enabled: boolean, ownerId?: string) {
  const [state, setState] = useState<{ key: string; items: Utterance[]; loading: boolean; analyzing: boolean; error: string }>({ key: '', items: [], loading: false, analyzing: false, error: '' });
  const key = project ? `${ownerId ?? ''}:${project.id}` : '';
  const activeKey = useRef(key); activeKey.current = key;
  const controller = useRef<AbortController | null>(null);
  const sample = project?.source === 'sample';
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); controller.current = abort;
    setState({ key, items: [], loading: enabled && !sample, analyzing: false, error: '' });
    if (project && enabled && !sample) {
      void analysisApi.transcript(project.id, project.duration, abort.signal).then(items => {
        if (!abort.signal.aborted && activeKey.current === key) setState({ key, items, loading: false, analyzing: false, error: '' });
      }).catch(error => {
        if (!abort.signal.aborted && activeKey.current === key) setState({ key, items: [], loading: false, analyzing: false, error: error instanceof ApiError && error.status === 404 ? '' : error instanceof Error ? error.message : '전사를 불러오지 못했어요.' });
      });
    }
    return () => { abort.abort(); controller.current?.abort(); };
  }, [key, enabled, sample, reload, project?.duration]);
  const analyze = useCallback(async (file: File) => {
    if (!project || !enabled || sample) return;
    if (file.name !== project.sourceName) throw new Error('등록한 원본과 같은 이름의 파일을 선택해 주세요.');
    if (file.size > 25 * 1024 * 1024) throw new Error('데모 전사는 25MiB 이하의 원본을 지원해요.');
    if (project.fileSize && project.fileSize !== file.size) throw new Error('등록한 원본과 파일 크기가 달라요. 같은 파일을 선택해 주세요.');
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setState(current => ({ key, items: current.key === key ? current.items : [], loading: false, analyzing: true, error: '' }));
    try {
      const items = await analysisApi.transcribe(project.id, project.duration, file, abort.signal);
      if (!abort.signal.aborted && activeKey.current === key) setState({ key, items, loading: false, analyzing: false, error: '' });
    } catch (error) {
      if (!abort.signal.aborted && activeKey.current === key) setState(current => ({ ...current, analyzing: false, error: error instanceof Error ? error.message : '전사를 생성하지 못했어요.' }));
    }
  }, [project, enabled, sample, key]);
  return {
    items: sample && project ? getProjectTranscript(project) : state.key === key ? state.items : [],
    loading: state.key === key && state.loading,
    analyzing: state.key === key && state.analyzing,
    error: state.key === key ? state.error : '',
    analyze,
    reload: () => setReload(value => value + 1),
  };
}
