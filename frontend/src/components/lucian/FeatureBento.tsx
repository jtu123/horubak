// Lucian UX/UI Prompt #214 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#214
import { useEffect, useState } from 'react';
import type { FocusEvent, ReactNode } from 'react';
import './feature-bento.css';

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}

export function useTyping(initial: string, message: string, active: boolean, reduced: boolean) {
  const [text, setText] = useState(initial);
  useEffect(() => {
    if (!active) return;
    if (reduced) { setText(message); return; }
    const letters = Array.from(message);
    let length = 0;
    let timer: number | undefined;
    const tick = () => {
      setText(letters.slice(0, ++length).join(''));
      if (length < letters.length) timer = window.setTimeout(tick, 45);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [active, message, reduced]);
  return text;
}

/** Hover and focus-within activate the original five tile scenes. */
export function useBentoInteraction() {
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const reduced = useReducedMotion();
  const isOn = (index: number) => hovered === index || focused === index;
  const tileProps = (index: number, area: 'a' | 'b' | 'c' | 'd' | 'e') => ({
    className: `u214-t u214-${area} ${isOn(index) ? 'is-on' : ''}`,
    onPointerEnter: () => setHovered(index),
    onPointerLeave: () => setHovered(current => current === index ? null : current),
    onFocus: () => setFocused(index),
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(current => current === index ? null : current);
    },
  });
  return { isOn, tileProps, reduced };
}

/** Full-page five-tile composition with concise project content. */
export function FeatureBento({ heading, children }: { heading: ReactNode; children: ReactNode }) {
  return <div className="ux u214 workspace-bento page-enter">
    <header className="u214-hd bento-page-heading">{heading}</header>
    <div className="u214-gd">{children}</div>
  </div>;
}
