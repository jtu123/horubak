import { Check, Clapperboard, Film, Layers3 } from 'lucide-react';
import { Stage, Bar, Text, Window, Row } from './kit';
import { useWorkspace } from '../../store';
import './production-story.css';

// Adapted from Stageshow examples/static-card. This is a static, labeled
// illustration; it never reads, modifies, or pretends to analyze project data.
export function ProductionStory({ previewTheme }: { previewTheme?: 'light' | 'dark' } = {}) {
  const { theme } = useWorkspace();
  const sceneTheme = previewTheme ?? theme;
  return <figure className="production-story" aria-labelledby="production-story-caption">
    <Stage width={400} height={300} theme={sceneTheme} greys="warm" accent={sceneTheme === 'dark' ? '#bca4ff' : '#7050df'} fidelity="realistic" className="horubak-story">
      {() => <>
        <Window title="추천 후보" className="hs-window">
          <aside className="hs-sidebar">
            <Film size={18} />
            <Bar w={38} h={5} />
            <Bar w={46} h={5} />
            <div className="hs-active-nav"><Layers3 size={14} /><Text>후보</Text></div>
            <Bar w={32} h={5} />
          </aside>
          <div className="hs-main">
            <div className="hs-heading"><Text>원본에서 찾은 장면</Text><Bar w={22} h={6} /></div>
            <div className="hs-list">
              <Row pad={8} className="hs-row" lead={<Film size={16} />} title={<Text>숲길의 시작</Text>} />
              <Row pad={8} selected className="hs-row" lead={<Film size={16} />} title={<Text>빛이 머무는 순간</Text>} data-target="selected-scene"><Bar w={38} h={5} /></Row>
              <Row pad={8} className="hs-row" lead={<Film size={16} />} title={<Text>다시, 길 위로</Text>} />
              {[54, 78, 60].map((w, i) => <Row key={i} pad={8} className="hs-row" lead={<Bar w={16} h={14} r={4} />} title={<Bar w={w} h={5} />} />)}
            </div>
          </div>
        </Window>
        <div className="hs-clip">
          <div className="hs-clip-art"><Clapperboard size={28} /></div>
          <div className="hs-clip-details"><Text className="hs-clip-title">빛이 머무는 순간</Text><Text className="hs-clip-time">00:24 — 01:12</Text></div>
          <div className="hs-clip-footer"><span><Check size={14} /><Text>편집 보관</Text></span><Text>48초</Text></div>
        </div>
      </>}
    </Stage>
    <figcaption id="production-story-caption">제작 흐름 예시 · 실제 분석 결과가 아닙니다</figcaption>
  </figure>;
}

