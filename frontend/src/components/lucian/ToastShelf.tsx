// Lucian UX/UI Prompt #070 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#070
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Check, Info, TriangleAlert, X } from 'lucide-react';
import { useWorkspace } from '../../store';
import type { ToastMessage } from '../../types';
function Toast({ message, index, open, dismiss }: { message: ToastMessage; index: number; open: boolean; dismiss: () => void }) {
  const [dx, setDx] = useState(0); const [leaving, setLeaving] = useState(false); const [entering, setEntering] = useState(true); const [swiped, setSwiped] = useState(0);
  const started = useRef(0); const left = useRef(4500); const down = useRef<number | null>(null); const dismissRef = useRef(dismiss); dismissRef.current = dismiss;
  useEffect(() => { const frames: number[] = []; frames.push(requestAnimationFrame(() => frames.push(requestAnimationFrame(() => setEntering(false))))); return () => frames.forEach(cancelAnimationFrame); }, []);
  useEffect(() => { if (open || index > 0 || leaving) return; started.current = Date.now(); const timer = window.setTimeout(() => setLeaving(true), left.current); return () => { window.clearTimeout(timer); left.current = Math.max(0, left.current - (Date.now() - started.current)); }; }, [open, index, leaving]);
  useEffect(() => { if (!leaving) return; const t = window.setTimeout(() => dismissRef.current(), 160); return () => window.clearTimeout(t); }, [leaving]);
  const color = message.kind === 'error' ? 'var(--ux-danger)' : message.kind === 'info' ? 'var(--ux-accent)' : 'var(--ux-mint)';
  return <div className={`u070-t ${entering ? 'enter' : ''} ${!open && index > 0 ? 'back' : ''} ${leaving ? 'leave' : ''} ${swiped ? 'side' : ''}`} role={message.kind === 'error' ? 'alert' : 'status'} inert={!open && index > 0} style={{ '--c': color, '--y': `${-index * (open ? 80 : 14)}px`, '--s': open ? 1 : 1 - index * .06, '--o': leaving ? 0 : index > 2 && !open ? 0 : 1, '--dx': `${dx}px`, '--dir': swiped, zIndex: 50 - index } as CSSProperties} onPointerDown={e => { if ((e.target as HTMLElement).closest('button')) return; down.current = e.clientX; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { if (down.current !== null) setDx(e.clientX - down.current); }} onPointerUp={() => { if (Math.abs(dx) > 90) { setSwiped(Math.sign(dx)); setLeaving(true); } else setDx(0); down.current = null; }} onPointerCancel={() => { setDx(0); down.current = null; }}>
    <span className="u070-ic" aria-hidden="true">{message.kind === 'error' ? <TriangleAlert /> : message.kind === 'info' ? <Info /> : <Check />}</span><span className="u070-tx"><b title={message.title}>{message.title}</b><small title={message.description}>{message.description}</small></span><button className="u070-x" onClick={() => setLeaving(true)} aria-label="알림 닫기"><X /></button><span className="u070-bar" aria-hidden="true" />
  </div>;
}
export function ToastShelf() {
  const { toasts, dismissToast } = useWorkspace(); const [open, setOpen] = useState(false);
  return <div className="ux u070 app-toasts"><div className="u070-zone" role="region" aria-label="알림" onPointerEnter={() => setOpen(true)} onPointerLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>{toasts.slice(0, 1).map((t, i) => <Toast key={t.id} message={t} index={i} open={open} dismiss={() => dismissToast(t.id)} />)}</div></div>;
}
