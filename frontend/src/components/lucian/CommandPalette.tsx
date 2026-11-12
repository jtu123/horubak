// Adapted from Lucian #046 · MIT (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#046
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Clapperboard, FileVideo, FolderOpen, Library, ListVideo, Moon, Plus, Search, Settings2, ShieldCheck, Star, Sun } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '../../store';
import { searchText } from '../../project-search';
import './interface-046.css';
const OPEN_EVENT = 'horubak:commands';
export const openCommandPalette = () => window.dispatchEvent(new Event(OPEN_EVENT));
export function CommandPalette() {
  const { projects, theme, toggleTheme, user, serverAuth } = useWorkspace(); const navigate = useNavigate();
  const uid = useId(); const dialog = useRef<HTMLDialogElement>(null); const input = useRef<HTMLInputElement>(null);
  const selectedRow = useRef<HTMLLIElement>(null); const previous = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false); const [query, setQuery] = useState(''); const [active, setActive] = useState(0);
  const finish = (action?: () => void) => { dialog.current?.close(); setOpen(false); if (previous.current?.isConnected) previous.current.focus(); action?.(); };
  const show = () => { previous.current = document.activeElement as HTMLElement; setQuery(''); setActive(0); setOpen(true); };
  useEffect(() => {
    const onOpen = () => show();
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'k' && !event.isComposing) {
        event.preventDefault(); if (open) finish(); else show();
      }
    };
    window.addEventListener(OPEN_EVENT, onOpen); window.addEventListener('keydown', key);
    return () => { window.removeEventListener(OPEN_EVENT, onOpen); window.removeEventListener('keydown', key); };
  }, [open]);
  useLayoutEffect(() => { if (open) { dialog.current?.showModal(); input.current?.focus(); } }, [open]);
  const commands = [
    ...[...projects].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(project => ({ id: 'project-' + project.id, group: '프로젝트', name: project.title, Icon: FileVideo, action: () => navigate('/projects/' + project.id + (['processing','failed','cancelled'].includes(project.status) ? '/processing' : '')) })),
    { id: 'new', group: '빠른 실행', name: '새 영상 등록', Icon: Plus, action: () => navigate('/projects/new') },
    { id: 'all', group: '빠른 실행', name: '내 프로젝트', Icon: FolderOpen, action: () => navigate('/projects') },
    { id: 'favorites', group: '빠른 실행', name: '즐겨찾기', Icon: Star, action: () => navigate('/projects?view=favorites') },
    { id: 'exports', group: '빠른 실행', name: '편집 결과', Icon: Clapperboard, action: () => navigate('/projects?view=exports') },
    { id: 'library', group: '작업공간', name: '라이브러리', Icon: Library, action: () => navigate('/library') },
    { id: 'jobs', group: '작업공간', name: '작업센터', Icon: ListVideo, action: () => navigate('/jobs') },
    { id: 'settings', group: '작업공간', name: '설정', Icon: Settings2, action: () => navigate('/settings') },
    ...(serverAuth && !user?.guest && user?.role === 'admin' ? [{ id: 'admin', group: '운영', name: '관리자', Icon: ShieldCheck, action: () => navigate('/admin') }] : []),
    { id: 'theme', group: '빠른 실행', name: (theme === 'light' ? '다크' : '라이트') + ' 모드로 전환', Icon: theme === 'light' ? Moon : Sun, action: toggleTheme },
  ];
  const results = commands.filter(command => searchText(command.name).includes(searchText(query)));
  const selected = Math.min(active, Math.max(0, results.length - 1)); const selectedId = results[selected]?.id;
  useLayoutEffect(() => { if (open) selectedRow.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' }); }, [open, selectedId]);
  const run = (index: number) => { const command = results[index]; if (command) finish(command.action); };
  return <dialog ref={dialog} className="ux command-dialog" aria-label="호루박 빠른 실행" onCancel={event => { event.preventDefault(); finish(); }} onClick={event => { if (event.target === event.currentTarget) finish(); }}>
    <label className="command-field"><Search size={18} /><input ref={input} type="text" role="combobox" aria-label="명령과 프로젝트 검색" aria-controls={uid + '-list'} aria-expanded={open} aria-autocomplete="list" aria-activedescendant={selectedId ? uid + '-' + selectedId : undefined} autoComplete="off" spellCheck={false} placeholder="프로젝트 또는 명령 검색" value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (results.length) setActive((selected + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length); }
      if (event.key === 'Enter') { event.preventDefault(); run(selected); }
    }} /><kbd>esc</kbd></label>
    <ul className="command-list" id={uid + '-list'} role="listbox" aria-label="프로젝트 및 명령">
      {results.map((command,index) => <li key={command.id} ref={index === selected ? selectedRow : undefined} role="option" id={uid + '-' + command.id} aria-selected={index === selected} onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => run(index)}><command.Icon size={18} /><span>{command.name}</span><small>{command.group}</small></li>)}
      {!results.length && <li className="command-empty" role="presentation">검색 결과가 없어요</li>}
    </ul>
    <div className="command-footer"><span>↑↓ 이동</span><span>Enter 실행</span><span>Esc 닫기</span></div>
  </dialog>;
}
