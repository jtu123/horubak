// Adapted from Lucian #062 · MIT (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#062
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, Moon, Sun } from 'lucide-react';
import { Brand } from '../components/Brand';
import { SignupForm } from '../components/lucian/SignupForm';
import { SITE_NAME } from '../site';
import { useWorkspace } from '../store';

function LoginForm({ onLogin, onComplete }: { onLogin: (email: string, password: string) => Promise<void>; onComplete: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const passwordInput = useRef<HTMLInputElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (error) passwordInput.current?.focus(); }, [error]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setError(''); setBusy(true);
    try { await onLogin(email, password); if (alive.current) onComplete(); }
    catch (reason) {
      if (!alive.current) return;
      setError(reason instanceof Error ? reason.message : '브라우저 저장 공간을 확인해 주세요.');
    } finally { if (alive.current) setBusy(false); }
  }
  return <form className="login-card" aria-label="로그인 양식" aria-busy={busy} onSubmit={submit}>
    <h1>로그인</h1>
    <label className="field-label" htmlFor="login-email">이메일</label>
    <input className="text-input" id="login-email" type="email" autoComplete="username" required maxLength={254} placeholder="name@example.com" value={email} disabled={busy} onChange={e => { setEmail(e.target.value); setError(''); }} />
    <label className="field-label" htmlFor="login-password">비밀번호</label>
    <div className="password-field">
      <input ref={passwordInput} className="text-input" id="login-password" type={visible ? 'text' : 'password'} autoComplete="current-password" required maxLength={64} placeholder="비밀번호 입력" value={password} disabled={busy} aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} onChange={e => { setPassword(e.target.value); setError(''); }} />
      <button className="icon-button" type="button" aria-pressed={visible} aria-label={visible ? '비밀번호 숨기기' : '비밀번호 보기'} onClick={() => setVisible(v => !v)}>{visible ? <Eye size={18} /> : <EyeOff size={18} />}</button>
    </div>
    {error && <p className="field-error" id="login-error" role="alert">{error}</p>}
    <button className="btn primary full" disabled={busy} type="submit">{busy ? '확인 중…' : '로그인'}</button>
  </form>;
}
export function Login() {
  const { login, signup, enterDemo, theme, toggleTheme } = useWorkspace();
  const navigate = useNavigate(); const [params] = useSearchParams();
  const registering = params.get('mode') === 'signup';
  useEffect(() => {
    const heading = document.querySelector<HTMLElement>('h1');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }, [registering]);
  const complete = () => navigate('/projects');
  return <div className="login-page ux">
    <header className="login-header"><Brand /><button className="icon-button" aria-label={theme === 'light' ? '다크 모드로 전환' : '라이트 모드로 전환'} onClick={toggleTheme}>{theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}</button></header>
    <main className="login-body"><section className="login-form-area" aria-label={registering ? '회원가입' : '로그인'}>
      {registering ? <SignupForm onCreate={signup} onComplete={complete} /> : <LoginForm onLogin={login} onComplete={complete} />}
      <p className="login-switch">{registering ? '이미 프로필이 있나요?' : '처음 오셨나요?'} <Link to={registering ? '/login' : '/login?mode=signup'}>{registering ? '로그인' : '회원가입'}</Link></p>
      <div className="login-divider">또는</div>
      <button className="demo-enter" onClick={() => { enterDemo(); complete(); }}>샘플로 시작 <ArrowRight size={16} /></button>
      <p className="login-disclaimer">브라우저 데모입니다. 실제 비밀번호는 사용하지 마세요.<br />프로필과 프로젝트는 이 브라우저에만 저장됩니다.</p>
    </section></main>
    <footer className="login-footer">© 2026 {SITE_NAME}</footer>
  </div>;
}
