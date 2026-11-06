// Lucian UX/UI Prompt #219 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#219
import type { MouseEvent as ReactMouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { useWorkspace } from '../../store';
import './theme-toggle.css';

// The login and workspace headers share the document's reveal.
let activeReveal: ViewTransition | undefined;

export function ThemeToggle() {
  const { theme, toggleTheme } = useWorkspace();
  const dark = theme === 'dark';
  const label = dark ? '라이트 모드로 전환' : '다크 모드로 전환';

  function switchTheme(event: ReactMouseEvent<HTMLButtonElement>) {
    if (activeReveal) {
      activeReveal.skipTransition();
      toggleTheme();
      return;
    }
    if (!event.detail || !document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      toggleTheme();
      return;
    }

    const root = document.documentElement;
    const control = event.currentTarget;
    const button = control.getBoundingClientRect();
    const x = button.left + button.width / 2;
    const y = button.top + button.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    root.style.setProperty('--u219-center', `${x}px ${y}px`);
    root.style.setProperty('--u219-radius', `${Math.ceil(radius)}px`);
    root.dataset.u219Reveal = dark ? 'light' : 'dark';

    const reveal = document.startViewTransition(() => flushSync(toggleTheme));
    activeReveal = reveal;

    // A page snapshot routes pointer clicks to the root while it is visible.
    function clickDuringReveal(click: MouseEvent) {
      if (click.target !== root || !click.detail || !control.isConnected) return;
      const { clientX, clientY } = click;
      if (clientX < button.left || clientX > button.right || clientY < button.top || clientY > button.bottom) return;
      reveal.skipTransition();
      toggleTheme();
    }
    root.addEventListener('click', clickDuringReveal);

    function finish() {
      activeReveal = undefined;
      root.removeEventListener('click', clickDuringReveal);
      delete root.dataset.u219Reveal;
      root.style.removeProperty('--u219-center');
      root.style.removeProperty('--u219-radius');
    }
    void reveal.ready.catch(() => {});
    void reveal.finished.then(finish, finish);
  }

  return <button className="u219-tg" type="button" aria-label={label} aria-pressed={dark} title={label} onClick={switchTheme}>
    <svg viewBox="0 0 16 16" aria-hidden="true">
      {dark ? <path d="M13.5 9.8A5.6 5.6 0 0 1 6.2 2.5a5.6 5.6 0 1 0 7.3 7.3z" fill="currentColor" /> : <>
        <circle cx="8" cy="8" r="3" fill="currentColor" />
        <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
        </g>
      </>}
    </svg>
  </button>;
}
