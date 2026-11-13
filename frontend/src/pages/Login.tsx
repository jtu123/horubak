// Lucian UX/UI Prompt #062 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#062
// Lucian UX/UI Prompt #216 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#216
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import appleLogo from '../assets/social-login/apple.png?no-inline';
import googleLogo from '../assets/social-login/google.svg?no-inline';
import naverLogo from '../assets/social-login/naver.png?no-inline';
import { Brand } from '../components/Brand';
import { PasswordVisibilityButton } from '../components/lucian/PasswordVisibilityButton';
import { SignupForm } from '../components/lucian/SignupForm';
import { ThemeToggle } from '../components/lucian/ThemeToggle';
import { ApiError, authApi } from '../services/api';
import type { SocialProvider } from '../services/api';
import { SITE_NAME } from '../site';
import { useWorkspace } from '../store';
import { LOGIN_USERNAME_MAX_LENGTH, normalizeUsername } from '../username';
import '../components/lucian/auth-entrance.css';
import '../components/lucian/login-feedback.css';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const SOCIAL_LOGIN_FAILED = '소셜 로그인에 실패했어요. 다시 시도해 주세요.';
const SOCIAL_PROVIDERS = [
  { id: 'naver', name: '네이버', logo: naverLogo },
  { id: 'google', name: '구글', logo: googleLogo },
  { id: 'apple', name: '애플', logo: appleLogo },
] as const;
const SOCIAL_ERRORS = new Map([
  ['cancelled', '소셜 로그인을 취소했어요.'],
  ['expired', '로그인 요청이 만료됐어요. 다시 시도해 주세요.'],
  ['email-required', '첫 소셜 로그인에는 이메일 제공 동의가 필요해요.'],
  ['email-in-use', '이미 등록된 이메일이에요. 처음 가입한 방식으로 로그인해 주세요.'],
  ['blocked', '이 계정은 현재 이용할 수 없어요.'],
  ['failed', SOCIAL_LOGIN_FAILED],
]);

function SocialLogin({ callbackError }: { callbackError: string | null }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const message = error ?? SOCIAL_ERRORS.get(callbackError ?? '');

  async function start(provider: SocialProvider) {
    setPending(true);
    setError('');
    try {
      const { authorizationUrl } = await authApi.startSocialLogin(provider);
      window.location.assign(authorizationUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : SOCIAL_LOGIN_FAILED);
    } finally {
      setPending(false);
    }
  }

  return <>
    <div className="login-divider" aria-hidden="true">또는</div>
    <div className="social-login" role="group" aria-label="소셜 로그인" aria-busy={pending}>
      {SOCIAL_PROVIDERS.map(({ id, name, logo }) => <button
        key={id} type="button" className={'social-login-button social-login-' + id}
        aria-label={name + '로 로그인'} title={name + '로 로그인'}
        disabled={pending} onClick={() => void start(id)}
      ><img src={logo} alt="" width={48} height={48} /></button>)}
    </div>
    {message && <p className="social-login-error" role="alert">{message}</p>}
  </>;
}

type PasswordFormProps = {
  onLogin: (username: string, password: string) => Promise<void>;
  onComplete: () => void;
};

function LoginForm({ onLogin, onComplete }: PasswordFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'pending' | 'success'>('idle');
  const [error, setError] = useState<{ message: string; field?: 'username' | 'password' } | null>(null);
  const alive = useRef(true);
  const completion = useRef<number | undefined>(undefined);
  const usernameInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const busy = phase !== 'idle';
  const status = phase === 'pending' ? '확인하는 중…' : phase === 'success' ? '로그인 완료' : '';

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; window.clearTimeout(completion.current); };
  }, []);
  useEffect(() => {
    const input = error?.field === 'username' ? usernameInput.current : error?.field === 'password' ? passwordInput.current : null;
    input?.focus({ preventScroll: true });
    input?.select();
  }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const normalized = normalizeUsername(username);
    if (!normalized) {
      setError({ message: '아이디를 확인해 주세요.', field: 'username' });
      return;
    }
    const form = event.currentTarget;
    setError(null);
    setPhase('pending');
    try {
      await onLogin(normalized, password);
      if (!alive.current) return;
      if (window.matchMedia(REDUCED_MOTION).matches) {
        onComplete();
        return;
      }
      setPhase('success');
      completion.current = window.setTimeout(onComplete, 650);
    } catch (reason) {
      if (!alive.current) return;
      const code = reason instanceof ApiError ? reason.code : undefined;
      const field = code === 'INVALID_USERNAME' ? 'username' : code === 'INVALID_CREDENTIALS' ? 'password' : undefined;
      setError({ message: reason instanceof Error ? reason.message : '다시 시도해 주세요.', field });
      setPhase('idle');
      if (!window.matchMedia(REDUCED_MOTION).matches) {
        form.classList.remove('shake');
        void form.offsetWidth;
        form.classList.add('shake');
      }
    }
  }

  return <>
    <form className="login-card u062" aria-label="로그인 양식" aria-busy={phase === 'pending'} onSubmit={submit} onAnimationEnd={event => {
      if (event.target === event.currentTarget && event.animationName === 'u062-no') event.currentTarget.classList.remove('shake');
    }}>
      <h1>로그인</h1>
      <label className="field-label" htmlFor="login-username">아이디</label>
      <input ref={usernameInput} className="text-input" id="login-username" name="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={LOGIN_USERNAME_MAX_LENGTH} placeholder="아이디 입력" value={username} disabled={busy} aria-invalid={error?.field === 'username' || undefined}
        aria-describedby={error?.field === 'username' ? 'login-error' : undefined} onChange={e => { setUsername(e.target.value); setError(null); }} />
      <div className="u062-password-label">
        <label className="field-label" htmlFor="login-password">비밀번호</label>
        <span className="u062-caps" role="status">{capsLock ? 'Caps Lock 켜짐' : ''}</span>
      </div>
      <div className="password-field">
        <input ref={passwordInput} className="text-input" id="login-password" name="password" type={visible ? 'text' : 'password'} autoComplete="current-password" required maxLength={128} placeholder="비밀번호 입력" value={password} disabled={busy} aria-invalid={error?.field === 'password' || undefined} aria-describedby={error?.field === 'password' ? 'login-error' : undefined}
          onChange={e => { setPassword(e.target.value); setError(null); }} onKeyUp={e => setCapsLock(e.getModifierState('CapsLock'))} onBlur={() => setCapsLock(false)} />
        <PasswordVisibilityButton inputId="login-password" visible={visible} disabled={busy} onToggle={() => setVisible(v => !v)} />
      </div>
      <div className={'u062-err' + (error ? ' bad' : '')}><span id="login-error" role="alert">{error?.message}</span></div>
      <button className={'btn primary u062-go' + (phase === 'pending' ? ' busy' : phase === 'success' ? ' ok' : '')} disabled={busy} type="submit">
        <span>{status || '로그인'}</span>
        <i aria-hidden="true" />
        <svg viewBox="0 0 26 26" aria-hidden="true"><path d="M6 13.5l4.5 4.5L20 8.5" /></svg>
      </button>
    </form>
    <span className="sr-only" role="status">{status}</span>
  </>;
}
export function Login() {
  const { login, signup, enterDemo, authError, serverAuth } = useWorkspace();
  const navigate = useNavigate(); const [params] = useSearchParams();
  const registering = params.get('mode') === 'signup';
  const formArea = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (window.matchMedia(REDUCED_MOTION).matches) return;
    const initialCard = formArea.current;
    initialCard?.classList.add('u216-enter');
    return () => initialCard?.classList.remove('u216-enter');
  }, []);
  useEffect(() => {
    const heading = formArea.current?.querySelector('h1');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }, [registering]);
  const complete = () => navigate('/projects');
  return <div className="login-page ux">
    <header className="login-header"><Brand /><ThemeToggle /></header>
    <main className="login-body"><section key={registering ? 'signup' : 'login'} ref={formArea} className="login-form-area" aria-label={registering ? '회원가입' : '로그인'}>
      {authError && <p className="field-error" role="status">{authError}</p>}
      {registering
        ? <SignupForm onCreate={signup} onComplete={complete} />
        : <LoginForm onLogin={login} onComplete={complete} />}
      <p className="login-switch">
        {registering ? '이미 계정이 있나요?' : '처음 오셨나요?'} <Link to={registering ? '/login' : '/login?mode=signup'}>{registering ? '로그인' : '회원가입'}</Link>
      </p>
      {serverAuth ? <SocialLogin callbackError={params.get('social')} /> : <>
        <div className="login-divider" aria-hidden="true">또는</div>
        <button type="button" className="demo-enter" onClick={() => { enterDemo(); complete(); }}>샘플로 시작<ArrowRight size={16} /></button>
      </>}
      <p className="login-disclaimer">{serverAuth ? import.meta.env.VITE_AUTH_TEST === 'true'
        ? '테스트 배포입니다. 계정과 편집 정보는 임시 저장소에 저장됩니다.'
        : '계정과 편집 정보는 서버에 저장됩니다.'
        : <>브라우저 데모입니다. 실제 비밀번호는 사용하지 마세요.<br />프로필과 프로젝트는 이 브라우저에만 저장됩니다.</>}</p>
    </section></main>
    <footer className="login-footer">© 2026 {SITE_NAME}</footer>
  </div>;
}
