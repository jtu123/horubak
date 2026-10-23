// Lucian UX/UI Prompt #032 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#032
import { useRef, useState } from 'react';
import { Check, FileVideo, UploadCloud, X } from 'lucide-react';
import { formatSize } from '../../lib';
export function UploadZone({ file, error, onFile, onRemove }: { file?: File; error?: string; onFile: (file: File) => void; onRemove: () => void }) {
  const input = useRef<HTMLInputElement>(null); const depth = useRef(0); const [over, setOver] = useState(false);
  return <div className={`ux u032 app-upload ${over ? 'is-over' : ''}`}>
    <button className="u032-zone" type="button" onClick={() => input.current?.click()} onDragEnter={e => { e.preventDefault(); depth.current++; setOver(true); }} onDragOver={e => e.preventDefault()} onDragLeave={() => { depth.current--; if (depth.current <= 0) setOver(false); }} onDrop={e => { e.preventDefault(); depth.current = 0; setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}>
      <svg className="u032-dash" aria-hidden="true"><rect width="100%" height="100%" rx="25" /></svg><span className="u032-orb"><UploadCloud /></span><b>영상을 끌어다 놓거나 <em>파일 선택</em></b><small>MP4, MOV · 최대 4GB</small>
    </button>
    <input ref={input} className="u032-file" type="file" accept="video/mp4,video/quicktime,.mp4,.mov" tabIndex={-1} aria-label="원본 영상 선택" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
    <ul className="u032-list" aria-live="polite">{file && <li className="u032-row done"><span className="u032-ic" style={{ background: 'var(--accent)' }}><FileVideo size={23} /></span><span className="u032-meta"><b>{file.name}</b><small>{formatSize(file.size)} · 미리보기 준비</small></span><span className="u032-st"><Check size={15} /></span><button className="icon-button" onClick={onRemove} aria-label="선택한 파일 제거"><X size={16} /></button></li>}</ul>
    {error && <p className="field-error" role="alert">{error}</p>}
  </div>;
}
