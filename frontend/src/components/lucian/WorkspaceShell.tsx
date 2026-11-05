// Adapted from Lucian UX/UI #040 · MIT (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#040
import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, BarChart3, ChevronDown, ChevronRight, CircleHelp, FolderOpen, Info, Library, ListVideo, LogOut, Moon, Search, Send, Settings2, Sun, Users, X } from 'lucide-react';
import { useWorkspace } from '../../store';
import { Brand } from '../Brand';
import { Modal } from '../Modal';
import { openCommandPalette } from './CommandPalette';
import '../../styles/workspace-v3.css';

const PRIMARY = [
  { label: '프로젝트', path: '/projects', Icon: FolderOpen },
  { label: '라이브러리', path: '/library', Icon: Library },
  { label: '작업센터', path: '/jobs', Icon: ListVideo },
];
const MORE = [
  { label: '게시·예약', path: '/publishing', Icon: Send },
  { label: '팀·검토', path: '/team', Icon: Users },
  { label: '성과', path: '/analytics', Icon: BarChart3 },
];

export function WorkspaceShell() {
  const { user, logout, theme, toggleTheme, storageError, storageNotice } = useWorkspace();
  const [dismissedNotice, setDismissedNotice] = useState('');
  const [help, setHelp] = useState(false);
  const [account, setAccount] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [more, setMore] = useState(MORE.some(item => location.pathname.startsWith(item.path)));
  const accountRoot = useRef<HTMLDivElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const activeItem = [...PRIMARY, ...MORE, { label: '설정', path: '/settings' }].find(item => location.pathname.startsWith(item.path));
  const pageTitle = location.pathname.endsWith('/new') ? '새 영상' : location.pathname.includes('/processing') ? '처리 현황' : location.pathname.includes('/editor') ? '클립 편집' : location.pathname.includes('/results') ? '편집 결과' : activeItem?.label ?? '프로젝트';

  useEffect(() => { setAccount(false); if (MORE.some(item => location.pathname.startsWith(item.path))) setMore(true); }, [location.pathname, location.search]);
  useEffect(() => {
    if (!account) return;
    accountRoot.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const pointer = (event: PointerEvent) => { if (!accountRoot.current?.contains(event.target as Node)) setAccount(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setAccount(false); accountButton.current?.focus(); } };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', key); };
  }, [account]);

  return <div className="ux app-shell workspace-v3">
    <a className="skip-link" href="#main-content">본문으로 건너뛰기</a>
    <aside className="app-sidebar">
      <Link className="sidebar-brand" to="/projects" aria-label="호루박 홈"><Brand /></Link>
      <div className="workspace-name"><span className="workspace-monogram" aria-hidden="true">{user?.name.slice(0, 1)}</span><span><b>개인 작업공간</b><small>{user?.guest ? '샘플 게스트' : user?.name}</small></span></div>
      <nav className="sidebar-nav" aria-label="주 메뉴">
        {PRIMARY.map(({ label, path, Icon }) => <Link key={path} to={path} aria-current={location.pathname.startsWith(path) ? 'page' : undefined}><Icon size={18} /><span>{label}</span></Link>)}
        <button className="sidebar-more" onClick={() => setMore(value => !value)} aria-expanded={more} aria-controls="workspace-more"><span>더보기</span><ChevronDown size={14} className={more ? 'expanded' : ''} /></button>
        {more && <div className="sidebar-extra" id="workspace-more">{MORE.map(({ label, path, Icon }) => <Link key={path} to={path} aria-current={location.pathname.startsWith(path) ? 'page' : undefined}><Icon size={18} /><span>{label}</span></Link>)}</div>}
      </nav>
      <div className="sidebar-bottom">
        <div className="workspace-demo-state"><span /><div><b>브라우저 데모</b><small>작업은 이 브라우저에 저장돼요</small></div></div>
        <Link className="sidebar-help" to="/settings" aria-current={location.pathname === '/settings' ? 'page' : undefined}><Settings2 size={17} />설정</Link>
        <button className="sidebar-help" onClick={() => setHelp(true)}><CircleHelp size={17} />사용 안내<ArrowUpRight size={13} /></button>
      </div>
    </aside>
    <div className="app-main">
      <header className="topbar">
        <div className="breadcrumb"><span className="workspace-breadcrumb">작업공간</span><ChevronRight size={12} /><span>{pageTitle}</span></div>
        <div className="topbar-actions">
          <button className="command-trigger" onClick={openCommandPalette} title="빠른 실행 (Ctrl+Shift+K)" aria-label="빠른 실행 열기"><Search size={15} /><span>빠른 실행</span><kbd>Ctrl ⇧ K</kbd></button>
          <button className="icon-button theme-trigger" aria-label={theme === 'light' ? '다크 모드로 전환' : '라이트 모드로 전환'} onClick={toggleTheme}>{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</button>
          <div className="account-wrap" ref={accountRoot}>
            <button ref={accountButton} className="account-trigger" aria-label="계정 메뉴" aria-haspopup="menu" aria-expanded={account} onClick={() => setAccount(value => !value)}><span className="account-avatar" aria-hidden="true">{user?.name.slice(0, 1)}</span><ChevronDown size={13} /></button>
            {account && <div className="account-menu" role="menu" aria-label="계정" onKeyDown={event => {
              const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
              const index = controls.indexOf(document.activeElement as HTMLButtonElement);
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); controls[(index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length]?.focus(); }
              if (event.key === 'Tab') setAccount(false);
            }}><div className="account-info"><b>{user?.name}</b><small>{user?.guest ? '샘플 게스트' : user?.email}</small></div><button role="menuitem" onClick={() => { accountButton.current?.focus(); setAccount(false); navigate('/settings'); }}><Settings2 size={16} />설정</button><button role="menuitem" onClick={() => { accountButton.current?.focus(); setAccount(false); setHelp(true); }}><CircleHelp size={16} />사용 안내</button><button role="menuitem" onClick={() => { logout(); navigate('/login'); }}><LogOut size={16} />로그아웃</button></div>}
          </div>
        </div>
      </header>
      {storageError && <div className="storage-error" role="alert">브라우저 저장 공간을 사용할 수 없어요. 변경 내용은 이 창에서만 유지됩니다.</div>}
      {storageNotice && storageNotice !== dismissedNotice && <div className="storage-recovery-note" role="status"><Info size={15} /><span>{storageNotice}</span><button className="icon-button" aria-label="저장 안내 닫기" onClick={() => setDismissedNotice(storageNotice)}><X size={15} /></button></div>}
      <main id="main-content" className="page-content" tabIndex={-1}><Outlet /></main>
    </div>
    {help && <Modal title="원본에서 클립까지" onClose={() => setHelp(false)}><div className="guide-steps">{['분야 제한 없이 영상 등록', '영상·소리·발화 근거로 후보 확인', '여러 클립으로 저장하고 각각 편집'].map((text, index) => <div key={text}><span>{index + 1}</span>{text}</div>)}</div><div className="notice"><CircleHelp size={16} /><span>샘플과 로컬 원본으로 편집 흐름을 확인하는 데모입니다. 실제 인증·AI 분석·서버 저장·영상 출력은 연결 전입니다.</span></div><button className="btn primary full" style={{ marginTop: 20 }} onClick={() => setHelp(false)}>확인</button></Modal>}
  </div>;
}
