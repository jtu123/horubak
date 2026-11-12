// Error-summary pattern adapted from Lucian #244 · MIT (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#244
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import './signup-form.css';
import { SERVER_AUTH } from '../../services/api';
const PASSWORD_MIN = SERVER_AUTH ? 12 : 8;
type Field = 'name' | 'email' | 'password' | 'acknowledged';
interface Values { name: string; email: string; password: string; acknowledged: boolean }
interface Props { onCreate: (name: string, email: string, password: string) => Promise<void>; onComplete: () => void }
const FIELDS = [
  { key: 'name', label: '이름', type: 'text', autoComplete: 'nickname', maxLength: 24, placeholder: '이름 입력' },
  { key: 'email', label: '이메일', type: 'email', autoComplete: 'username', maxLength: 254, placeholder: 'name@example.com' },
  { key: 'password', label: '비밀번호', type: 'password', autoComplete: 'new-password', maxLength: 128, placeholder: PASSWORD_MIN + '자 이상' },
] as const;
const LABELS: Record<Field, string> = { name: '이름', email: '이메일', password: '비밀번호', acknowledged: '저장 방식 확인' };
function validate(values: Values): Partial<Record<Field, string>> {
  return {
    ...(!values.name.trim() && { name: '이름을 입력해 주세요.' }),
    ...(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email.trim()) && { email: '이메일 형식을 확인해 주세요.' }),
    ...(values.password.length < PASSWORD_MIN && { password: `비밀번호는 ${PASSWORD_MIN}자 이상 입력해 주세요.` }),
    ...(!values.acknowledged && { acknowledged: SERVER_AUTH ? '계정 정보와 편집 정보의 서버 저장을 확인해 주세요.' : '프로필이 이 브라우저에만 저장됨을 확인해 주세요.' }),
  };
}
export function SignupForm({ onCreate, onComplete }: Props) {
  const uid = useId(); const controls = useRef<Partial<Record<Field, HTMLInputElement>>>({});
  const alive = useRef(true);
  const [values, setValues] = useState<Values>({ name: '', email: '', password: '', acknowledged: false });
  const [tried, setTried] = useState(false); const [busy, setBusy] = useState(false); const [serverError, setServerError] = useState('');
  const errors = validate(values); const wrong = Object.keys(errors) as Field[];
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (serverError) controls.current.email?.focus(); }, [serverError]);
  function change<K extends Field>(field: K, value: Values[K]) { setValues(old => ({ ...old, [field]: value })); setServerError(''); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setTried(true); setServerError('');
    if (wrong.length) { controls.current[wrong[0]]?.focus(); return; }
    setBusy(true);
    try { await onCreate(values.name.trim(), values.email.trim(), values.password); if (alive.current) onComplete(); }
    catch (reason) { if (!alive.current) return; setServerError(reason instanceof Error ? reason.message : '프로필을 만들지 못했어요. 다시 시도해 주세요.'); }
    finally { if (alive.current) setBusy(false); }
  }
  return <form className="login-card signup-form" noValidate aria-label="회원가입 양식" aria-busy={busy} onSubmit={submit}>
    <h1>회원가입</h1>
    {tried && (wrong.length > 0 || serverError) && <div className="signup-errors" role="alert"><b>{serverError || wrong.length + '개 항목을 확인해 주세요.'}</b>
      {wrong.length > 0 && <ul>{wrong.map(field => <li key={field}><a href={'#' + uid + '-' + field} onClick={event => { event.preventDefault(); controls.current[field]?.focus(); }}>{LABELS[field]}</a></li>)}</ul>}
    </div>}
    {FIELDS.map(field => {
      const invalid = tried && !!errors[field.key]; const messageId = uid + '-message-' + field.key;
      return <div className="signup-field" key={field.key}>
        <label className="field-label" htmlFor={uid + '-' + field.key}>{field.label}</label>
        <input ref={element => { if (element) controls.current[field.key] = element; else delete controls.current[field.key]; }} className="text-input" id={uid + '-' + field.key} type={field.type} autoComplete={field.autoComplete} required maxLength={field.maxLength} minLength={field.key === 'password' ? PASSWORD_MIN : undefined} placeholder={field.placeholder} value={values[field.key]} disabled={busy} aria-invalid={invalid || undefined} aria-describedby={invalid ? messageId : undefined} onChange={event => change(field.key, event.target.value)} />
        {invalid && <p className="field-error" id={messageId}>{errors[field.key]}</p>}
      </div>;
    })}
    <label className="signup-ack" htmlFor={uid + '-acknowledged'}>
      <input ref={element => { if (element) controls.current.acknowledged = element; else delete controls.current.acknowledged; }} id={uid + '-acknowledged'} type="checkbox" checked={values.acknowledged} disabled={busy} aria-invalid={tried && !!errors.acknowledged || undefined} aria-describedby={tried && errors.acknowledged ? uid + '-message-acknowledged' : undefined} onChange={event => change('acknowledged', event.target.checked)} />
      <span>{SERVER_AUTH ? '계정·편집 정보가 서버에 저장됨을 확인했어요' : '이 브라우저에만 저장됨을 확인했어요'}</span>
    </label>
    {tried && errors.acknowledged && <p className="field-error" id={uid + '-message-acknowledged'}>{errors.acknowledged}</p>}
    <button className="btn primary full" type="submit" disabled={busy}>{busy ? '생성 중…' : '계정 만들기'}</button>
  </form>;
}
