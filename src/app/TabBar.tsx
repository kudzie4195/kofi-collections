import { Link, useLocation } from 'react-router-dom';
import { Icon } from '@/ui';
import { useViewer } from '@/state/session';
import type { ReactNode } from 'react';

interface Tab {
  to: string;
  label: string;
  icon: ReactNode;
  match?: (path: string) => boolean;
}

export function tabsForRole(role: string): Tab[] {
  const base: Tab[] = [
    { to: '/', label: 'Gallery', icon: <Icon.Gallery />, match: (p) => p === '/' || p.startsWith('/work') },
    { to: '/artists', label: 'Artists', icon: <Icon.Artists />, match: (p) => p.startsWith('/artists') },
  ];
  if (role === 'artist') base.push({ to: '/studio', label: 'Studio', icon: <Icon.Studio />, match: (p) => p.startsWith('/studio') });
  if (role === 'curator') {
    base.push({ to: '/curator', label: 'Shortlists', icon: <Icon.Shortlist />, match: (p) => p.startsWith('/curator') && !p.startsWith('/curator/inquiries') });
    base.push({ to: '/curator/inquiries', label: 'Requests', icon: <Icon.Inbox />, match: (p) => p.startsWith('/curator/inquiries') });
  }
  if (role === 'admin') base.push({ to: '/admin', label: 'Kofi', icon: <Icon.Admin />, match: (p) => p.startsWith('/admin') });
  base.push({ to: '/account', label: role === 'public' ? 'Sign in' : 'Account', icon: <Icon.Person />, match: (p) => p.startsWith('/account') });
  return base;
}

export function TabBar() {
  const viewer = useViewer();
  const { pathname } = useLocation();
  const tabs = tabsForRole(viewer.role);
  return (
    <nav className="tabbar" aria-label="Main">
      <div className="tabbar__inner">
        <Link to="/" className="tabbar__brand" aria-label="Kofi Collections home">
          <span className="star" aria-hidden="true" />
          <span className="tabbar__brand-name">
            Kofi
            <small>Collections</small>
          </span>
        </Link>
        {tabs.map((t) => {
          const active = t.match ? t.match(pathname) : pathname === t.to;
          return (
            <Link key={t.to} to={t.to} className="tab" aria-current={active ? 'page' : undefined}>
              {t.icon}
              <span>{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
