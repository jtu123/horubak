import type { Genre, Project } from './types';
import { GENRES } from './types';

export interface ProjectFilter { query: string; genre: Genre | 'all'; view: string }
export type FilterKey = 'query' | 'genre' | 'view';
export const searchText = (value: string) => value.replace(/\s+/g, '').toLocaleLowerCase('ko');
export function searchProjects(projects: Project[], filter: ProjectFilter) {
  const query = searchText(filter.query);
  return projects.filter(project =>
    (filter.view !== 'favorites' || project.favorite) &&
    (filter.view !== 'exports' || project.status === 'completed') &&
    (filter.genre === 'all' || project.genre === filter.genre) &&
    searchText(project.title).includes(query));
}
export function activeProjectFilters(filter: ProjectFilter): Array<{ key: FilterKey; label: string }> {
  return [
    ...(filter.query.trim() ? [{ key: 'query' as const, label: '검색어' }] : []),
    ...(filter.genre !== 'all' ? [{ key: 'genre' as const, label: GENRES[filter.genre] }] : []),
    ...(['favorites','exports'].includes(filter.view) ? [{ key: 'view' as const, label: filter.view === 'favorites' ? '즐겨찾기' : '결과 보관함' }] : []),
  ];
}
export function withoutProjectFilter(filter: ProjectFilter, key: FilterKey): ProjectFilter {
  return { ...filter, ...(key === 'query' ? { query: '' } : key === 'genre' ? { genre: 'all' as const } : { view: 'all' }) };
}
export function recoverySuggestions(projects: Project[], filter: ProjectFilter) {
  return activeProjectFilters(filter).map(item => ({ ...item, count: searchProjects(projects, withoutProjectFilter(filter, item.key)).length }))
    .filter(item => item.count > 0).sort((a, b) => b.count - a.count);
}
