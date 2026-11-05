import { getOutputProfile } from '../output-profile';
import type { AspectRatio, EditState } from '../types';
import '../styles/output-profile.css';

export function OutputControls({ edit, onChange }: { edit: EditState; onChange: (patch: Partial<EditState>) => void }) {
  const profile = getOutputProfile(edit.aspectRatio);
  return <section className="output-controls" aria-label="출력 비율 설정">
    <label className="field-label" htmlFor="output-ratio">출력 화면 비율</label>
    <select id="output-ratio" className="text-input" aria-label="출력 화면 비율" value={profile.ratio} onChange={event => onChange({ aspectRatio: event.target.value as AspectRatio })}>
      {(['9:16', '1:1', '16:9', '4:5'] as const).map(ratio => { const item = getOutputProfile(ratio); return <option value={ratio} key={ratio}>{ratio} · {item.label}</option>; })}
    </select>
    <p className="output-target">출력 목표 {profile.width} × {profile.height}</p>
    <label className="output-safe-control"><input type="checkbox" checked={edit.showSafeArea === true} onChange={event => onChange({ showSafeArea: event.target.checked })} /><span>일반 안전영역 표시</span></label>
    <p className="output-guide-note">미리보기용 가이드이며 영상에 포함되지 않습니다. 플랫폼별 영역을 보장하지 않습니다.</p>
  </section>;
}
