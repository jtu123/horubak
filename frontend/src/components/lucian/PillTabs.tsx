// Lucian UX/UI Prompt #039 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#039
import { useId, useLayoutEffect, useRef } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
export function PillTabs<T extends string>({ options, value, onChange, label, panelId }: { options: Array<{ value: T; label: string }>; value: T; onChange: (value: T) => void; label: string; panelId?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const el = root.current!; const pill = el.querySelector<HTMLElement>('.u039-pill')!;
    const measure = () => { const tab = el.querySelector<HTMLElement>('[aria-selected="true"]'); if (tab) { pill.style.setProperty('--x', `${tab.offsetLeft}px`); pill.style.setProperty('--w', `${tab.offsetWidth}px`); } };
    measure(); const observer = new ResizeObserver(measure); observer.observe(el); return () => observer.disconnect();
  }, [value]);
  function key(e: KeyboardEvent, i: number) {
    let next = i;
    if (e.key === 'ArrowRight') next = (i + 1) % options.length;
    else if (e.key === 'ArrowLeft') next = (i + options.length - 1) % options.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = options.length - 1;
    else return;
    e.preventDefault(); onChange(options[next].value); root.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next].focus();
  }
  return <div className="ux u039 app-tabs" ref={root}><div className="u039-tabs" role="tablist" aria-label={label}><span className="u039-pill" aria-hidden="true" style={{ '--x': '5px' } as CSSProperties} />{options.map((o, i) => <button key={o.value} id={`${id}-${i}`} className="u039-tab" type="button" role="tab" aria-selected={value === o.value} aria-controls={panelId} tabIndex={value === o.value ? 0 : -1} onClick={() => onChange(o.value)} onKeyDown={e => key(e, i)}>{o.label}</button>)}</div></div>;
}
