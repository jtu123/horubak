// Lucian UX/UI Prompt #308 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#308
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

type ProjectLayout = 'grid' | 'list';
type CoverPosition = { cover: HTMLElement; rect: DOMRect };
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

export function useProjectView() {
  const [layout, setLayout] = useState<ProjectLayout>('grid');
  const gridRef = useRef<HTMLDivElement>(null);
  const before = useRef<CoverPosition[]>([]);
  const active = useRef<{ grid: HTMLDivElement; animations: Animation[] } | null>(null);

  const stop = useCallback(() => {
    const current = active.current;
    active.current = null;
    if (!current) return;
    current.animations.forEach(animation => animation.cancel());
    current.grid.classList.remove('u308-shifting');
  }, []);

  function changeLayout(next: ProjectLayout) {
    if (next === layout) return;
    const grid = gridRef.current;
    if (grid && typeof grid.animate === 'function' && !window.matchMedia(REDUCED_MOTION).matches) {
      before.current = [...grid.querySelectorAll<HTMLElement>('.project-cover')]
        .map(cover => ({ cover, rect: cover.getBoundingClientRect() }));
    }
    stop();
    setLayout(next);
  }

  useLayoutEffect(() => {
    const grid = gridRef.current;
    const previous = before.current;
    before.current = [];
    if (!grid || !previous.length || window.matchMedia(REDUCED_MOTION).matches) return;

    const inView = (rect: DOMRect) => rect.bottom > 0 && rect.top < window.innerHeight;
    const moves = previous.flatMap(({ cover, rect }) => {
      if (!grid.contains(cover)) return [];
      const next = cover.getBoundingClientRect();
      if (!rect.width || !rect.height || !next.width || !next.height || (!inView(rect) && !inView(next))) return [];
      return [{ cover, rect, next }];
    });
    if (!moves.length) return;

    grid.classList.add('u308-shifting');
    const animations: Animation[] = [];
    moves.forEach(({ cover, rect, next }, index) => {
      // FLIP keeps the thumbnail's visible position even when a switch interrupts its motion.
      const translate = `translate(${rect.left - next.left}px, ${rect.top - next.top}px)`;
      const scale = `scale(${rect.width / next.width}, ${rect.height / next.height})`;
      animations.push(cover.animate([{ transform: translate + ' ' + scale }, { transform: 'none' }], {
        duration: 560, delay: index * 25, easing: 'cubic-bezier(.3,1.15,.4,1)', fill: 'backwards',
      }));
      if (layout === 'list') {
        const details = cover.parentElement?.querySelector('.project-card-body');
        if (details) animations.push(details.animate(
          [{ opacity: 0, transform: 'translateX(-10px)' }, { opacity: 1, transform: 'none' }],
          { duration: 320, delay: 300 + index * 30, fill: 'backwards' },
        ));
      }
    });
    const run = { grid, animations };
    active.current = run;
    void Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
      if (active.current !== run) return;
      active.current = null;
      grid.classList.remove('u308-shifting');
    });
  }, [layout]);

  useEffect(() => {
    const preference = window.matchMedia(REDUCED_MOTION);
    const onChange = () => { if (preference.matches) stop(); };
    preference.addEventListener('change', onChange);
    return () => {
      preference.removeEventListener('change', onChange);
      stop();
    };
  }, [stop]);

  return { layout, changeLayout, gridRef };
}
