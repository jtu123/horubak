import { describe, expect, it } from 'vitest';
import { createVisualSample, seedProjects } from './data';
import { recoverySuggestions, searchProjects } from './project-search';

describe('project search and recovery', () => {
  it('finds Korean titles with or without spacing', () => {
    expect(searchProjects(seedProjects(), { query: '좋은질문', genre: 'all', view: 'all' })).toHaveLength(1);
  });
  it('previews independent filter removals accurately', () => {
    const filter = { query: '창작', genre: 'lecture' as const, view: 'all' };
    expect(searchProjects(seedProjects(), filter)).toHaveLength(0);
    expect(recoverySuggestions(seedProjects(), filter)).toEqual([
      { key: 'query', label: '검색어', count: 1 }, { key: 'genre', label: '강의', count: 1 },
    ]);
  });
  it('preserves the favorites view when removing a genre', () => {
    const filter = { query: '', genre: 'podcast' as const, view: 'favorites' };
    expect(recoverySuggestions(seedProjects(), filter).find(item => item.key === 'genre')?.count).toBe(1);
  });
  it('never suggests a filter removal that still has no results', () => {
    expect(recoverySuggestions([], { query: 'test', genre: 'lecture', view: 'exports' })).toEqual([]);
  });

  it('finds all-video projects by their manually selected purpose and focus', () => {
    const sample = createVisualSample();
    expect(searchProjects([sample], { query: '풍경과움직임', genre: 'general', view: 'all' })).toEqual([sample]);
    expect(searchProjects([sample], { query: '하이라이트', genre: 'all', view: 'all' })).toEqual([sample]);
  });
});
