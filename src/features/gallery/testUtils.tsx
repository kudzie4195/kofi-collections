import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { MockDataSource } from '@/data/mock/MockDataSource';
import type { Viewer } from '@/domain/types';
import { SessionProvider } from '@/state/session';
import { ToastProvider } from '@/state/toast';
import { Toasts } from '@/ui';
import { galleryRoutes } from './routes';

export const VISITOR: Viewer = { role: 'public', displayName: 'Visitor' };
export const LENA: Viewer = { role: 'curator', curatorId: 'cur_lena', userId: 'user_lena', curatorVerified: true };
export const OWEN: Viewer = { role: 'curator', curatorId: 'cur_owen', userId: 'user_owen', curatorVerified: false };
export const MARA: Viewer = { role: 'artist', userId: 'user_mara', artistId: 'art_mara', displayName: 'Mara Oyelaran' };
export const QUINCY: Viewer = { role: 'admin', userId: 'user_quincy', displayName: 'Quincy' };

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

/** Render the gallery routes at `path` as `viewer`, with stub screens for the routes we link to. */
export function renderAt(path: string, viewer: Viewer = VISITOR, ds = new MockDataSource({ persist: false })) {
  localStorage.setItem('kofi.session.v1', JSON.stringify(viewer));
  const stub = (name: string) => ({ element: <p>{name} screen</p> });
  const router = createMemoryRouter(
    [
      ...galleryRoutes.map((r) => ({ ...r, element: <>{r.element}<Where /></> })),
      { path: '/account', ...stub('Account') },
      { path: '/curator/verify', ...stub('Verify') },
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
