// Adapted from Lucian #092 · MIT (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#092
import { ArrowRight, Search, X } from 'lucide-react';
import { activeProjectFilters, recoverySuggestions } from '../../project-search';
import type { FilterKey, ProjectFilter } from '../../project-search';
import type { Project } from '../../types';
import './interface-092.css';
interface Props { projects: Project[]; filter: ProjectFilter; onRemove: (key: FilterKey) => void; onReset: () => void; onNew: () => void }
export function SearchRecovery({ projects, filter, onRemove, onReset, onNew }: Props) {
  const filters = activeProjectFilters(filter); const suggestions = recoverySuggestions(projects, filter).slice(0,2);
  return <section className="search-recovery" aria-label="검색 결과 복구 안내">
    <Search size={28} aria-hidden="true" />
    <h2>{projects.length ? '검색 결과가 없어요' : '등록한 프로젝트가 없어요'}</h2>
    <p>{projects.length ? '검색어나 필터를 바꿔 보세요.' : '새 영상을 등록해 시작하세요.'}</p>
    {filters.length > 0 && <div className="recovery-filters" role="group" aria-label="적용된 필터">{filters.map(item => <button className="filter-chip" key={item.key} onClick={() => onRemove(item.key)} aria-label={item.label + ' 필터 빼기'}>{item.label}<X size={13} /></button>)}</div>}
    <div className="recovery-actions">{suggestions.map(suggestion => <button className="btn secondary" key={suggestion.key} aria-label={suggestion.label + ' 필터를 빼면 ' + suggestion.count + '개'} onClick={() => onRemove(suggestion.key)}>{suggestion.label} 빼면 {suggestion.count}개<ArrowRight size={14} /></button>)}
      <button className={projects.length ? 'text-link' : 'btn primary'} onClick={projects.length ? onReset : onNew}>{projects.length ? '필터 초기화' : '새 영상 등록'}{!projects.length && <ArrowRight size={14} />}</button>
    </div>
  </section>;
}
