// Lucian UX/UI Prompt #244 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#244
import { useEffect, useId, useRef, useState } from 'react';
import './signup-form.css';

type Field = 'name' | 'email' | 'password' | 'acknowledged';
interface Values { name: string; email: string; password: string; acknowledged: boolean }
interface Props {
  onCreate: (name: string, email: string, password: string) => Promise<void>;
  onComplete: () => void;
}
const FIELDS = [
  { key: 'name', label: '이름', type: 'text', autoComplete: 'nickname', maxLength: 24, placeholder: '이름 입력' },
  { key: 'email', label: '이메일', type: 'email', autoComplete: 'username', maxLength: 254, placeholder: 'name@example.com' },
  { key: 'password', label: '비밀번호', type: 'password', autoComplete: 'new-password', maxLength: 64, placeholder: '8자 이상' },
] as const;
const LABELS: Record<Field, string> = { name: '이름', email: '이메일', password: '비밀번호', acknowledged: '데모 저장 방식 확인' };

function validate(values: Values): Partial<Record<Field, string>> {
  return {
    ...(!values.name.trim() && { name: '이름을 입력해 주세요.' }),
    ...(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email.trim()) && { email: '이메일 형식을 확인해 주세요. 예: name@example.com' }),
    ...(values.password.length < 8 && { password: '비밀번호는 8자 이상 입력해 주세요.' }),
    ...(!values.acknowledged && { acknowledged: '데모 프로필이 이 브라우저에만 저장됨을 확인해 주세요.' }),
  };
}

export function SignupForm({ onCreate, onComplete }: Props) {
  const uid = useId();
  const scroller = useRef<HTMLFormElement>(null);
  const controls = useRef<Partial<Record<Field, HTMLInputElement | HTMLButtonElement>>>({});
  const focusTimer = useRef<number | undefined>(undefined);
  const completeTimer = useRef<number | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const alive = useRef(true);
  const complete = useRef(onComplete);
  complete.current = onComplete;
  const [values, setValues] = useState<Values>({ name: '', email: '', password: '', acknowledged: false });
  const [tried, setTried] = useState(false);
  const [listed, setListed] = useState<Field[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [serverError, setServerError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const errors = validate(values);
  const wrong = Object.keys(errors) as Field[];
  const hasErrors = tried && (wrong.length > 0 || !!serverError);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      window.clearTimeout(focusTimer.current);
      window.clearTimeout(completeTimer.current);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
  }, []);

  function goTo(field: Field) {
    const input = controls.current[field];
    const sc = scroller.current;
    if (!input || !sc) return;
    window.clearTimeout(focusTimer.current);
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    const row = input.closest<HTMLElement>('.u244-fd') ?? input;
    const y = Math.max(0, row.offsetTop - 70);
    const y0 = sc.scrollTop;
    const start = performance.now();
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 520;
    function animate(now: number) {
      if (!alive.current) return;
      const k = duration ? Math.min(1, (now - start) / duration) : 1;
      sc!.scrollTop = y0 + (y - y0) * (1 - Math.pow(1 - k, 3));
      if (k < 1) frame.current = requestAnimationFrame(animate);
      else { frame.current = undefined; input!.focus({ preventScroll: true }); }
    }
    animate(start);
  }

  useEffect(() => {
    if (!attempt) return;
    const invalid = scroller.current?.querySelectorAll<HTMLElement>('.is-bad') ?? [];
    invalid.forEach(row => { row.classList.remove('is-shake'); void row.offsetWidth; row.classList.add('is-shake'); });
    const first = scroller.current?.querySelector<HTMLInputElement | HTMLButtonElement>('[aria-invalid="true"]');
    if (!first) return;
    const field = first.dataset.field as Field;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    focusTimer.current = window.setTimeout(() => goTo(field), reduced ? 0 : 200);
    return () => { window.clearTimeout(focusTimer.current); if (frame.current !== undefined) cancelAnimationFrame(frame.current); };
  }, [attempt]);

  function change<K extends Field>(field: K, value: Values[K]) {
    const next = { ...values, [field]: value };
    setValues(next);
    setServerError('');
    if (tried) {
      const nextWrong = Object.keys(validate(next)) as Field[];
      setListed(old => [...new Set([...old, ...nextWrong])]);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || done) return;
    setTried(true);
    setServerError('');
    if (wrong.length) {
      setListed(wrong);
      setAttempt(n => n + 1);
      return;
    }
    setBusy(true);
    try {
      await onCreate(values.name.trim(), values.email.trim(), values.password);
      if (!alive.current) return;
      setDone(true);
      completeTimer.current = window.setTimeout(() => complete.current(), 700);
    } catch (reason) {
      if (!alive.current) return;
      setServerError(reason instanceof Error ? reason.message : '프로필을 만들지 못했어요. 다시 시도해 주세요.');
      scroller.current?.scrollTo({ top: 0, behavior: 'instant' });
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return <div className={`ux u244 ${hasErrors ? 'is-err' : ''}`}>
    <form ref={scroller} className="u244-sc" noValidate aria-label="데모 회원가입 폼" aria-busy={busy} onSubmit={submit}>
      <h3>회원가입</h3>
      <p>브라우저 데모 프로필을 만듭니다.</p>
      <div className="u244-sm" role="alert" aria-hidden={!hasErrors}><div><div className="u244-sb">
        <b><i aria-hidden="true">!</i><span className="u244-ct">{tried && wrong.length ? `${wrong.length}개 항목을 확인해 주세요` : serverError ? '프로필을 만들지 못했어요' : ''}</span></b>
        <ul>{listed.map(field => <li key={field} className={!errors[field] ? 'is-fixed' : ''}>
          <a href={`#${uid}-${field}`} onClick={event => { event.preventDefault(); goTo(field); }}>{LABELS[field]}</a>
        </li>)}</ul>
        {serverError && <p className="u244-server-error">{serverError}</p>}
      </div></div></div>
      <div className="u244-fs">{FIELDS.map(field => {
        const invalid = tried && !!errors[field.key];
        const good = tried && !errors[field.key] && values[field.key].length > 0;
        const messageId = `${uid}-message-${field.key}`;
        return <div key={field.key} className={`u244-fd ${invalid ? 'is-bad' : good ? 'is-good' : ''}`} onAnimationEnd={event => event.currentTarget.classList.remove('is-shake')}>
          <label htmlFor={`${uid}-${field.key}`}>{field.label}</label>
          <div className="u244-bx"><input ref={element => { if (element) controls.current[field.key] = element; else delete controls.current[field.key]; }} id={`${uid}-${field.key}`} data-field={field.key} className="u244-in" type={field.type} autoComplete={field.autoComplete} required maxLength={field.maxLength} minLength={field.key === 'password' ? 8 : undefined} placeholder={field.placeholder} value={values[field.key]} disabled={busy || done} aria-invalid={invalid || undefined} aria-describedby={invalid ? messageId : undefined} onChange={event => change(field.key, event.target.value)} /><span className="u244-ok" aria-hidden="true" /></div>
          <div className="u244-ms"><div><span id={messageId}>{errors[field.key]}</span></div></div>
        </div>;
      })}</div>
      <button ref={element => { if (element) controls.current.acknowledged = element; else delete controls.current.acknowledged; }} id={`${uid}-acknowledged`} data-field="acknowledged" type="button" className={`u244-ag ${tried && errors.acknowledged ? 'is-bad' : ''}`} role="checkbox" aria-checked={values.acknowledged} aria-invalid={tried && !!errors.acknowledged || undefined} aria-describedby={tried && errors.acknowledged ? `${uid}-message-acknowledged` : undefined} disabled={busy || done} onClick={() => change('acknowledged', !values.acknowledged)} onAnimationEnd={event => event.currentTarget.classList.remove('is-shake')}><i aria-hidden="true" />이 브라우저에만 저장됨을 확인했어요</button>
      {tried && errors.acknowledged && <span className="u244-ack-error" id={`${uid}-message-acknowledged`}>{errors.acknowledged}</span>}
      <button type="submit" className={`u244-go ${done ? 'is-done' : ''}`} disabled={busy || done}>{done ? '프로필 생성 완료' : busy ? '생성 중…' : '프로필 만들기'}</button>
    </form>
  </div>;
}
