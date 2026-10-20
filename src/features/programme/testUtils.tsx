import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { MockDataSource } from '@/data/mock/MockDataSource';
import type { Viewer } from '@/domain/types';
import { SessionProvider } from '@/state/session';
import { ToastProvider } from '@/state/toast';
import { Toasts } from '@/ui';
import { galleryRoutes } from '@/features/gallery/routes';
import { programmeRoutes } from './routes';

export const VISITOR: Viewer = { role: 'public', displayName: 'Visitor' };
export const MARA: Viewer = { role: 'artist', userId: 'user_mara', artistId: 'art_mara', displayName: 'Mara Oyelaran' };
export const DESHAWN: Viewer = { role: 'artist', userId: 'user_deshawn', artistId: 'art_deshawn', displayName: 'DeShawn Ferris' };
export const LENA: Viewer = { role: 'curator', curatorId: 'cur_lena', userId: 'user_lena', curatorVerified: true, displayName: 'Lena Marchetti' };
export const QUINCY: Viewer = { role: 'admin', userId: 'user_quincy', displayName: 'Quincy' };

/** The calendar day the seeded programme is written against. */
export const SEED_NOW = new Date('2026-10-20T16:00:00Z');

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

/** Render the public routes (programme + gallery) at `path` as `viewer`. */
export function renderAt(path: string, viewer: Viewer = VISITOR, ds = new MockDataSource({ persist: false, now: () => SEED_NOW })) {
  localStorage.setItem('kofi.session.v1', JSON.stringify(viewer));
  const stub = (name: string) => ({ element: <p>{name} screen</p> });
  const router = createMemoryRouter(
    [
      ...[...programmeRoutes, ...galleryRoutes].map((r) => ({ ...r, element: <>{r.element}<Where /></> })),
      { path: '/account', ...stub('Account') },
      { path: '/curator/*', ...stub('Curator') },
      { path: '/studio/*', ...stub('Studio') },
      { path: '/admin/*', ...stub('Admin') },
    ],
    { initialEntries: [path] },
  );
  const utils = render(
    <ToastProvider>
      <SessionProvider dataSource={ds}>
        <RouterProvider router={router} />
        <Toasts />
      </SessionProvider>
    </ToastProvider>,
  );
  return { ...utils, ds, router };
}
