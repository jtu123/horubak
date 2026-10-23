import { useId } from 'react';

/** Original SVG artwork: soft, dimensional editing tools, without remote assets. */
export function HighlightSculpture() {
  const id = useId();
  const ref = (name: string) => `url(#${id}-${name})`;
  return <svg className="highlight-sculpture" viewBox="0 0 420 320" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-paper`} x1="100" y1="60" x2="280" y2="280" gradientUnits="userSpaceOnUse"><stop stopColor="white" /><stop offset="1" stopColor="#e9f1ff" /></linearGradient>
      <linearGradient id={`${id}-blue`} x1="230" y1="65" x2="342" y2="205" gradientUnits="userSpaceOnUse"><stop stopColor="#90c2ff" /><stop offset=".35" stopColor="#4593fc" /><stop offset="1" stopColor="#1b64da" /></linearGradient>
      <linearGradient id={`${id}-edge`} x1="218" y1="150" x2="337" y2="203" gradientUnits="userSpaceOnUse"><stop stopColor="#3182f6" /><stop offset="1" stopColor="#194aa6" /></linearGradient>
      <linearGradient id={`${id}-glass`} x1="51" y1="132" x2="219" y2="211" gradientUnits="userSpaceOnUse"><stop stopColor="white" /><stop offset="1" stopColor="#e8f3ff" /></linearGradient>
      <linearGradient id={`${id}-wave`} x1="72" y1="174" x2="195" y2="174" gradientUnits="userSpaceOnUse"><stop stopColor="#90c2ff" /><stop offset="1" stopColor="#3182f6" /></linearGradient>
      <radialGradient id={`${id}-orb`} cx=".3" cy=".25" r=".8"><stop stopColor="white" /><stop offset=".32" stopColor="#d8eaff" /><stop offset="1" stopColor="#90c2ff" /></radialGradient>
      <filter id={`${id}-shadow`} x="-50%" y="-40%" width="220%" height="220%"><feDropShadow dx="0" dy="20" stdDeviation="15" floodColor="#1b64da" floodOpacity=".16" /></filter>
      <filter id={`${id}-small-shadow`} x="-60%" y="-50%" width="240%" height="240%"><feDropShadow dx="0" dy="9" stdDeviation="8" floodColor="#1b64da" floodOpacity=".16" /></filter>
    </defs>
    <ellipse cx="226" cy="274" rx="123" ry="17" fill="#3182f6" opacity=".06" />
    <g className="sculpture-paper" filter={ref('shadow')} transform="rotate(10 230 165)">
      <rect x="157" y="45" width="139" height="221" rx="29" fill="#c9dcf6" />
      <rect x="152" y="39" width="139" height="221" rx="29" fill={ref('paper')} stroke="white" strokeWidth="2" />
      <rect x="169" y="58" width="105" height="119" rx="17" fill="#e1edff" />
      <circle cx="221" cy="117" r="34" fill="#c9e2ff" />
      <path d="M219 100c-13-9-28 7-18 19l13 15 27-35" stroke="white" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="171" y="194" width="81" height="7" rx="3.5" fill="#b6c9e2" />
      <rect x="171" y="210" width="103" height="6" rx="3" fill="#d1deef" />
      <rect x="171" y="225" width="58" height="6" rx="3" fill="#d1deef" />
    </g>
    <g className="sculpture-wave" filter={ref('shadow')} transform="rotate(-12 135 179)">
      <rect x="42" y="132" width="180" height="97" rx="24" fill="#cfdef3" />
      <rect x="41" y="126" width="180" height="97" rx="24" fill={ref('glass')} stroke="white" strokeWidth="2" />
      <g stroke={ref('wave')} strokeWidth="7" strokeLinecap="round">
        <path d="M64 171v8M79 158v34M94 166v18M109 151v48M124 160v30M139 145v60M154 158v34M169 166v18M184 154v42M199 171v8" />
      </g>
    </g>
    <g className="sculpture-play" filter={ref('shadow')} transform="rotate(14 294 120)">
      <rect x="237" y="65" width="112" height="112" rx="33" fill={ref('edge')} />
      <rect x="231" y="57" width="112" height="112" rx="33" fill={ref('blue')} stroke="#90c2ff" strokeWidth="1.5" />
      <path d="M275 91c0-4 4-6 7-4l32 21c3 2 3 6 0 8l-32 21c-3 2-7 0-7-4V91Z" fill="#1957c2" opacity=".4" transform="translate(1 4)" />
      <path d="M273 88c0-4 4-6 7-4l32 21c3 2 3 6 0 8l-32 21c-3 2-7 0-7-4V88Z" fill="white" />
      <path d="M250 77c4-5 9-7 16-7" stroke="white" strokeWidth="4" opacity=".45" strokeLinecap="round" />
    </g>
    <circle cx="104" cy="78" r="16" fill={ref('orb')} filter={ref('small-shadow')} />
    <circle cx="325" cy="235" r="9" fill={ref('orb')} />
    <g filter={ref('small-shadow')} transform="rotate(10 96 255)"><rect x="70" y="231" width="53" height="49" rx="18" fill="white" /><path d="m84 256 8 7 15-17" stroke="#3182f6" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" /></g>
    <path d="m351 188 3 9 9 3-9 3-3 9-3-9-9-3 9-3 3-9Z" fill="#90c2ff" />
  </svg>;
}
