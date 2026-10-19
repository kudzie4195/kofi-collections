import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { MockDataSource } from '@/data/mock/MockDataSource';
import { DEMO_IDENTITIES } from '@/data/mock/seed';
import type { Viewer } from '@/domain/types';
import { SessionProvider } from '@/state/session';
import { ToastProvider } from '@/state/toast';
import { Toasts } from '@/ui';
import { curatorRoutes } from './routes';
import { adminRoutes } from '@/features/admin/routes';

export function identity(id: string): Viewer {
  const found = DEMO_IDENTITIES.find((d) => d.id === id);
  if (!found) throw new Error(`No demo identity ${id}`);
  return found.viewer;
}

/** Render the curator + admin route trees at `path`, signed in as `viewer` via the session's storage key. */
export function renderAt(path: string, viewer: Viewer, ds: MockDataSource = new MockDataSource({ persist: false })) {
  localStorage.setItem('kofi.session.v1', JSON.stringify(viewer));
  const router = createMemoryRouter(
    [
      { path: '/curator', children: curatorRoutes },
      { path: '/admin', children: adminRoutes },
      { path: '*', element: <div>Elsewhere</div> },
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
