import { useLocation, useNavigate } from 'react-router-dom';
import { Avatar, Button, Notice, TopBar, Icon, FictionalFooter } from '@/ui';
import { useSession } from '@/state/session';
import { useToast } from '@/state/toast';
import type { DemoIdentity, Role } from '@/domain/types';

const ROLE_COLOR: Record<Role, string> = { public: '#6b6684', artist: '#2436F5', curator: '#FF5C39', admin: '#16122B' };

function homeFor(role: Role): string {
  return role === 'artist' ? '/studio' : role === 'curator' ? '/curator' : role === 'admin' ? '/admin' : '/';
}

/**
 * Demo sign-in. In mock mode you pick an identity; the data layer re-checks
 * every claim (a curator's verified flag comes from the record, not the client).
 * In Supabase mode this screen is replaced by real auth.
 */
export function AccountScreen() {
  const { viewer, identities, signInAs, signOut, data } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const state = loc.state as { from?: string; needs?: Role[] } | null;

  const choose = (id: DemoIdentity) => {
    signInAs(id);
    toast.push(`Signed in as ${id.label}`, 'success');
    const target = state?.from && state.needs?.includes(id.viewer.role) ? state.from : homeFor(id.viewer.role);
    nav(target, { replace: true });
  };

  return (
    <div className="screen">
      <TopBar title="Account" />
      <main className="container stack--lg" style={{ paddingTop: 20 }}>
        {state?.needs && (
          <Notice tone="cobalt" icon={<Icon.Lock />}>
            That screen is for {state.needs.join(' / ')} accounts. Pick a matching identity to continue.
          </Notice>
        )}

        <section className="stack">
          <h2 className="h2">Signed in as</h2>
          <div className="identity" aria-current="true">
            <Avatar name={viewer.displayName ?? 'Visitor'} color={ROLE_COLOR[viewer.role]} />
            <div style={{ flex: 1 }}>
              <div className="identity__label">{viewer.displayName ?? 'Visitor'}</div>
              <div className="identity__caption">{viewer.role === 'public' ? 'Browsing publicly' : `${viewer.role}${viewer.curatorVerified ? ' · verified' : ''}`}</div>
            </div>
            {viewer.role !== 'public' && (
              <Button tone="secondary" size="sm" onClick={() => { signOut(); nav('/'); }}>
                Sign out
              </Button>
            )}
          </div>
        </section>

        <section className="stack">
          <h2 className="h2">Switch identity</h2>
          <p className="muted small">Demo mode. Each identity sees only what its role is allowed to see — try the same artwork as a visitor, then as a verified curator.</p>
          <div className="stack--sm">
            {identities.map((id) => (
              <button key={id.id} type="button" className="identity" onClick={() => choose(id)} aria-current={viewer.userId === id.viewer.userId && viewer.role === id.viewer.role ? 'true' : undefined}>
                <Avatar name={id.label} color={ROLE_COLOR[id.viewer.role]} />
                <div style={{ flex: 1 }}>
                  <div className="identity__label">{id.label}</div>
                  <div className="identity__caption">{id.caption}</div>
                </div>
                <Icon.Back style={{ transform: 'rotate(180deg)', opacity: 0.5 }} />
              </button>
            ))}
          </div>
        </section>

        <section className="stack">
          <h2 className="h2">Demo data</h2>
          <p className="muted small">Running in {data.mode} mode. Resetting restores the original fictional sample content.</p>
          <Button
            tone="secondary"
            onClick={async () => {
              await data.resetDemoData();
              toast.push('Demo data reset', 'success');
            }}
          >
            Reset demo data
          </Button>
        </section>
        <FictionalFooter />
      </main>
    </div>
  );
}
