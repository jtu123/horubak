// Lucian UX/UI Prompt #092 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#092
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import { activeProjectFilters, recoverySuggestions } from '../../project-search';
import type { FilterKey, ProjectFilter } from '../../project-search';
import type { Project } from '../../types';
import { useReducedMotion } from './FeatureBento';
import './interface-092.css';

interface Props { projects: Project[]; filter: ProjectFilter; onRemove: (key: FilterKey) => void; onReset: () => void; onNew: () => void }
export function SearchRecovery({ projects, filter, onRemove, onReset, onNew }: Props) {
  const reduced = useReducedMotion();
  const [leaving, setLeaving] = useState<FilterKey | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const filters = activeProjectFilters(filter);
  const suggestions = recoverySuggestions(projects, filter).slice(0,2);
  const drop = (key: FilterKey) => { setLeaving(key); timer.current = window.setTimeout(() => { setLeaving(null); onRemove(key); }, reduced ? 0 : 330); };
  return <section className="ux u092 empty search-recovery" aria-label="검색 결과 복구 안내">
    <div className="u092-q"><Search aria-hidden="true" /><span className="u092-in">{filter.query || '적용한 검색 조건'}</span>{filter.query && <button className="u092-x" type="button" aria-label="검색어 필터 빼기" disabled={!!leaving} onClick={() => drop('query')}><X /></button>}</div>
    <div className="u092-fs" role="group" aria-label="적용된 필터">{filters.filter(item => item.key !== 'query').map(item => <button className={`u092-ch ${leaving === item.key ? 'out' : ''}`} key={item.key} disabled={!!leaving} onClick={() => drop(item.key)} aria-label={`${item.label} 필터 빼기`}>{item.label}<X /></button>)}</div>
    <div className="u092-meta"><span role="status">결과 <b>0</b>개</span>{filters.length > 0 && <button className="u092-typo" onClick={onReset}>필터 초기화</button>}</div>
    <div className="u092-area"><div className="u092-none">
      <div className="u092-art" aria-hidden="true"><svg viewBox="0 0 150 92"><path className="u092-shelf" d="M8 30h134M8 56h134M8 82h134" /><g className="u092-lens"><circle cx="34" cy="38" r="20" /><path className="gl" d="M24 30a12 12 0 0 1 8-5" /><path d="M48 52l14 14" /></g></svg></div>
      <p className="u092-nt">{!projects.length ? '등록한 프로젝트가 없어요' : '검색 결과가 없어요'}</p>
      <p className="u092-ns">{suggestions.length ? '필터를 풀어 다시 찾아보세요.' : !projects.length ? '새 영상을 등록해 주세요.' : '검색 조건을 확인해 주세요.'}</p>
      <div className="u092-sgs">{suggestions.map((suggestion,index) => <button className="u092-sg" key={suggestion.key} style={{ '--i': index } as CSSProperties} aria-label={`${suggestion.label} 필터를 빼면 ${suggestion.count}개`} disabled={!!leaving} onClick={() => drop(suggestion.key)}><s>{suggestion.label}</s><span>빼면 <b>{suggestion.count}개</b></span><ArrowRight /></button>)}
        {!suggestions.length && <button className="u092-sg" onClick={projects.length ? onReset : onNew}><span>{projects.length ? '전체 보기' : '새 영상 등록'}</span><ArrowRight /></button>}
      </div>
    </div></div>
  </section>;
}
