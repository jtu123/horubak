import { SITE_NAME } from '../site';

export function Brand({ small = false }: { small?: boolean }) {
  return <span className={`brand ${small ? 'small' : ''}`}><span>{SITE_NAME}<span className="brand-period" aria-hidden="true">.</span></span></span>;
}
