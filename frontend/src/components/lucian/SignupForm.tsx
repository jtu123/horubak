// Error-summary pattern adapted from Lucian #244 · MIT (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#244
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import './signup-form.css';
import { ApiError, SERVER_AUTH } from '../../services/api';
import { normalizeSignupUsername, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_RULES } from '../../username';
import { PasswordVisibilityButton } from './PasswordVisibilityButton';
const PASSWORD_MIN = 7;
const PASSWORD_MAX = 15;
const PASSWORD_RULES = `영문·숫자만 ${PASSWORD_MIN}~${PASSWORD_MAX}자`;
type Field = 'name' | 'email' | 'username' | 'password' | 'acknowledged';
interface Values { name: string; email: string; username: string; password: string; acknowledged: boolean }
interface Props { onCreate: (name: string, email: string, username: string, password: string) => Promise<void>; onComplete: () => void }
const FIELDS = [
  { key: 'name', label: '이름', type: 'text', autoComplete: 'nickname', maxLength: 24, placeholder: '이름 입력' },
  { key: 'username', label: '아이디', type: 'text', autoComplete: 'username', minLength: USERNAME_MIN_LENGTH, maxLength: USERNAME_MAX_LENGTH, placeholder: '아이디 입력', hint: USERNAME_RULES },
  { key: 'email', label: '이메일', type: 'email', autoComplete: 'email', maxLength: 254, placeholder: 'name@example.com' },
  { key: 'password', label: '비밀번호', type: 'password', autoComplete: 'new-password', minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX, placeholder: '비밀번호 입력', hint: PASSWORD_RULES },
] as const;
const LABELS: Record<Field, string> = { name: '이름', email: '이메일', username: '아이디', password: '비밀번호', acknowledged: '저장 방식 확인' };
function validate(values: Values, username: string | undefined): Partial<Record<Field, string>> {
  return {
    ...(!values.name.trim() && { name: '이름을 입력해 주세요.' }),
    ...(!username && { username: values.username ? '아이디는 영문·숫자만 사용해 3~10자로 입력해 주세요.' : '아이디를 입력해 주세요.' }),
    ...(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email.trim()) && { email: '이메일 형식을 확인해 주세요.' }),
    ...((values.password.length < PASSWORD_MIN || values.password.length > PASSWORD_MAX || /[^A-Za-z0-9]/.test(values.password)) && {
      password: `비밀번호는 ${PASSWORD_RULES}로 입력해 주세요.`,
    }),
    ...(!values.acknowledged && { acknowledged: SERVER_AUTH ? '계정 정보와 편집 정보의 서버 저장을 확인해 주세요.' : '프로필이 이 브라우저에만 저장됨을 확인해 주세요.' }),
  };
}
export function SignupForm({ onCreate, onComplete }: Props) {
  const uid = useId(); const controls = useRef<Partial<Record<Field, HTMLInputElement>>>({});
  const alive = useRef(true);
  const [values, setValues] = useState<Values>({ name: '', email: '', username: '', password: '', acknowledged: false });
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [tried, setTried] = useState(false); const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<{ message: string; field?: Field }>();
  const username = normalizeSignupUsername(values.username);
  const invalidFields = validate(values, username);
  const errors = serverError?.field ? { ...invalidFields, [serverError.field]: serverError.message } : invalidFields;
  const wrong = Object.keys(errors) as Field[];
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (serverError?.field) controls.current[serverError.field]?.focus(); }, [serverError]);
  function change<K extends Field>(field: K, value: Values[K]) { setValues(old => ({ ...old, [field]: value })); setServerError(undefined); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setTried(true); setServerError(undefined);
    const invalid = Object.keys(invalidFields) as Field[];
    if (!username || invalid.length) { controls.current[invalid[0]]?.focus(); return; }
    setBusy(true);
    try { await onCreate(values.name.trim(), values.email.trim(), username, values.password); if (alive.current) onComplete(); }
    catch (reason) {
      if (!alive.current) return;
      const code = reason instanceof ApiError ? reason.code : undefined;
      const field = code === 'USERNAME_EXISTS' || code === 'INVALID_USERNAME' ? 'username'
        : code === 'EMAIL_EXISTS' ? 'email'
        : code === 'INVALID_PASSWORD' ? 'password' : undefined;
      setServerError({ message: reason instanceof Error ? reason.message : '계정을 만들지 못했어요. 다시 시도해 주세요.', field });
    }
    finally { if (alive.current) setBusy(false); }
  }
  return <form className="login-card signup-form" noValidate aria-label="회원가입 양식" aria-busy={busy} onSubmit={submit}>
    <h1>회원가입</h1>
    {tried && (wrong.length > 0 || serverError) && <div className="signup-errors" role="alert"><b>{serverError?.message || wrong.length + '개 항목을 확인해 주세요.'}</b>
      {wrong.length > 0 && <ul>{wrong.map(field => <li key={field}><a href={'#' + uid + '-' + field} onClick={event => { event.preventDefault(); controls.current[field]?.focus(); }}>{LABELS[field]}</a></li>)}</ul>}
    </div>}
    {FIELDS.map(field => {
      const invalid = tried && !!errors[field.key]; const messageId = uid + '-message-' + field.key;
      const hintId = 'hint' in field ? `${uid}-${field.key}-hint` : undefined;
      const inputId = uid + '-' + field.key;
      const password = field.key === 'password';
      const disableTextCorrection = password || field.key === 'username';
      const input = <input
        ref={element => { if (element) controls.current[field.key] = element; else delete controls.current[field.key]; }}
        className="text-input" id={inputId} name={field.key} type={password && passwordVisible ? 'text' : field.type}
        autoComplete={field.autoComplete} autoCapitalize={disableTextCorrection ? 'none' : undefined}
        autoCorrect={disableTextCorrection ? 'off' : undefined} spellCheck={disableTextCorrection ? false : undefined}
        required maxLength={field.maxLength} minLength={'minLength' in field ? field.minLength : undefined}
        placeholder={field.placeholder} value={values[field.key]} disabled={busy}
        aria-invalid={invalid || undefined} aria-describedby={invalid ? messageId : hintId}
        onChange={event => change(field.key, event.target.value)}
      />;
      return <div className="signup-field" key={field.key}>
        <label className="field-label" htmlFor={inputId}>{field.label}</label>
        {password ? <div className="password-field">
          {input}
          <PasswordVisibilityButton inputId={inputId} visible={passwordVisible} disabled={busy} onToggle={() => setPasswordVisible(value => !value)} />
        </div> : input}
        {'hint' in field && !invalid && <p className="signup-field-hint" id={hintId}>{field.hint}</p>}
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
