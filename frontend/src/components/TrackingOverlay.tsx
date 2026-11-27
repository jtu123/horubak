import { containTrackingBox, currentObservations } from '../tracking-model';
import type { TrackingResult, TrackingSelection } from '../tracking-model';

export function TrackingOverlay({ result, selections, time, width, height, videoWidth, videoHeight, disabled, onSelect }: {
  result: TrackingResult; selections: TrackingSelection[]; time: number;
  width: number; height: number; videoWidth: number; videoHeight: number;
  disabled?: boolean;
  onSelect: (sceneId: string, trackId: string) => void;
}) {
  return <div className="tracking-overlay" aria-label="현재 시점의 피사체 관측">
    {currentObservations(result, time).map(({ track, observation }) => {
      const box = containTrackingBox(observation.bbox, videoWidth, videoHeight, width, height);
      if (!box) return null;
      const selected = selections.some(item => item.sceneId === track.sceneId && item.trackId === track.id);
      return <button key={track.id} type="button" className={'tracking-box' + (selected ? ' is-selected' : '')} style={box}
        disabled={disabled} aria-label={`${track.label} ${track.id} 주요 대상 선택`} aria-pressed={selected} onClick={() => onSelect(track.sceneId, track.id)}>
        <span>{track.label} · {track.id}</span>
      </button>;
    })}
  </div>;
}
