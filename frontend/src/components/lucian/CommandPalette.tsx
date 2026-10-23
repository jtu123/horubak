// Lucian UX/UI Prompt #046 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#046
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Clapperboard, FileVideo, FolderOpen, Moon, Plus, Search, Star, Sun } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '../../store';
import { searchText } from '../../project-search';
import './interface-046.css';

const OPEN_EVENT = 'horubak:commands';
export const openCommandPalette = () => window.dispatchEvent(new Event(OPEN_EVENT));

export function CommandPalette() {
  const { projects, theme, toggleTheme } = useWorkspace();
  const navigate = useNavigate();
  const uid = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const previous = useRef<HTMLElement | null>(null);
  const timers = useRef(new Set<number>());
  const [open, setOpen] = useState(false);
  const [closed, setClosed] = useState(true);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [y, setY] = useState(0);
  const [done, setDone] = useState('');
  const clearTimers = () => { timers.current.forEach(window.clearTimeout); timers.current.clear(); };
  const later = (fn: () => void, delay: number) => { const timer = window.setTimeout(() => { timers.current.delete(timer); fn(); }, delay); timers.current.add(timer); };
  const finish = (action?: () => void) => {
    clearTimers(); setClosed(true);
    later(() => { dialog.current?.close(); setOpen(false); setDone(''); setQuery(''); previous.current?.isConnected && previous.current.focus(); action?.(); }, 500);
  };
  const show = () => { clearTimers(); previous.current = document.activeElement as HTMLElement; setQuery(''); setDone(''); setActive(0); setClosed(true); setOpen(true); };
  useEffect(() => {
    const onOpen = () => show();
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'k' && !event.isComposing) {
        event.preventDefault(); if (open) finish(); else show();
      }
    };
    window.addEventListener(OPEN_EVENT, onOpen); window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener(OPEN_EVENT, onOpen); window.removeEventListener('keydown', onKey); clearTimers(); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    input.current?.focus();
    dialog.current?.getBoundingClientRect();
    const frame = requestAnimationFrame(() => setClosed(false));
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const commands = [
    ...[...projects].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(project => ({ id: project.id, group: '프로젝트', name: project.title, Icon: FileVideo, action: () => navigate(`/projects/${project.id}/${['processing','failed','cancelled'].includes(project.status) ? 'processing' : 'editor'}`) })),
    { id: 'new', group: '빠른 실행', name: '새 영상 등록', Icon: Plus, action: () => navigate('/projects/new') },
    { id: 'all', group: '빠른 실행', name: '내 프로젝트', Icon: FolderOpen, action: () => navigate('/projects') },
    { id: 'favorites', group: '빠른 실행', name: '즐겨찾기', Icon: Star, action: () => navigate('/projects?view=favorites') },
    { id: 'exports', group: '빠른 실행', name: '결과 보관함', Icon: Clapperboard, action: () => navigate('/projects?view=exports') },
    { id: 'theme', group: '빠른 실행', name: `${theme === 'light' ? '다크' : '라이트'} 모드로 전환`, Icon: theme === 'light' ? Moon : Sun, action: toggleTheme },
  ];
  const results = commands.filter(command => searchText(command.name).includes(searchText(query)));
  const selected = Math.min(active, Math.max(0, results.length - 1));
  const selectedId = results[selected]?.id;
  useLayoutEffect(() => {
    if (!open || !selectedId || !body.current) return;
    const row = rows.current.get(selectedId); if (!row) return;
    setY(row.offsetTop + 6);
    if (row.offsetTop < body.current.scrollTop) body.current.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > body.current.scrollTop + body.current.clientHeight - 6) body.current.scrollTop = row.offsetTop + row.offsetHeight - body.current.clientHeight + 6;
  }, [open, selectedId, query]);
  const run = (index: number) => {
    if (done || !results[index]) return;
    const command = results[index]; setActive(index); setDone(`${command.name} 실행`);
    later(() => finish(command.action), 650);
  };
  const hit = (name: string) => {
    const index = name.toLowerCase().indexOf(query.trim().toLowerCase());
    return index < 0 || !query.trim() ? name : <>{name.slice(0,index)}<mark>{name.slice(index,index+query.trim().length)}</mark>{name.slice(index+query.trim().length)}</>;
  };
  return <dialog ref={dialog} className="ux command-dialog" aria-label="호루박 빠른 실행" onCancel={event => { event.preventDefault(); finish(); }} onClick={event => { if (event.target === event.currentTarget) finish(); }}>
    <div className={`u046 ${closed ? 'is-closed' : ''}`}><div className="u046-pal">
      <label className="u046-field"><Search aria-hidden="true" /><input ref={input} className="u046-in" type="text" role="combobox" aria-label="명령과 프로젝트 검색" aria-controls={`${uid}-list`} aria-expanded={!closed} aria-autocomplete="list" aria-activedescendant={!closed && selectedId ? `${uid}-${selectedId}` : undefined} autoComplete="off" spellCheck={false} placeholder="프로젝트 또는 명령 검색" value={query} disabled={!!done} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (results.length) setActive((selected + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length); }
        if (event.key === 'Enter') { event.preventDefault(); run(selected); }
      }} /><kbd className="u046-kbd">esc</kbd></label>
      <div className="u046-body" ref={body} inert={closed}><span className="u046-hl" aria-hidden="true" style={{ '--y': `${y}px`, opacity: results.length ? 1 : 0 } as CSSProperties} /><ul className="u046-list" id={`${uid}-list`} role="listbox" aria-label="프로젝트 및 명령">
        {results.map((command,index) => <li key={command.id} role="none">{(index === 0 || results[index-1].group !== command.group) && <div className="u046-g" role="presentation">{command.group}</div>}<ul role="none" className="command-group"><li ref={element => { if (element) rows.current.set(command.id,element); else rows.current.delete(command.id); }} className="u046-op" role="option" id={`${uid}-${command.id}`} aria-selected={index === selected} style={{ '--i': index } as CSSProperties} onPointerMove={() => { if (!done) setActive(index); }} onMouseDown={event => event.preventDefault()} onClick={() => run(index)}><span className="u046-ic" aria-hidden="true" style={{ '--c': 'var(--accent)' } as CSSProperties}><command.Icon /></span><span className="command-name">{hit(command.name)}</span></li></ul></li>)}
        {!results.length && <li className="u046-empty" role="presentation"><b>검색 결과가 없어요</b>프로젝트 이름이나 다른 명령을 입력해 주세요.</li>}
      </ul></div>
      <div className="u046-foot"><span aria-hidden="true"><kbd className="u046-kbd">↑↓</kbd>이동</span><span aria-hidden="true"><kbd className="u046-kbd">↵</kbd>실행</span><span className={`u046-done ${done ? 'show' : ''}`} role="status">{done}</span></div>
    </div></div>
  </dialog>;
}
