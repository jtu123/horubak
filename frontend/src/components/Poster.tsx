import { AudioLines, ArrowUpRight, Clapperboard } from 'lucide-react';
import type { Genre } from '../types';
export function Poster({ genre, vertical = false, mini = false }: { genre: Genre; vertical?: boolean; mini?: boolean }) {
  return <div className={`poster poster-${genre} ${vertical ? 'vertical' : ''} ${mini ? 'mini' : ''}`} aria-hidden="true">
    <div className="poster-type">{genre === 'lecture' ? <>답보다<br /><em>질문.</em></> : genre === 'speech' ? <>다음은,<br /><em>우리.</em></> : genre === 'general' ? <>장면의<br /><em>발견.</em></> : <>계속하는<br /><em>마음.</em></>}</div>
    <div className="poster-drawing">{genre === 'lecture' ? <svg viewBox="0 0 160 160"><path d="M34 129C-6 51 76 13 107 43c19 20-4 57-34 45s-13-61 19-57c48 6 55 62 23 98"/><path d="m24 111 10 18 20-7M102 116l13 13 16-12"/></svg> : genre === 'speech' ? <><i /><i /><i /><ArrowUpRight /></> : genre === 'general' ? <Clapperboard /> : <><span /><AudioLines /><span /></>}</div>
  </div>;
}
