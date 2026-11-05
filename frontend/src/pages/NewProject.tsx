import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, AudioLines, Check, Clapperboard, Image, Info, Link2, Monitor, Music2 } from 'lucide-react';
import { UploadZone } from '../components/lucian/UploadZone';
import { PillTabs } from '../components/lucian/PillTabs';
import { ProductionStory } from '../components/stageshow/ProductionStory';
import { useWorkspace } from '../store';
import { createVisualSample } from '../data';
import { validateSourceUrl, validateVideo } from '../lib';
import type { ContentSignal, Project } from '../types';

const SIGNALS: Array<{ key: ContentSignal; label: string; Icon: typeof Image }> = [
  { key: 'visual', label: '장면·행동', Icon: Image }, { key: 'speech', label: '발화·대화', Icon: AudioLines },
  { key: 'music', label: '음악·소리', Icon: Music2 }, { key: 'screen', label: '화면·자료', Icon: Monitor },
];
function readDuration(file: File) {
  return new Promise<number>(resolve => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);
    let settled = false;
    const finish = (value: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute('src');
      video.load();
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(0), 4000);
    video.preload = 'metadata';
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) ? video.duration : 0);
    video.onerror = () => finish(0);
    video.src = objectUrl;
  });
}

export function NewProject() {
  const { addProject, notify } = useWorkspace();
  const navigate = useNavigate();
  const [method, setMethod] = useState<'file' | 'url' | 'sample'>('file');
  const [file, setFile] = useState<File>();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [purpose, setPurpose] = useState('하이라이트');
  const [focus, setFocus] = useState('');
  const [signals, setSignals] = useState<ContentSignal[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const selectFile = (next: File) => {
    const invalid = validateVideo(next);
    setError(invalid ?? '');
    if (!invalid) { setFile(next); if (!title.trim()) setTitle(next.name.replace(/\.[^.]+$/, '')); }
  };
  const chooseMethod = (next: 'file' | 'url' | 'sample') => { setMethod(next); setError(''); if (next === 'sample' && !title.trim()) setTitle('장면으로 보는 하루'); };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (method === 'file' && !file) { setError('원본 영상을 선택해 주세요.'); return; }
    if (method === 'url') { const invalid = validateSourceUrl(url); if (invalid) { setError(invalid); return; } }
    if (!title.trim()) { setError('프로젝트 이름을 입력해 주세요.'); return; }
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const sample = method === 'sample' ? createVisualSample() : undefined;
      const duration = method === 'file' && file ? await readDuration(file) : sample?.duration ?? 0;
      const project: Project = {
        ...(sample ?? {}),
        id: crypto.randomUUID(), title: title.trim(), genre: 'general', source: method,
        sourceName: method === 'file' ? file!.name : method === 'url' ? url.trim() : sample!.sourceName,
        sourceUrl: method === 'url' ? url.trim() : undefined,
        fileSize: method === 'file' ? file?.size : undefined,
        clips: undefined, activeClipId: undefined,
        duration, favorite: false, status: 'ready', progress: 100, createdAt: now, updatedAt: now,
        contentProfile: { purpose, focus: focus.trim() || undefined, signals: signals.length ? signals : method === 'sample' ? ['visual'] : [] },
      };
      addProject(project, method === 'file' ? file : undefined);
      notify(method === 'sample' ? '샘플 프로젝트를 만들었어요' : '프로젝트를 만들었어요', method === 'sample' ? '미리 준비한 장면 후보를 확인해 보세요.' : '원본 확인과 수동 클립 편집을 시작할 수 있어요.');
      navigate('/projects/' + project.id);
    } catch { setError('프로젝트를 만들지 못했어요. 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  }

  return <div className="new-project new-project-v3">
    <Link to="/projects" className="back-link"><ArrowLeft size={15} />프로젝트</Link>
    <div className="page-heading"><div><div className="page-eyebrow">새 프로젝트</div><h1>영상으로 시작하기</h1><p>분야 제한 없이, 원하는 순간을 클립으로.</p></div></div>
    <div className="registration-layout">
      <form className="registration-card" onSubmit={submit}>
        <section className="form-section"><div className="form-section-title"><span>01</span><h2>원본 영상</h2></div>
          <PillTabs label="영상 등록 방식" value={method} onChange={chooseMethod} options={[{ value: 'file', label: '파일 업로드' }, { value: 'url', label: '영상 URL' }, { value: 'sample', label: '샘플' }]} />
          {method === 'file' ? <><UploadZone file={file} onFile={selectFile} onRemove={() => setFile(undefined)} /><p className="form-hint"><Info size={13} />파일은 서버 전송 없이 이 창에서 미리 봅니다.</p></> : method === 'url' ? <div className="url-entry"><label className="field-label" htmlFor="source-url">영상 주소</label><div className="input-with-icon"><Link2 size={17} /><input id="source-url" type="url" placeholder="https://..." maxLength={4096} value={url} onChange={event => { setUrl(event.target.value); setError(''); }} /></div><p className="form-hint">주소만 저장합니다. 원본 가져오기는 연결 전입니다.</p></div> : <div className="sample-entry"><span><Clapperboard size={28} /></span><h3>장면 기반 샘플</h3><p>발화 없이도 후보와 클립을 탐색해 보세요.</p><small>미리 작성한 예시이며 실제 분석 결과가 아닙니다.</small></div>}
        </section>
        <section className="form-section"><div className="form-section-title"><span>02</span><h2>어떤 클립을 만들까요?</h2><small>선택 사항</small></div>
          <div className="project-purpose-row"><label><span className="field-label">제작 목적</span><select className="text-input" aria-label="제작 목적" value={purpose} onChange={event => setPurpose(event.target.value)}><option>하이라이트</option><option>짧은 요약</option><option>SNS 콘텐츠</option><option>직접 편집</option></select></label></div>
          <label className="field-label" htmlFor="clip-focus">남기고 싶은 순간</label><input className="text-input" id="clip-focus" maxLength={160} placeholder="예: 결정적인 플레이, 제품의 움직임" value={focus} onChange={event => setFocus(event.target.value)} />
          <fieldset className="content-signals"><legend>영상 특성 <span>여러 개 선택 가능</span></legend><div>{SIGNALS.map(({ key, label, Icon }) => <label key={key} className={signals.includes(key) ? 'selected' : ''}><input type="checkbox" checked={signals.includes(key)} onChange={() => setSignals(current => current.includes(key) ? current.filter(value => value !== key) : [...current, key])} /><Icon size={15} /><span>{label}</span>{signals.includes(key) && <Check size={13} />}</label>)}</div><small>직접 지정하는 정보이며 자동 분석은 연결 전입니다.</small></fieldset>
        </section>
        <section className="form-section"><div className="form-section-title"><span>03</span><h2>프로젝트 이름</h2></div><label className="sr-only" htmlFor="project-name">프로젝트 이름</label><input className="text-input" id="project-name" required maxLength={80} placeholder="예: 주말의 기록" value={title} onChange={event => { setTitle(event.target.value); setError(''); }} /></section>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="form-footer"><Link to="/projects" className="btn secondary">취소</Link><button className="btn primary" type="submit" disabled={busy}>{busy ? '원본 확인 중…' : '프로젝트 만들기'}<ArrowRight size={16} /></button></div>
      </form>
      <aside className="registration-story"><div className="story-heading"><span className="page-eyebrow">원본 하나, 여러 클립</span><h2>좋은 순간에 집중하세요.</h2><p>후보를 골라 각각 편집하고,<br />원본 근거와 함께 확인하세요.</p></div><ProductionStory /><div className="registration-story-foot"><span><Image size={15} />장면</span><span><AudioLines size={15} />발화</span><span><Music2 size={15} />소리</span></div></aside>
    </div>
  </div>;
}
