// Lucian UX/UI Prompt #063 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#063
// Lucian UX/UI Prompt #244 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#244
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowRight, Check } from 'lucide-react';
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
const STEP_FIELDS: readonly (readonly Field[])[] = [['name'], ['username'], ['email'], ['password', 'acknowledged']];
const SERVER_ERROR_FIELDS = new Map<string, Field>([
  ['USERNAME_EXISTS', 'username'], ['INVALID_USERNAME', 'username'],
  ['EMAIL_EXISTS', 'email'], ['INVALID_PASSWORD', 'password'],
]);

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
  const [step, setStep] = useState(0);
  const [focusRequest, setFocusRequest] = useState<{ field: Field }>();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [attempted, setAttempted] = useState<readonly Field[]>([]);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<{ message: string; field?: Field }>();
  const username = normalizeSignupUsername(values.username);
  const invalidFields = validate(values, username);
  const errors = serverError?.field ? { ...invalidFields, [serverError.field]: serverError.message } : invalidFields;
  const field = FIELDS[step];
  const lastStep = step === FIELDS.length - 1;
  const wrong = STEP_FIELDS[step].filter(key => errors[key] && (attempted.includes(key) || serverError?.field === key));
  const generalError = serverError && !serverError.field ? serverError.message : undefined;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useLayoutEffect(() => {
    if (focusRequest) controls.current[focusRequest.field]?.focus();
  }, [focusRequest]);

  function showStep(index: number, focus: Field = FIELDS[index].key) {
    if (index !== step) {
      setStep(index);
      setPasswordVisible(false);
    }
    setFocusRequest({ field: focus });
  }

  function change<K extends Field>(key: K, value: Values[K]) {
    setValues(old => ({ ...old, [key]: value }));
    if (!serverError?.field || serverError.field === key) setServerError(undefined);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const firstErrorStep = lastStep ? STEP_FIELDS.findIndex(keys => keys.some(key => errors[key])) : step;
    const invalid = STEP_FIELDS[firstErrorStep]?.filter(key => errors[key]);
    if (invalid?.length) {
      setAttempted(previous => [...new Set([...previous, ...invalid])]);
      showStep(firstErrorStep, invalid[0]);
      return;
    }
    if (!lastStep) {
      showStep(step + 1);
      return;
    }
    if (!username) return;
    setServerError(undefined);
    setPasswordVisible(false);
    setBusy(true);
    try { await onCreate(values.name.trim(), values.email.trim(), username, values.password); if (alive.current) onComplete(); }
    catch (reason) {
      if (!alive.current) return;
      const key = reason instanceof ApiError ? SERVER_ERROR_FIELDS.get(reason.code) : undefined;
      setServerError({ message: reason instanceof Error ? reason.message : '계정을 만들지 못했어요. 다시 시도해 주세요.', field: key });
      if (key) showStep(STEP_FIELDS.findIndex(keys => keys.includes(key)), key);
    }
    finally { if (alive.current) setBusy(false); }
  }

  const inputId = `${uid}-${field.key}`;
  const messageId = `${inputId}-error`;
  const hintId = 'hint' in field ? `${inputId}-hint` : undefined;
  const invalid = wrong.includes(field.key);
  const ackInvalid = wrong.includes('acknowledged');
  const disableTextCorrection = lastStep || field.key === 'username';
  const input = <input
    ref={element => { if (element) controls.current[field.key] = element; else delete controls.current[field.key]; }}
    className="text-input" id={inputId} name={field.key} type={lastStep && passwordVisible ? 'text' : field.type}
    autoComplete={field.autoComplete} autoCapitalize={disableTextCorrection ? 'none' : undefined}
    autoCorrect={disableTextCorrection ? 'off' : undefined} spellCheck={disableTextCorrection ? false : undefined}
    required maxLength={field.maxLength} minLength={'minLength' in field ? field.minLength : undefined}
    placeholder={field.placeholder} value={values[field.key]} disabled={busy}
    aria-invalid={invalid || undefined} aria-describedby={invalid ? messageId : hintId}
    onChange={event => change(field.key, event.target.value)}
  />;

  return <form className="login-card signup-form u063 u244" noValidate aria-label="회원가입 양식" aria-busy={busy} onSubmit={submit}>
    <h1>회원가입</h1>
    <p className="u063-count" aria-live="polite" aria-atomic="true">{step + 1} / {FIELDS.length}</p>
    <div className="u063-bar" aria-hidden="true">
      {FIELDS.map(({ key }, index) => <i key={key} data-complete={index <= step} />)}
    </div>
    {step > 0 && <div className="u063-chips" role="group" aria-label="입력한 항목">
      {FIELDS.slice(0, step).map(({ key, label }, index) => <button
        className="u063-chip" key={key} type="button" aria-label={`${label} 수정`} disabled={busy} onClick={() => showStep(index)}
      ><Check size={14} aria-hidden="true" /><span>{values[key]}</span></button>)}
    </div>}
    {(wrong.length > 0 || generalError) && <div className="signup-errors" role="alert">
      <b>{generalError ?? `${wrong.length}개 항목을 확인해 주세요.`}</b>
      {wrong.length > 0 && <ul>{wrong.map(key => <li key={key}><a href={`#${uid}-${key}`} onClick={event => {
        event.preventDefault();
        controls.current[key]?.focus();
      }}>{LABELS[key]}</a></li>)}</ul>}
    </div>}
    <div className="u063-stage" key={field.key}>
      {lastStep && <input type="hidden" name="username" autoComplete="username" value={username ?? ''} />}
      <div className="signup-field">
        <label className="field-label" htmlFor={inputId}>{field.label}</label>
        {lastStep ? <div className="password-field">
          {input}
          <PasswordVisibilityButton inputId={inputId} visible={passwordVisible} disabled={busy} onToggle={() => setPasswordVisible(value => !value)} />
        </div> : input}
        {'hint' in field && !invalid && <p className="signup-field-hint" id={hintId}>{field.hint}</p>}
        {invalid && <p className="field-error" id={messageId}>{errors[field.key]}</p>}
      </div>
      {lastStep && <>
        <label className="signup-ack" htmlFor={`${uid}-acknowledged`}>
          <input ref={element => { if (element) controls.current.acknowledged = element; else delete controls.current.acknowledged; }}
            id={`${uid}-acknowledged`} type="checkbox" checked={values.acknowledged} disabled={busy}
            aria-invalid={ackInvalid || undefined} aria-describedby={ackInvalid ? `${uid}-acknowledged-error` : undefined}
            onChange={event => change('acknowledged', event.target.checked)}
          />
          <span>{SERVER_AUTH ? '계정·편집 정보가 서버에 저장됨을 확인했어요' : '이 브라우저에만 저장됨을 확인했어요'}</span>
        </label>
        {ackInvalid && <p className="field-error" id={`${uid}-acknowledged-error`}>{errors.acknowledged}</p>}
      </>}
    </div>
    <div className="u063-actions">
      {step > 0 && <button className="btn secondary" type="button" disabled={busy} onClick={() => showStep(step - 1)}>이전</button>}
      <button className="btn primary" type="submit" disabled={busy}>
        {lastStep ? (busy ? '생성 중…' : '계정 만들기') : <>다음<ArrowRight size={16} aria-hidden="true" /></>}
      </button>
    </div>
  </form>;
}
