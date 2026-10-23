// Lucian UX/UI Prompt #038 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#038
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowUpRight, ChevronRight, Clapperboard, FolderOpen, MoreHorizontal, Pencil, Star, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Project } from '../../types';
import './interface-038.css';

interface Props { project: Project; index: number; onOpen: () => void; onRename: () => void; onFavorite: () => void; onDelete: () => void; children: (trigger: ReactNode) => ReactNode }
export function ProjectMenu({ project, index, onOpen, onRename, onFavorite, onDelete, children }: Props) {
  const uid = useId();
  const navigate = useNavigate();
  const card = useRef<HTMLElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLUListElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  const hold = useRef<number | undefined>(undefined);
  const held = useRef(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, origin: 'top left' });
  const [sub, setSub] = useState(false);
  const [height, setHeight] = useState(213);
  const close = (refocus = true) => { setAnchor(null); setSub(false); if (refocus) restore.current?.isConnected && restore.current.focus(); };
  const openAt = (x: number, y: number, element: HTMLElement) => { restore.current = element; setSub(false); setAnchor({ x,y }); };
  useLayoutEffect(() => {
    if (!anchor || !panel.current) return;
    const measured = panel.current.offsetHeight + 12;
    setHeight(measured);
    const left = Math.max(8, Math.min(innerWidth - 208, anchor.x + 200 > innerWidth - 8 ? anchor.x - 200 : anchor.x));
    const top = Math.max(8, Math.min(innerHeight - measured - 8, anchor.y + measured > innerHeight - 8 ? anchor.y - measured : anchor.y));
    setPosition({ left, top, origin: `${left < anchor.x ? 'right' : 'left'} ${top < anchor.y ? 'bottom' : 'top'}` });
    panel.current.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [anchor, sub]);
  useEffect(() => {
    if (!anchor) return;
    const pointer = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(false); };
    const moved = (event: Event) => { if (!menu.current?.contains(event.target as Node)) close(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    document.addEventListener('pointerdown',pointer); document.addEventListener('keydown',key); window.addEventListener('resize',moved); window.addEventListener('scroll',moved,true);
    return () => { document.removeEventListener('pointerdown',pointer); document.removeEventListener('keydown',key); window.removeEventListener('resize',moved); window.removeEventListener('scroll',moved,true); };
  }, [anchor]);
  useEffect(() => () => window.clearTimeout(hold.current), []);
  const actions = sub ? [
    { name: '뒤로', Icon: ArrowLeft, action: () => setSub(false) },
    { name: '내 프로젝트', Icon: FolderOpen, action: () => { close(); navigate('/projects'); } },
    { name: '즐겨찾기', Icon: Star, action: () => { close(); navigate('/projects?view=favorites'); } },
    { name: '결과 보관함', Icon: Clapperboard, action: () => { close(); navigate('/projects?view=exports'); } },
  ] : [
    { name: '열기', Icon: ArrowUpRight, action: () => { close(); onOpen(); } },
    { name: '이름 바꾸기', Icon: Pencil, action: () => { close(); onRename(); } },
    { name: project.favorite ? '즐겨찾기 해제' : '즐겨찾기 추가', Icon: Star, action: () => { close(); onFavorite(); } },
    { name: '바로 이동', Icon: FolderOpen, action: () => setSub(true) },
    { name: '삭제', Icon: Trash2, action: () => { close(); onDelete(); } },
  ];
  const menuItems = <ul ref={panel} className="u038-p" role="none" onKeyDown={event => {
    if (event.key === 'Tab') { close(false); return; }
    if (event.key === 'ArrowLeft' && sub) { event.preventDefault(); setSub(false); return; }
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
    if (event.key === 'ArrowRight' && !sub && current === 3) { event.preventDefault(); setSub(true); }
  }}>{actions.map((action, i) => <li key={action.name} role="none">{!sub && i === 4 && <div className="u038-sep" role="separator" />}<button type="button" className={`u038-mi ${!sub && i === 4 ? 'danger' : ''}`} role="menuitem" aria-haspopup={!sub && i === 3 ? 'menu' : undefined} aria-expanded={!sub && i === 3 ? false : undefined} onClick={action.action}><action.Icon />{action.name}{!sub && i === 3 && <ChevronRight className="u038-ar" />}</button></li>)}</ul>;
  return <>
    <article ref={card} className={`project-card u038-card ${anchor ? 'is-ctx' : ''}`} tabIndex={0} aria-label={project.title} aria-haspopup="menu" style={{ animationDelay: `${index * 45}ms` }} onContextMenu={event => { event.preventDefault(); openAt(event.clientX,event.clientY,trigger.current!); }} onKeyDown={event => {
      if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu' || (event.target === event.currentTarget && event.key === 'Enter')) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); openAt(rect.left+40,rect.top+60,trigger.current!); }
    }} onPointerDown={event => {
      if (event.pointerType !== 'touch' || (event.target as HTMLElement).closest('.card-actions')) return;
      held.current = false;
      const { clientX,clientY } = event;
      hold.current = window.setTimeout(() => { held.current = true; openAt(clientX,clientY,trigger.current!); },480);
    }} onPointerMove={() => window.clearTimeout(hold.current)} onPointerUp={() => window.clearTimeout(hold.current)} onPointerCancel={() => window.clearTimeout(hold.current)} onClickCapture={event => { if (held.current) { event.preventDefault(); event.stopPropagation(); held.current = false; } }}>
      {children(<button ref={trigger} className="project-more-trigger icon-button" type="button" aria-label={`${project.title} 더 보기`} aria-haspopup="menu" aria-expanded={!!anchor} aria-controls={anchor ? uid : undefined} onClick={event => { if (anchor) close(); else { const rect = event.currentTarget.getBoundingClientRect(); openAt(rect.right,rect.bottom,event.currentTarget); } }}><MoreHorizontal size={18} /></button>)}
    </article>
    {typeof document !== 'undefined' && createPortal(<div className="ux u038 context-host"><div ref={menu} id={uid} className={`u038-menu ${anchor ? 'is-open' : ''}`} role="menu" aria-label={`${project.title} 메뉴`} aria-hidden={!anchor} inert={!anchor} style={{ left: position.left, top: position.top, transformOrigin: position.origin, '--mh': `${height}px` } as CSSProperties}>
      <div className="u038-track" key={sub ? 'sub' : 'main'}>{menuItems}</div>
    </div></div>, document.body)}
  </>;
}
