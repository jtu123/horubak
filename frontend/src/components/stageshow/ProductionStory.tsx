import { useState, type MouseEvent } from 'react';
import { Bookmark, Check, Film, Layers3, Play } from 'lucide-react';
import { Stage, Bar, Text, Window, Row } from './kit';
import { SPORTS_SAMPLES, type SportsSample } from '../../sports-samples';
import { formatTime } from '../../lib';
import { useWorkspace } from '../../store';
import './production-story.css';

const waveform = [8, 14, 11, 18, 13, 22, 29, 24, 16, 23, 13, 10, 17, 22, 12, 8, 13, 9, 15, 12, 8, 11];

// Adapted from Stageshow examples/static-card. The control plays one local
// example state change using the supplied sample content.
export function ProductionStory({ previewTheme, sample = SPORTS_SAMPLES[1] }: { previewTheme?: 'light' | 'dark'; sample?: SportsSample } = {}) {
  const { theme } = useWorkspace();
  const sceneTheme = previewTheme ?? theme;
  const [preview, setPreview] = useState({ saved: false, instant: false });
  const featured = sample.candidates[0];
  function togglePreview(event: MouseEvent<HTMLButtonElement>) {
    setPreview(current => ({ saved: !current.saved, instant: event.detail === 0 }));
  }
  return <figure className="production-story" aria-labelledby="production-story-caption">
    <div aria-hidden="true" data-saved={preview.saved || undefined} data-instant={preview.instant || undefined}>
      <Stage width={400} height={300} theme={sceneTheme} accent={sceneTheme === 'dark' ? '#a0adff' : '#3548bd'} fidelity="realistic" className="horubak-story">
        {() => <>
          <Window title="후보 탐색" lights="grey" className="hs-window">
            <aside className="hs-sidebar">
              <Film size={16} />
              <Layers3 size={16} className="hs-rail-active" />
              <Bar w={12} h={4} />
            </aside>
            <div className="hs-main">
              <div className="hs-list">
                {sample.evidence.map((scene, index) => <Row
                  key={scene.id}
                  pad={8}
                  selected={index === 0}
                  className="hs-row"
                  lead={<Film size={14} />}
                  title={<Text>{scene.title}</Text>}
                  meta={<Text>{formatTime(scene.start)}</Text>}
                />)}
              </div>
              <div className="hs-waveform">
                <div className="hs-waveform-selection" />
                {waveform.map((height, index) => <i key={index} style={{ height }} />)}
              </div>
            </div>
          </Window>
          <div className="hs-clip">
            <div className="hs-clip-status">
              <span className="hs-clip-source"><Bookmark size={13} /><Text>선택한 구간</Text></span>
              <span className="hs-clip-saved"><Check size={13} /><Text>클립에 보관됨</Text></span>
            </div>
            <Text className="hs-clip-title">{featured.title}</Text>
            <div className="hs-clip-details">
              <Text>{formatTime(featured.start) + ' – ' + formatTime(featured.end)}</Text>
              <Text>{String(featured.end - featured.start) + '초'}</Text>
            </div>
          </div>
        </>}
      </Stage>
    </div>
    <figcaption>
      <span id="production-story-caption">샘플 영상의 편집 흐름</span>
      <button type="button" aria-pressed={preview.saved} onClick={togglePreview}>
        <Play size={12} aria-hidden="true" />
        클립 보관 예시
      </button>
    </figcaption>
  </figure>;
}

