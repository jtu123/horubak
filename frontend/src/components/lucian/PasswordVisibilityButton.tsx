// Lucian UX/UI Prompt #062 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#062
interface Props {
  inputId: string;
  visible: boolean;
  disabled: boolean;
  onToggle: () => void;
}

export function PasswordVisibilityButton({ inputId, visible, disabled, onToggle }: Props) {
  return <button className="icon-button u062-eye" type="button" disabled={disabled} aria-controls={inputId} aria-pressed={visible} aria-label={visible ? '비밀번호 숨기기' : '비밀번호 보기'} onClick={onToggle}>
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g className="u062-lid"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></g>
      <path className="u062-slash" d="M4 4l16 16" />
    </svg>
  </button>;
}
