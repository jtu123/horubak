import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, ChevronRight, FileText, Film, Info, Keyboard, Layers3, MessageSquare, Plus, Redo2, ScanLine, ShieldCheck, SlidersHorizontal, Undo2 } from 'lucide-react';
import { getProjectCandidates, getProjectEvidence, getProjectLabel, getProjectTranscript } from '../data';
import { getSportsSample } from '../sports-samples';
import { useWorkspace } from '../store';
import { getActiveClip, getProjectClips } from '../workspace-model';
import { describeProject } from '../project-presentation';
import { formatTime, rangeError } from '../lib';
import type { Candidate, EditState } from '../types';
import { PillTabs } from '../components/lucian/PillTabs';
import { SourceReconnect, VideoPreview } from '../components/VideoPreview';
import { Modal } from '../components/Modal';
import { OutputControls } from '../components/OutputControls';
import { getOutputProfile } from '../output-profile';
import { EMPTY_EDIT_HISTORY, rememberEdit, stepEditHistory } from '../edit-history';
import type { EditHistories } from '../edit-history';
import '../styles/editor-v3.css';
import '../styles/editor-history.css';

export function Editor() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { projects, createClip, selectClip, updateClip, updateProject, notify, videos, storageError: localStorageError, serverAuth, user, syncStatus } = useWorkspace();
  const storageError = localStorageError || ['error', 'conflict'].includes(syncStatus);
  const project = projects.find(item => item.id === id);
  const clips = project ? getProjectClips(project) : [];
  const requestedClip = clips.find(item => item.id === params.get('clip'));
  const clip = requestedClip ?? (project ? getActiveClip(project) : undefined);
  const clipId = clip?.id;
  const [leftTab, setLeftTab] = useState<'clips' | 'source'>('clips');
  const [rightTab, setRightTab] = useState<'subtitles' | 'crop' | 'ai'>('subtitles');
  const [aiMode, setAiMode] = useState<'context' | 'command' | 'screen'>('context');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(clip?.edit.start ?? 0);
  const [histories, setHistories] = useState<EditHistories>({});
  const [review, setReview] = useState<Candidate | null>(null);
  const [exporting, setExporting] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const onPlaying = useCallback((value: boolean) => setPlaying(value), []);
  const onTime = useCallback((value: number) => setTime(value), []);
  useEffect(() => {
    if (project && requestedClip && project.activeClipId !== requestedClip.id) selectClip(project.id, requestedClip.id);
  }, [project?.id, project?.activeClipId, requestedClip?.id, selectClip]);
  useEffect(() => { setTime(clip?.edit.start ?? 0); setPlaying(false); setReview(null); setExporting(false); }, [id, clipId]);
  const historyKey = project && clip ? project.id + ':' + clip.id : '';
  const history = histories[historyKey] ?? EMPTY_EDIT_HISTORY;
  const commit = useCallback((patch: Partial<EditState>) => {
    if (!project || !clip || !Object.entries(patch).some(([key, value]) => clip.edit[key as keyof EditState] !== value)) return;
    const snapshot = { ...clip.edit, aspectRatio: getOutputProfile(clip.edit.aspectRatio).ratio, showSafeArea: clip.edit.showSafeArea ?? false };
    if (!updateClip(project.id, clip.id, patch)) return;
    setHistories(old => rememberEdit(old, historyKey, snapshot));
  }, [project, clip, historyKey, updateClip]);
  const stepHistory = useCallback((direction: 'undo' | 'redo') => {
    if (!project || !clip) return;
    const snapshot = { ...clip.edit, aspectRatio: getOutputProfile(clip.edit.aspectRatio).ratio, showSafeArea: clip.edit.showSafeArea ?? false };
    const result = stepEditHistory(histories, historyKey, snapshot, direction);
    if (!result.edit || !updateClip(project.id, clip.id, result.edit)) return;
    setHistories(result.histories);
    setTime(result.edit.start); setPlaying(false);
  }, [project, clip, histories, historyKey, updateClip]);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)
        || document.querySelector('dialog[open], #main-content[inert]')
        || target instanceof Element && target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
      const key = event.key.toLowerCase();
      const direction = key === 'z' ? event.shiftKey ? 'redo' : 'undo' : key === 'y' && event.ctrlKey && !event.shiftKey ? 'redo' : null;
      if (!direction || !project || !clip) return;
      event.preventDefault();
      stepHistory(direction);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [stepHistory, project, clip]);
  if (!project) return <div className="empty-state"><h1>프로젝트를 찾을 수 없어요</h1><Link to="/projects" className="btn primary">프로젝트 목록</Link></div>;
  if (!clip) return <div className="v3-hub-empty"><Layers3 size={32} /><h1>편집할 클립을 만들어주세요</h1><p>원본에서 구간을 지정하거나 추천 후보를 채택할 수 있어요.</p><div className="v3-empty-actions"><Link className="btn secondary" to={'/projects/' + project.id}>프로젝트로</Link><button className="btn primary" disabled={project.duration < 30 || !['ready', 'completed'].includes(project.status)} onClick={() => { const next = createClip(project.id); if (next) setParams({ clip: next }); }}><Plus size={16} />직접 클립 만들기</button></div></div>;
  const edit = clip.edit;
  const output = getOutputProfile(edit.aspectRatio);
  const candidates = getProjectCandidates(project);
  const transcript = getProjectTranscript(project);
  const evidence = getProjectEvidence(project);
  const selected = candidates.find(item => item.id === edit.candidateId);
  const sample = project.source === 'sample';
  const match = getSportsSample(project);
  const error = describeProject(project, edit, !!videos[project.id]).rangeIssue;
  const windowStart = Math.max(0, edit.start - 20);
  const windowEnd = Math.max(windowStart + 1, Math.min(project.duration || edit.end + 20, edit.end + 20));
  const span = windowEnd - windowStart;
  const seek = (value: number) => { setTime(value); setPlaying(false); };
  const switchClip = (nextId: string) => { selectClip(project.id, nextId); setParams({ clip: nextId }); };
  return <div className="editor-page v3-editor">
    <div className="v3-editor-heading"><div><Link to={'/projects/' + project.id + '?tab=clips'} className="back-link"><ArrowLeft size={15} />{project.title}</Link><div className="v3-editor-title"><h1>{clip.title}</h1><span className="v3-count">{formatTime(Math.max(0, edit.end - edit.start))}</span></div><div className="v3-editor-meta"><span>{getProjectLabel(project)}</span><span>·</span><span className={storageError ? 'v3-save-status is-error' : 'v3-save-status'}>{storageError ? '저장 실패' : (serverAuth && !user?.guest ? (syncStatus === 'saving' ? '서버 저장 중…' : ['error', 'conflict'].includes(syncStatus) ? '서버 저장 확인 필요' : '서버에 저장됨') : '브라우저에 저장됨')}</span></div></div><div className="v3-editor-actions"><label className="v3-clip-switch"><Layers3 size={15} /><span className="sr-only">편집할 클립</span><select aria-label="편집할 클립" value={clip.id} onChange={event => switchClip(event.target.value)}>{clips.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><div className="v3-history-actions" role="group" aria-label="편집 이력"><button className="icon-button" aria-label="되돌리기" title="되돌리기 (Ctrl/⌘ Z)" disabled={!history.past.length} onClick={() => stepHistory('undo')}><Undo2 size={16} /></button><button className="icon-button" aria-label="다시 실행" title="다시 실행 (Ctrl/⌘ Shift Z)" disabled={!history.future.length} onClick={() => stepHistory('redo')}><Redo2 size={16} /></button></div><button className="icon-button v3-shortcut-help" aria-label="편집 단축키" title="편집 단축키" onClick={() => setShortcuts(true)}><Keyboard size={16} /></button><button className="btn primary" disabled={!!error} onClick={() => setExporting(true)}>결과 확인<ArrowRight size={15} /></button></div></div>
    <div className="v3-demo-strip"><Info size={14} /><span>{match ? '경기 샘플 영상 · 미리 정한 후보 · MP4 출력 연결 전' : sample ? '샘플 분석·이미지입니다. 실제 AI 분석과 MP4 출력은 연결 전입니다.' : project.sourceUploaded ? '서버 원본 미리보기 · 분석과 MP4 출력은 연결 전입니다.' : '원본 미리보기 · 분석과 MP4 출력은 연결 전입니다.'}</span></div>
    <div className="editor-layout">
      <aside className="candidate-panel editor-panel v3-editor-explorer">
        <PillTabs label="편집 탐색" value={leftTab} onChange={setLeftTab} options={[{ value: 'clips', label: '내 클립' }, { value: 'source', label: '원본 근거' }]} />
        {leftTab === 'clips' ? <><div className="panel-subheading"><span>저장한 클립</span><b>{clips.length}</b></div><div className="v3-editor-clips">{clips.map((item, index) => <button key={item.id} className={'v3-editor-clip' + (item.id === clip.id ? ' selected' : '')} aria-pressed={item.id === clip.id} onClick={() => switchClip(item.id)}><span className="v3-editor-clip-index">{String(index + 1).padStart(2, '0')}</span><span><b>{item.title}</b><small>{formatTime(item.edit.start)} — {formatTime(item.edit.end)}</small></span>{item.id === clip.id && <Check size={14} />}</button>)}</div><Link className="v3-explorer-link" to={'/projects/' + project.id + '?tab=candidates'}><Plus size={14} />다른 후보에서 클립 만들기<ArrowRight size={14} /></Link></> : <><div className="panel-subheading"><span>{transcript.length ? '발화 근거' : '장면·이벤트 근거'}</span><b>{transcript.length || evidence.length}</b></div><div className="v3-editor-evidence">{transcript.length ? transcript.map(item => <button key={item.id} className={'v3-evidence-row' + (time >= item.start && time < item.end ? ' is-current' : '')} onClick={() => seek(item.start)}><span>{formatTime(item.start)}<b>{item.speaker}</b></span><p>{item.text}</p></button>) : evidence.length ? evidence.map(item => <button key={item.id} className={'v3-evidence-row' + (time >= item.start && time < item.end ? ' is-current' : '')} onClick={() => seek(item.start)}><span>{formatTime(item.start)}<b>{item.kind === 'sound' ? '소리' : '장면'}</b></span><h3>{item.title}</h3><p>{item.description}</p></button>) : <div className="v3-evidence-empty"><ScanLine size={26} /><h3>분석 연결 전</h3><p>원본을 보며 구간을 직접 지정할 수 있어요.</p></div>}</div>{sample && !transcript.length && <div className="v3-inline-note"><Info size={13} />음성 없는 영상의 샘플입니다.</div>}</>}
      </aside>
      <div className="editor-center">
        <section className="preview-panel"><div className="preview-toolbar"><span>클립 미리보기</span><span>{output.ratio}<ChevronRight size={12} />{output.label}</span></div><VideoPreview project={project} edit={edit} time={time} playing={playing} onTime={onTime} onPlaying={onPlaying} /><SourceReconnect project={project} />{selected && <div className="v3-reason"><div><span>{selected.evidenceKind === 'scene' ? <ScanLine size={14} /> : <FileText size={14} />}선정 이유</span><button className="text-link" onClick={() => { setLeftTab('source'); seek(selected.start); }}>원본 근거<ArrowRight size={13} /></button></div><p>{selected.reason}</p>{selected.warning && <button className="v3-context-open" onClick={() => { setReview(selected); setPlaying(false); }}><ShieldCheck size={15} /><span>{edit.contextApplied ? '맥락 보정 적용됨' : selected.warning.title}</span><ChevronRight size={14} /></button>}</div>}</section>
        <section className="timeline editor-panel v3-timeline"><div className="timeline-heading"><h2>원본 구간</h2><span>{formatTime(edit.start)} — {formatTime(edit.end)}<b>{Math.max(0, edit.end - edit.start).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}초</b></span></div><div className="timeline-ruler">{Array.from({ length: 5 }, (_, index) => <span key={index}>{formatTime(windowStart + span * index / 4)}</span>)}</div><div className="v3-interval-track"><div className="v3-interval-selection" style={{ left: Math.max(0, (edit.start - windowStart) / span * 100) + '%', width: Math.max(0, Math.min(100, (edit.end - edit.start) / span * 100)) + '%' }}><span>선택 구간</span></div><div className="v3-playhead" style={{ left: Math.max(0, Math.min(100, (time - windowStart) / span * 100)) + '%' }} /><input type="range" aria-label="원본 영상 탐색" min={windowStart} max={windowEnd} step={.1} value={Math.min(windowEnd, Math.max(windowStart, time))} onChange={event => seek(Number(event.target.value))} /></div><div className="range-inputs"><label>시작<input aria-label="클립 시작 초" type="number" min={0} max={Math.max(0, edit.end - 1)} value={edit.start} step={1} onChange={event => { const start = Number(event.target.value); commit({ start, contextApplied: false }); seek(start); }} /><span>초</span></label><span>—</span><label>종료<input aria-label="클립 종료 초" type="number" min={edit.start + 1} max={project.duration} value={edit.end} step={1} onChange={event => commit({ end: Number(event.target.value), contextApplied: false })} /><span>초</span></label><span className={'range-validation' + (error ? ' invalid' : '')}>{error ? <><Info size={13} />{error}</> : <><Check size={13} />30~60초 기본 프로필</>}</span></div></section>
      </div>
      <aside className="inspector-panel editor-panel v3-inspector"><div className="inspector-heading"><SlidersHorizontal size={16} /><h2>클립 설정</h2></div><PillTabs label="클립 설정" value={rightTab} onChange={setRightTab} options={[{ value: 'subtitles', label: '자막' }, { value: 'crop', label: '구도' }, { value: 'ai', label: 'AI 검토' }]} /><div className="inspector-body">
        {rightTab === 'subtitles' && <><div className="control-title"><h3>자막 표시</h3><button className={'toggle' + (edit.subtitleVisible ? ' on' : '')} role="switch" aria-checked={edit.subtitleVisible} aria-label="자막 표시" onClick={() => commit({ subtitleVisible: !edit.subtitleVisible })}><span /></button></div><label className="field-label" htmlFor="subtitle">미리보기 문구</label><textarea id="subtitle" className="text-input subtitle-text" maxLength={120} value={edit.subtitle} onChange={event => commit({ subtitle: event.target.value })} /><label className="range-label" htmlFor="subtitle-size">글자 크기<b>{edit.subtitleSize}px</b></label><input id="subtitle-size" type="range" min={16} max={38} value={edit.subtitleSize} onChange={event => commit({ subtitleSize: Number(event.target.value) })} /><span className="field-label v3-control-label">강조 색상</span><div className="color-swatches">{['#ffffff', '#ffe18b', '#a7edcf', '#b8caff', '#ffb3a5'].map(color => <button key={color} aria-label={'자막 색상 ' + color} aria-pressed={color === edit.subtitleColor} style={{ background: color }} onClick={() => commit({ subtitleColor: color })}>{color === edit.subtitleColor && <Check size={15} />}</button>)}</div><div className="settings-note"><Info size={14} />현재는 단일 문구 미리보기입니다. 시간별 자막 편집·합성은 연결 전입니다.</div></>}
        {rightTab === 'crop' && <><OutputControls edit={edit} onChange={commit} /><div className="control-title"><h3>화면 구성</h3><span className="tiny-tag">수동</span></div><div className="layout-picker"><button className={edit.layout === 'speaker' ? 'selected' : ''} onClick={() => commit({ layout: 'speaker' })}><span className="layout-glyph portrait" /><b>피사체 중심</b></button><button className={edit.layout === 'full' ? 'selected' : ''} onClick={() => commit({ layout: 'full' })}><span className="layout-glyph landscape" /><b>원본 전체</b></button></div>{([{ label: '가로 위치', key: 'cropX', min: 0, max: 100, step: 1 }, { label: '세로 위치', key: 'cropY', min: 0, max: 100, step: 1 }, { label: '확대', key: 'scale', min: 1, max: 2, step: .05 }] as const).map(control => <div key={control.key}><label className="range-label" htmlFor={control.key}>{control.label}<b>{control.key === 'scale' ? edit[control.key].toFixed(2) + '×' : edit[control.key] + '%'}</b></label><input id={control.key} type="range" min={control.min} max={control.max} step={control.step} value={edit[control.key]} onChange={event => commit({ [control.key]: Number(event.target.value) })} /></div>)}<button className="text-link v3-reset-crop" onClick={() => commit({ cropX: 50, cropY: 50, scale: 1 })}><Undo2 size={13} />구도 초기화</button><div className="settings-note"><ScanLine size={15} />화자·피사체 자동 추적과 시간별 크롭은 연결 전입니다.</div></>}
        {rightTab === 'ai' && <><div className="v3-ai-modes" role="group" aria-label="AI 기능"><button aria-pressed={aiMode === 'context'} onClick={() => setAiMode('context')}>맥락</button><button aria-pressed={aiMode === 'command'} onClick={() => setAiMode('command')}>자연어</button><button aria-pressed={aiMode === 'screen'} onClick={() => setAiMode('screen')}>화면 보존</button></div>{aiMode === 'context' ? <div className="v3-ai-content"><ShieldCheck size={26} /><h3>{selected?.warning ? edit.contextApplied ? '보정안을 적용했어요' : '앞뒤 맥락을 확인해요' : '원본 근거와 함께 확인해요'}</h3><p>{selected?.warning?.description ?? (sample ? '샘플에 표시된 원본 근거를 확인하고 구간을 결정해 주세요.' : '자동 맥락 분석은 연결 전입니다. 원본을 확인하며 직접 구간을 조정할 수 있어요.')}</p>{selected?.warning && <button className="btn secondary full" onClick={() => setReview(selected)}>보정 전후 비교<ArrowRight size={14} /></button>}<button className="text-link" onClick={() => setLeftTab('source')}>원본 근거 열기<ArrowRight size={13} /></button></div> : aiMode === 'command' ? <div className="v3-ai-content"><MessageSquare size={26} /><h3>말로 편집하기</h3><p>구간·자막·스타일·구도를 요청하고 변경 내용을 확인하는 기능입니다.</p><label className="field-label" htmlFor="natural-command">편집 요청</label><textarea id="natural-command" className="text-input" rows={3} disabled placeholder="질문부터 포함하고 자막을 작게 바꿔줘" /><button className="btn secondary full" disabled>명령 해석 연결 전</button></div> : <div className="v3-ai-content"><ScanLine size={26} /><h3>핵심 화면 보존</h3><p>화면 글자·자료·중요 영역을 보존하는 자동 레이아웃은 연결 전입니다.</p><button className="btn secondary full" onClick={() => { setRightTab('crop'); commit({ layout: 'full' }); }}>원본 전체 화면 적용</button><span className="v3-tool-footnote">수동 구도로 중요한 영역을 유지할 수 있어요.</span></div>}</>}
      </div></aside>
    </div>
    {shortcuts && <Modal title="편집 단축키" onClose={() => setShortcuts(false)}><table className="v3-shortcut-table"><tbody><tr><th scope="row">되돌리기</th><td><kbd>Ctrl / ⌘ Z</kbd></td></tr><tr><th scope="row">다시 실행</th><td><kbd>Ctrl / ⌘ Shift Z</kbd><br /><kbd>Ctrl Y</kbd></td></tr><tr><th scope="row">대화상자 닫기</th><td><kbd>Esc</kbd></td></tr></tbody></table><p className="v3-shortcut-note">현재 클립의 최근 20개 편집을 이 화면에서 되돌리거나 다시 실행합니다. 새로고침하면 이력은 초기화됩니다. 입력 중에는 브라우저의 글자 되돌리기를 사용합니다.</p><div className="modal-actions"><button className="btn primary" onClick={() => setShortcuts(false)}>확인</button></div></Modal>}
    {review?.warning && <Modal title="맥락 보정 전후 비교" onClose={() => setReview(null)}><span className="modal-kicker">샘플 맥락 검토 · 현재 클립에 적용</span><h3>{review.title}</h3><div className="context-evidence"><Info size={17} /><div><b>{review.warning.title}</b><p>{review.warning.evidence}</p></div></div><div className="comparison-grid"><div><span>보정 전</span><b>{formatTime(edit.start)} — {formatTime(edit.end)}</b><small>{(edit.end - edit.start).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}초</small></div><div><span>제안 구간</span><b>{formatTime(review.warning.correctedStart)} — {formatTime(review.warning.correctedEnd)}</b><small>{(review.warning.correctedEnd - review.warning.correctedStart).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}초</small></div></div><p className="muted">누락된 앞뒤 근거를 포함합니다. 다른 클립은 변경되지 않습니다.</p><div className="modal-actions"><button className="btn secondary" onClick={() => setReview(null)}>취소</button><button className="btn primary" onClick={() => { const warning = review.warning!; const invalid = rangeError(warning.correctedStart, warning.correctedEnd, project.duration); if (invalid) { notify('보정안을 적용할 수 없어요', invalid, 'error'); return; } commit({ start: warning.correctedStart, end: warning.correctedEnd, contextApplied: true }); seek(warning.correctedStart); setReview(null); notify('이 클립에 맥락 보정안을 적용했어요'); }}>확인하고 적용<Check size={15} /></button></div></Modal>}
    {exporting && <Modal title="편집 정보 확인" onClose={() => setExporting(false)}><div className="v3-export-summary"><Film size={28} /><h3>{clip.title}</h3><p>편집 JSON{transcript.length ? '과 샘플 SRT' : ''}을 확인합니다. MP4 출력은 연결 전입니다.</p></div><div className="export-spec"><span>원본 구간<b>{formatTime(edit.start)} — {formatTime(edit.end)}</b></span><span>영상 출력 목표<b>{output.ratio} · {output.width} × {output.height}</b></span><span>저장 위치<b>{storageError ? '저장 실패' : (serverAuth && !user?.guest ? '서버 DB' : '현재 브라우저')}</b></span></div><div className="modal-actions"><button className="btn secondary" onClick={() => setExporting(false)}>계속 편집</button><button className="btn primary" onClick={() => { if (!updateProject(project.id, { status: 'completed' })) return; navigate('/projects/' + project.id + '/results?clip=' + encodeURIComponent(clip.id)); }}>결과 확인<ArrowRight size={15} /></button></div></Modal>}
  </div>;
}
