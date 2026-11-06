import type { Genre } from '../types';
import '../styles/reference-posters.css';

/** Authored cover artwork for the labeled sample projects, not extracted video frames. */
function CoverArtwork({ genre }: { genre: Genre }) {
  if (genre === 'lecture') return <svg viewBox="0 0 280 200" fill="none">
    <rect x="95" y="19" width="118" height="153" rx="10" transform="rotate(13 95 19)" className="cover-paper-back" />
    <rect x="73" y="26" width="118" height="153" rx="10" transform="rotate(-9 73 26)" className="cover-paper" />
    <path d="m91 61 58-9m-55 27 39-6m-36 24 65-10" className="cover-rule" />
    <circle cx="157" cy="124" r="29" className="cover-medallion" />
    <path d="M147 117c0-7 19-9 20 0 1 6-9 6-9 13m0 8v1" className="cover-question" />
    <path d="m58 152 13 9 22-31" className="cover-check" />
  </svg>;
  if (genre === 'speech') return <svg viewBox="0 0 280 200" fill="none">
    <circle cx="154" cy="97" r="66" className="cover-orbit" />
    <circle cx="154" cy="97" r="48" className="cover-orbit" />
    <path d="M116 165h76l-10-63h-56z" className="cover-podium" />
    <rect x="114" y="92" width="80" height="16" rx="5" className="cover-podium-top" />
    <path d="M155 92V62m0 0 20-10m-20 10-4-7" className="cover-mic" />
    <rect x="171" y="43" width="20" height="11" rx="5.5" transform="rotate(-25 171 43)" className="cover-mic-head" />
    <circle cx="68" cy="90" r="7" className="cover-accent-dot" />
    <circle cx="229" cy="137" r="5" className="cover-accent-dot" />
  </svg>;
  if (genre === 'podcast') return <svg viewBox="0 0 280 200" fill="none">
    <rect x="65" y="44" width="172" height="114" rx="19" transform="rotate(7 65 44)" className="cover-audio-back" />
    <rect x="48" y="48" width="172" height="114" rx="19" transform="rotate(-7 48 48)" className="cover-audio" />
    {[20, 40, 64, 87, 58, 37, 22].map((height, index) => <rect key={height + ':' + index} x={76 + index * 18} y={106 - height / 2} width="8" height={height} rx="4" className="cover-wave" />)}
    <path d="M82 168h94" className="cover-audio-line" />
  </svg>;
  return <svg viewBox="0 0 280 200" fill="none">
    <rect x="91" y="28" width="139" height="109" rx="12" transform="rotate(12 91 28)" className="cover-film-back" />
    <rect x="53" y="55" width="151" height="112" rx="13" transform="rotate(-9 53 55)" className="cover-film" />
    <path d="m115 83 29 14-24 22z" className="cover-play-mark" />
    <path d="m72 70 110-17m-94 93 79-12" className="cover-film-line" />
    <circle cx="58" cy="41" r="8" className="cover-accent-dot" />
    <circle cx="231" cy="156" r="5" className="cover-accent-dot" />
  </svg>;
}

export function Poster({ genre, vertical = false, mini = false }: { genre: Genre; vertical?: boolean; mini?: boolean }) {
  return <div className={`poster reference-poster poster-${genre} ${vertical ? 'vertical' : ''} ${mini ? 'mini' : ''}`} aria-hidden="true">
    <span className="poster-edition">{genre === 'lecture' ? 'THINKING / 01' : genre === 'speech' ? 'PERSPECTIVE / 02' : genre === 'general' ? 'MOMENTS / 04' : 'CONVERSATIONS / 03'}</span>
    <div className="poster-type">{genre === 'lecture' ? <>답보다<br /><em>질문.</em></> : genre === 'speech' ? <>다음은,<br /><em>우리.</em></> : genre === 'general' ? <>장면의<br /><em>발견.</em></> : <>계속하는<br /><em>마음.</em></>}</div>
    <div className="poster-drawing"><CoverArtwork genre={genre} /></div>
    <span className="poster-footer">HORUBAK STUDIO</span>
  </div>;
}
