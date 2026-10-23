// Lucian UX/UI Prompt #042 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#042
import type { CSSProperties } from 'react';
import { Check } from 'lucide-react';
export function StepProgress({ steps, current }: { steps: string[]; current: number }) {
  return <div className="ux u042 app-stepper"><ol className="u042-steps" aria-label="처리 단계"><li className="u042-line" aria-hidden="true" style={{ '--p': Math.min(1, current / Math.max(1, steps.length - 1)) } as CSSProperties}><i /></li>{steps.map((step, i) => <li key={step} className={`u042-st ${i < current ? 'done' : i === current ? 'cur' : ''}`}><span className="u042-dot" aria-current={i === current ? 'step' : undefined}><span>{i + 1}</span><Check /></span><small>{step}</small></li>)}</ol></div>;
}
