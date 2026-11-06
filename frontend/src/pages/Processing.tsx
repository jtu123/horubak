import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, CircleAlert, Clapperboard, FileCheck2, ScanText, Image, X } from 'lucide-react';
import { useWorkspace } from '../store';
import { Poster } from '../components/Poster';
import { getProjectLabel } from '../data';
import { formatTime } from '../lib';
import { describeProject } from '../project-presentation';
export function Processing() {
  const { id } = useParams(); const { projects, updateProject, notify, videos } = useWorkspace();
  const navigate = useNavigate(); const project = projects.find(p => p.id === id);
  if (!project) return <div className="empty-state"><h1>프로젝트를 찾을 수 없어요</h1><Link className="btn primary" to="/projects">목록으로</Link></div>;
  const view = describeProject(project, project.edit, !!videos[project.id]);
  const ready = project.status === 'ready' || project.status === 'completed';
  const running = project.status === 'processing'; const failed = project.status === 'failed';
  const progress = Number.isFinite(project.progress) ? Math.max(0, Math.min(100, project.progress)) : 0;
  const current = ready ? 4 : Math.min(3, Math.floor(progress / 25)); const sample = project.source === 'sample';
  const steps = [
    { title: '등록 정보', desc: '원본·제작 목적 확인', icon: FileCheck2 },
    { title: sample ? '샘플 근거' : '영상·소리 탐색', desc: sample ? '미리 작성한 원본 근거' : '분석 연결 전', icon: Image },
    { title: sample ? '샘플 후보' : '하이라이트 후보', desc: sample ? '샘플 후보·추천 근거' : '분석 연결 전', icon: ScanText },
    { title: '프로젝트', desc: '클립 작업공간 준비', icon: Clapperboard },
  ];
  return <div className="processing-page">
    <Link className="back-link" to="/projects"><ArrowLeft size={16} /> 내 프로젝트</Link>
    <div className="processing-heading"><h1>{view.statusLabel}</h1><p>화면 흐름을 확인하는 데모입니다. 실제 AI 분석을 실행하지 않습니다.</p></div>
    <div className="processing-card">
      <div className="processing-file"><div><Poster project={project} mini /></div><span><b>{project.title}</b><small>{getProjectLabel(project)} · {project.duration ? formatTime(project.duration) : '길이 확인 필요'} · {view.sourceLabel}</small></span></div>
      {failed && <p className="notice" role="alert"><CircleAlert size={16} /><span>화면 준비를 완료하지 못했어요. 다시 시작하거나 목록으로 돌아가세요.</span></p>}
      <div className="progress-heading"><span>{ready ? '화면 준비 완료' : running ? '데모 진행률' : '중단 시점'}</span><b>{progress}<small>%</small></b></div>
      <div className="progress-track" role={running || ready ? 'progressbar' : undefined} aria-label={running || ready ? '데모 화면 준비 진행률' : undefined} aria-valuenow={running || ready ? progress : undefined} aria-valuemin={running || ready ? 0 : undefined} aria-valuemax={running || ready ? 100 : undefined}><span style={{ width: progress + '%' }} /></div>
      <div className="processing-step-list">{steps.map(({ title, desc, icon: Icon }, index) => {
        const done = index < current; const active = running && index === current;
        return <div key={title} className={done ? 'done' : active ? 'current' : ''}><span className="processing-step-icon">{done ? <Check size={18} /> : <Icon size={18} />}</span><span><b>{title}</b><small>{desc}</small></span>{done ? <Check size={16} /> : active ? <span className="tiny-spinner" aria-label="데모 준비 중" /> : null}</div>;
      })}</div>
      {!sample && <p className="notice"><CircleAlert size={16} /><span>{project.source === 'url' && !videos[project.id] ? '주소만 등록됐어요. 원본 가져오기와 분석은 연결 전입니다.' : '원본 미리보기와 수동 편집만 사용할 수 있어요. 분석은 연결 전입니다.'}</span></p>}
      <div className="processing-actions">{ready ? <button className="btn primary full" onClick={() => navigate('/projects/' + project.id)}>프로젝트 열기 <ArrowRight size={16} /></button>
        : running ? <button className="btn secondary" onClick={() => { updateProject(project.id, { status: 'cancelled' }); notify('화면 준비를 취소했어요', '다시 시작으로 이어갈 수 있어요.', 'info'); }}><X size={16} /> 취소</button>
        : <button className="btn primary full" onClick={() => updateProject(project.id, { status: 'processing', startedAt: Date.now(), progress: 0 })}>다시 시작 <ArrowRight size={16} /></button>}
      </div>
    </div>
  </div>;
}
