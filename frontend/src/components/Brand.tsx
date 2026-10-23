import { SITE_NAME } from '../site';

export function Brand({ small = false }: { small?: boolean }) {
  return <span className={`brand ${small ? 'small' : ''}`}><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M15 14v20M33 14v20M15 24h18" /></svg></span><span>{SITE_NAME}</span></span>;
}
