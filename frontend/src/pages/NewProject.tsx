import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, GraduationCap, Info, Link2, Mic2, Radio, Sparkles } from 'lucide-react';
import { UploadZone } from '../components/lucian/UploadZone';
import { PillTabs } from '../components/lucian/PillTabs';
import { useWorkspace } from '../store';
import { initialEdit } from '../data';
import { SITE_NAME } from '../site';
import { validateSourceUrl, validateVideo } from '../lib';
import type { Genre, Project } from '../types';

export function NewProject() {
  const { addProject, notify } = useWorkspace(); const navigate = useNavigate();
  const [method, setMethod] = useState<'file' | 'url' | 'sample'>('file'); const [file, setFile] = useState<File>(); const [url, setUrl] = useState(''); const [title, setTitle] = useState(''); const [genre, setGenre] = useState<Genre>('lecture'); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const selectFile = (next: File) => { const invalid = validateVideo(next); setError(invalid ?? ''); if (!invalid) { setFile(next); if (!title) setTitle(next.name.replace(/\.[^.]+$/, '')); } };
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return;
    if (method === 'file' && !file) { setError('먼저 원본 영상을 선택해 주세요.'); return; }
    if (method === 'url') { const invalid = validateSourceUrl(url); if (invalid) { setError(invalid); return; } }
    if (!title.trim()) { setError('프로젝트 이름을 입력해 주세요.'); return; }
    setBusy(true); let duration = 0;
    if (file && method === 'file') {
      duration = await new Promise<number>(resolve => { const video = document.createElement('video'); const objectUrl = URL.createObjectURL(file); const finish = (value: number) => { clearTimeout(timer); URL.revokeObjectURL(objectUrl); video.removeAttribute('src'); video.load(); resolve(value); }; const timer = window.setTimeout(() => finish(0), 4000); video.preload = 'metadata'; video.onloadedmetadata = () => finish(Number.isFinite(video.duration) ? video.duration : 0); video.onerror = () => finish(0); video.src = objectUrl; });
    }
    const now = new Date().toISOString();
    const p: Project = { id: crypto.randomUUID(), title: title.trim(), genre, source: method, sourceName: method === 'file' ? file!.name : method === 'url' ? url : `${SITE_NAME} 장르별 샘플`, sourceUrl: method === 'url' ? url : undefined, fileSize: file?.size, duration: method === 'sample' ? 1842 : duration, favorite: false, status: 'processing', startedAt: Date.now(), progress: 0, createdAt: now, updatedAt: now, edit: method === 'sample' ? initialEdit(genre) : undefined };
    addProject(p, method === 'file' ? file : undefined); notify('프로젝트를 등록했어요'); navigate(`/projects/${p.id}/processing`);
  }
  const genres: Array<{ key: Genre; title: string; icon: typeof GraduationCap }> = [{ key: 'lecture', title: '강의', icon: GraduationCap }, { key: 'speech', title: '연설', icon: Mic2 }, { key: 'podcast', title: '팟캐스트', icon: Radio }];
  return <div className="new-project page-enter"><Link to="/projects" className="back-link"><ArrowLeft size={16} /> 내 프로젝트</Link><div className="page-heading"><div><h1>새 영상 등록</h1></div></div><div className="registration-layout"><form className="registration-card" onSubmit={submit}><div className="form-section"><div className="form-section-title"><span>01</span><h2>원본 영상</h2></div><PillTabs label="영상 등록 방식" value={method} onChange={v => { setMethod(v); setError(''); }} options={[{ value: 'file', label: '파일' }, { value: 'url', label: 'URL' }, { value: 'sample', label: '샘플' }]} />{method === 'file' ? <><UploadZone file={file} error={error && !title ? undefined : error} onFile={selectFile} onRemove={() => setFile(undefined)} /><p className="form-hint"><Info size={14} /> 영상은 서버 전송 없이 이 창에서만 미리 봅니다.</p></> : method === 'url' ? <div className="url-entry"><label className="field-label" htmlFor="source-url">영상 주소</label><div className="input-with-icon"><Link2 size={18} /><input id="source-url" type="url" placeholder="https://..." value={url} onChange={e => { setUrl(e.target.value); setError(''); }} /></div><p className="form-hint">주소만 저장합니다. 원본 가져오기는 연결 전입니다.</p></div> : <div className="sample-entry"><span><Sparkles size={26} /></span><h3>샘플 미리보기</h3><p>미리 준비한 전사와 후보로 편집합니다.</p><small>실제 AI 분석을 실행하지 않습니다.</small></div>}</div><div className="form-section"><div className="form-section-title"><span>02</span><h2>영상 장르</h2></div><div className="genre-picker" role="group" aria-label="영상 장르 선택">{genres.map(({ key, title: text, icon: Icon }) => <button type="button" className={genre === key ? 'selected' : ''} key={key} aria-pressed={genre === key} onClick={() => setGenre(key)}><span className="genre-choice-icon"><Icon size={22} /></span><b>{text}</b>{genre === key && <Check className="genre-check" size={14} />}</button>)}</div></div><div className="form-section"><div className="form-section-title"><span>03</span><h2>프로젝트 이름</h2></div><label className="sr-only" htmlFor="project-name">프로젝트 이름</label><input className="text-input" id="project-name" required maxLength={80} placeholder="예: 인문학 특강" value={title} onChange={e => { setTitle(e.target.value); setError(''); }} /></div>{error && <p className="field-error" role="alert">{error}</p>}<div className="form-footer"><Link to="/projects" className="btn secondary">취소</Link><button className="btn primary" type="submit" disabled={busy}>{busy ? '확인 중…' : '등록'}<ArrowRight size={17} /></button></div></form></div></div>;
}
