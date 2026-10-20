import { Link, useLocation } from 'react-router-dom';
import { Icon } from '@/ui';
import { useViewer } from '@/state/session';
import type { ReactNode } from 'react';
import type { Role } from '@/domain/types';
import './nav.css';

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** Which bar the item appears in. */
  where: 'both' | 'mobile' | 'desktop';
  match: (path: string) => boolean;
  /** Desktop only: hide between 900 and 1099px (it stays in the footer). */
  roomy?: boolean;
}

const starts = (prefix: string) => (p: string) => p === prefix || p.startsWith(`${prefix}/`);
const PROGRAMME = ['/whats-on', '/exhibitions', '/calls', '/journal'];

const DISCOVER: NavItem = { to: '/', label: 'Discover', icon: <Icon.Discover />, where: 'mobile', match: (p) => p === '/' };
const WORKS: NavItem = { to: '/works', label: 'Works', icon: <Icon.Gallery />, where: 'both', match: (p) => starts('/works')(p) || starts('/work')(p) || p === '/saved' };
const ARTISTS: NavItem = { to: '/artists', label: 'Artists', icon: <Icon.Artists />, where: 'both', match: starts('/artists') };
const WHATS_ON: NavItem = { to: '/whats-on', label: 'What’s on', icon: <Icon.Calendar />, where: 'mobile', match: (p) => PROGRAMME.some((x) => starts(x)(p)) };
const EXHIBITIONS: NavItem = { to: '/exhibitions', label: 'Exhibitions', icon: <Icon.Building />, where: 'desktop', match: starts('/exhibitions') };
const CALLS: NavItem = { to: '/calls', label: 'Open calls', icon: <Icon.Megaphone />, where: 'desktop', match: starts('/calls') };
const JOURNAL: NavItem = { to: '/journal', label: 'Journal', icon: <Icon.Journal />, where: 'desktop', match: starts('/journal') };
const ABOUT: NavItem = { to: '/about', label: 'About', icon: <Icon.Info />, where: 'desktop', match: starts('/about'), roomy: true };

function desk(role: Role): NavItem | undefined {
  if (role === 'artist') return { to: '/studio', label: 'Studio', icon: <Icon.Studio />, where: 'both', match: starts('/studio') };
  if (role === 'curator') return { to: '/curator', label: 'Shortlists', icon: <Icon.Shortlist />, where: 'both', match: starts('/curator') };
  if (role === 'admin') return { to: '/admin', label: 'Kofi', icon: <Icon.Admin />, where: 'both', match: starts('/admin') };
  return undefined;
}

/**
 * One list drives both bars. Mobile (≤ 5 tabs):
 *   visitor  Discover · Works · Artists · What's on · Sign in
 *   artist   Discover · Works · What's on · Studio · Account
 *   curator  Discover · Works · Artists · Shortlists · Account
 *   admin    Discover · Works · What's on · Kofi · Account
 * Desktop: brand (Discover) · Works · Artists · Exhibitions · Open calls · Journal · About · [desk] · Account.
 */
export function navForRole(role: Role): NavItem[] {
  const account: NavItem = { to: '/account', label: role === 'public' ? 'Sign in' : 'Account', icon: <Icon.Person />, where: 'both', match: starts('/account') };
  const d = desk(role);
  // Artists and admins trade the mobile Artists tab for What's on (the desk takes the fifth slot).
  const artists: NavItem = role === 'artist' || role === 'admin' ? { ...ARTISTS, where: 'desktop' } : ARTISTS;
  const whatsOn: NavItem | undefined = role === 'curator' ? undefined : WHATS_ON;
  return [DISCOVER, WORKS, artists, ...(whatsOn ? [whatsOn] : []), EXHIBITIONS, CALLS, JOURNAL, ABOUT, ...(d ? [d] : []), account];
}

export function mobileTabs(role: Role): NavItem[] {
  return navForRole(role).filter((t) => t.where !== 'desktop');
}

export function desktopTabs(role: Role): NavItem[] {
  return navForRole(role).filter((t) => t.where !== 'mobile');
}

export function TabBar() {
  const viewer = useViewer();
  const { pathname } = useLocation();
  const items = navForRole(viewer.role);
  return (
    <nav className="tabbar" aria-label="Main">
      <div className="tabbar__inner">
        <Link to="/" className="tabbar__brand" aria-label="Kofi Collections, Discover" aria-current={pathname === '/' ? 'page' : undefined}>
          <span className="star" aria-hidden="true" />
          <span className="tabbar__brand-name">
            Kofi
            <small>Collections</small>
          </span>
        </Link>
        {items.map((t) => {
          const active = t.match(pathname);
          const cls = ['tab', t.where === 'mobile' && 'tab--mobile', t.where === 'desktop' && 'tab--desktop', t.roomy && 'tab--roomy'].filter(Boolean).join(' ');
          return (
            <Link key={t.to} to={t.to} className={cls} aria-current={active ? 'page' : undefined}>
              {t.icon}
              <span>{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
