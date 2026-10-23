// Lucian UX/UI Prompt #062 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#062
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, Eye, EyeOff, Moon, Sun } from 'lucide-react';
import { Brand } from '../components/Brand';
import { SignupForm } from '../components/lucian/SignupForm';
import { SITE_NAME } from '../site';
import { useWorkspace } from '../store';

export function Login() {
  const { login, signup, enterDemo, theme, toggleTheme } = useWorkspace(); const navigate = useNavigate();
  const [params] = useSearchParams(); const registering = params.get('mode') === 'signup';
  const [email, setEmail] = useState('demo@moment.studio'); const [password, setPassword] = useState(''); const [name, setName] = useState('');
  const [visible, setVisible] = useState(false); const [error, setError] = useState(''); const [status, setStatus] = useState<'idle' | 'busy' | 'ok'>('idle');
  const timer = useRef<number | undefined>(undefined); const mounted = useRef(true); const passwordInput = useRef<HTMLInputElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; window.clearTimeout(timer.current); }; }, []);
  useEffect(() => { setError(''); setStatus('idle'); }, [registering]);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (status !== 'idle') return;
    setError(''); setStatus('busy');
    try {
      if (registering) { if (password.length < 8) throw new Error('비밀번호는 8자 이상 입력해 주세요.'); await signup(name, email, password); }
      else await login(email, password);
      if (!mounted.current) return; setStatus('ok'); timer.current = window.setTimeout(() => navigate('/projects'), 700);
    } catch (reason) { if (!mounted.current) return; setStatus('idle'); setError(reason instanceof Error ? reason.message : '브라우저 저장 공간을 확인해 주세요.'); passwordInput.current?.focus(); }
  }
  return <div className="login-page ux"><header className="login-header"><Brand /><button className="icon-button" aria-label="테마 전환" onClick={toggleTheme}>{theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}</button></header><div className="login-body">
    <section className="login-form-area" aria-label={registering ? '회원가입' : '로그인'}>{registering ? <SignupForm onCreate={signup} onComplete={() => navigate('/projects')} /> : <div className={`ux u062 ${error ? 'shake' : ''}`} key={registering ? 'signup' : 'login'}><form className="u062-pane u062-login" onSubmit={submit}><span className="u062-logo"><Brand small /></span><h3>로그인</h3>{registering && <div className="u062-f"><label htmlFor="signup-name">이름</label><div className="u062-box"><input id="signup-name" required maxLength={24} value={name} onChange={e => setName(e.target.value)} placeholder="어떻게 불러 드릴까요?" autoComplete="nickname" /></div></div>}<div className="u062-f"><label htmlFor="login-email">이메일</label><div className="u062-box"><input id="login-email" type="email" required value={email} onChange={e => { setEmail(e.target.value); setError(''); }} autoComplete="username" /></div></div><div className={`u062-f u062-pw ${error ? 'bad' : ''}`}><label htmlFor="login-password">비밀번호</label><div className="u062-box"><input ref={passwordInput} id="login-password" type={visible ? 'text' : 'password'} required minLength={registering ? 8 : 1} maxLength={64} placeholder={registering ? '8자 이상 입력해 주세요' : '비밀번호를 입력해 주세요'} autoComplete={registering ? 'new-password' : 'current-password'} value={password} onChange={e => { setPassword(e.target.value); setError(''); }} aria-invalid={!!error} aria-describedby="login-error" /><button className="u062-eye" type="button" aria-pressed={visible} aria-label={visible ? '비밀번호 숨기기' : '비밀번호 보기'} onClick={() => setVisible(v => !v)}>{visible ? <Eye /> : <EyeOff />}</button></div><div className="u062-err"><span id="login-error" role="alert">{error}</span></div></div><button className={`u062-go ${status === 'busy' ? 'busy' : status === 'ok' ? 'ok' : ''}`} type="submit" disabled={status !== 'idle'} aria-label={status === 'busy' ? '확인 중' : status === 'ok' ? '완료' : undefined}><span>{registering ? '데모 프로필 만들기' : '로그인'}</span><i aria-hidden="true" /><Check aria-hidden="true" /></button></form></div>}<p className="login-switch">{registering ? '이미 프로필이 있나요?' : '처음 오셨나요?'} <Link to={registering ? '/login' : '/login?mode=signup'}>{registering ? '로그인' : '회원가입'}</Link></p><div className="login-divider"><span>또는</span></div><button className="demo-enter" onClick={() => { enterDemo(); navigate('/projects'); }}>샘플로 시작 <ArrowRight size={17} /></button><p className="login-disclaimer">브라우저 데모입니다. 실제 비밀번호는 사용하지 마세요.<br />프로필과 프로젝트는 이 브라우저에만 저장됩니다.</p></section></div><footer className="login-footer"><span>© 2026 {SITE_NAME}</span></footer></div>;
}
