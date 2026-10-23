// Lucian UX/UI Prompt #040 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#040
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronRight, CircleHelp, Clapperboard, FolderOpen, LayoutGrid, LogOut, Menu, Moon, Plus, Search, Star, Sun } from 'lucide-react';
import { useWorkspace } from '../../store';
import { Brand } from '../Brand';
import { SITE_NAME } from '../../site';
import { Modal } from '../Modal';
import { openCommandPalette } from './CommandPalette';

export function WorkspaceShell() {
  const { user, logout, theme, toggleTheme, storageError } = useWorkspace();
  const [wide, setWide] = useState(true); const [mobile, setMobile] = useState(false); const [help, setHelp] = useState(false);
  const location = useLocation(); const navigate = useNavigate(); const nav = useRef<HTMLUListElement>(null);
  const section = new URLSearchParams(location.search).get('view') ?? 'all';
  const items = [{ label: '내 프로젝트', path: '/projects', icon: LayoutGrid, key: 'all' }, { label: '즐겨찾기', path: '/projects?view=favorites', icon: Star, key: 'favorites' }, { label: '결과 보관함', path: '/projects?view=exports', icon: Clapperboard, key: 'exports' }];
  const current = items.findIndex(i => i.key === section);
  useEffect(() => { setMobile(false); }, [location.pathname, location.search]);
  useEffect(() => { if (!mobile) return; const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobile(false); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [mobile]);
  const pageTitle = location.pathname.includes('/new') ? '새 영상 등록' : location.pathname.includes('/processing') ? '처리 현황' : location.pathname.includes('/editor') ? '하이라이트 편집' : location.pathname.includes('/results') ? '결과 확인' : items[Math.max(0, current)].label;
  const helpDialog = help && <Modal title="사용 안내" onClose={() => setHelp(false)}><div className="guide-steps">{['영상 등록', '후보·맥락 확인', '구간·자막·구도 편집'].map((text, i) => <div key={text}><span>{i + 1}</span>{text}</div>)}</div><div className="notice"><Check size={17} /><span>브라우저에만 저장되는 데모입니다. 업로드·AI 분석·영상 출력은 연결 전입니다.</span></div><button className="btn primary full" onClick={() => setHelp(false)}>확인</button></Modal>;
  if (location.pathname === '/projects') return <div className="ux bento-workspace">
    <a className="skip-link" href="#main-content">본문으로 건너뛰기</a>
    <header className="bento-topbar">
      <Link className="bento-home-brand" to="/projects" aria-label={`${SITE_NAME} 홈`}><Brand /></Link>
      <nav className="bento-main-nav" aria-label="주 메뉴">{items.map(({ path, key, label, icon: Icon }) => <Link key={key} to={path} aria-current={section === key ? 'page' : undefined}><Icon size={16} />{label}</Link>)}</nav>
      <div className="bento-topbar-actions"><button className="command-trigger" onClick={openCommandPalette} aria-label="빠른 실행 열기" title="빠른 실행 (Ctrl+Shift+K)"><Search size={17} /><span>빠른 실행</span><kbd>Ctrl ⇧ K</kbd></button><span className="demo-badge"><span /> 데모</span><button className="icon-button" aria-label="사용 가이드" onClick={() => setHelp(true)}><CircleHelp size={19} /></button><button className="icon-button" aria-label={theme === 'light' ? '다크 모드로 전환' : '라이트 모드로 전환'} onClick={toggleTheme}>{theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}</button><button className="bento-profile" onClick={() => { logout(); navigate('/login'); }} aria-label={`${user?.name}님 로그아웃`}><span aria-hidden="true">{user?.name.slice(0, 1)}</span><LogOut size={17} /></button></div>
    </header>
    {storageError && <div className="storage-error" role="alert">브라우저 저장 공간을 사용할 수 없어요. 변경 내용은 이 창에서만 유지됩니다.</div>}
    <main id="main-content" className="bento-main-content"><Outlet /></main>
    <footer className="bento-site-footer"><button onClick={() => setHelp(true)}>브라우저 데모 · 안내</button></footer>
    {helpDialog}
  </div>;
  return <div className={`ux u040 app-shell ${wide ? 'is-wide' : ''} ${mobile ? 'mobile-open' : ''}`}>
    <a href="#main-content" className="skip-link">본문으로 바로 가기</a>
    {mobile && <button className="nav-backdrop" aria-label="모바일 메뉴 닫기" onClick={() => setMobile(false)} />}
    <nav className="u040-rail app-sidebar" aria-label="주 메뉴">
      <div className="u040-top"><Link to="/projects" className="u040-logo sidebar-brand" aria-label={`${SITE_NAME} 홈`}><Brand small /></Link><span className="u040-name">{SITE_NAME}</span></div>
      <button className="u040-tog" aria-expanded={wide} aria-label={wide ? '메뉴 접기' : '메뉴 펼치기'} onClick={() => setWide(v => !v)}><ChevronRight /></button>

      <ul className="u040-nav" ref={nav} onKeyDown={e => { if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return; const buttons = [...e.currentTarget.querySelectorAll<HTMLAnchorElement>('a')]; const index = buttons.indexOf(document.activeElement as HTMLAnchorElement); if (index < 0) return; e.preventDefault(); buttons[(index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus(); }}>
        <li className="u040-hl" role="presentation" style={{ '--y': `${Math.max(0, current) * 52}px` } as CSSProperties} />
        {items.map(({ label, path, icon: Icon, key }, i) => <li key={path}><Link to={path} className="u040-it" aria-current={section === key ? 'page' : undefined} style={{ '--i': i } as CSSProperties}><Icon aria-hidden="true" /><span>{label}</span></Link></li>)}
      </ul>
      <button className="sidebar-new" onClick={() => navigate('/projects/new')} title="새 영상 등록"><Plus size={19} /><span>새 영상 등록</span></button>
      <div className="sidebar-bottom"><button className="sidebar-help" onClick={() => setHelp(true)} title="사용 가이드"><CircleHelp size={18} /><span>사용 가이드</span></button><button className="u040-me" onClick={() => { logout(); navigate('/login'); }} title="로그아웃"><i aria-hidden="true">{user?.name.slice(0, 1)}</i><span>{user?.name}<small>{user?.guest ? '게스트' : '데모'}</small></span><LogOut className="logout-icon" size={15} /></button></div>
    </nav>
    <section className="u040-main app-main"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="메뉴 열기" onClick={() => setMobile(true)}><Menu size={20} /></button><FolderOpen size={16} /><Link to="/projects">프로젝트</Link><ChevronRight size={13} /><span>{pageTitle}</span></div><div className="topbar-actions"><button className="command-trigger" onClick={openCommandPalette} aria-label="빠른 실행 열기" title="빠른 실행 (Ctrl+Shift+K)"><Search size={17} /><span>빠른 실행</span><kbd>Ctrl ⇧ K</kbd></button><span className="demo-badge"><span /> 데모</span><button className="icon-button" aria-label={theme === 'light' ? '다크 모드로 전환' : '라이트 모드로 전환'} onClick={toggleTheme}>{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</button><button className="top-avatar" onClick={() => setHelp(true)} aria-label="사용 안내">{user?.name.slice(0, 1)}</button></div></header>
      {storageError && <div className="storage-error" role="alert">브라우저 저장 공간을 사용할 수 없어요. 변경 내용은 이 창에서만 유지됩니다.</div>}
      <main id="main-content" className="page-content"><Outlet /></main>
      <footer className="app-footer"><span>{SITE_NAME} </span><span><span className="status-dot" /> 브라우저 저장</span></footer>
    </section>
    {helpDialog}
  </div>;
}
