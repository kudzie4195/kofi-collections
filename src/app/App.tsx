import { useEffect } from 'react';
import { createHashRouter, Navigate, Outlet, RouterProvider, ScrollRestoration } from 'react-router-dom';
import { SessionProvider } from '@/state/session';
import { ToastProvider } from '@/state/toast';
import { Toasts } from '@/ui';
import { TabBar } from './TabBar';
import { RoleGate } from './RoleGate';
import { AccountScreen } from './AccountScreen';
import { galleryRoutes } from '@/features/gallery/routes';
import { programmeRoutes } from '@/features/programme/routes';
import { studioRoutes } from '@/features/studio/routes';
import { curatorRoutes } from '@/features/curator/routes';
import { adminRoutes } from '@/features/admin/routes';
import { joinRoutes } from '@/features/join/routes';
import { isNative } from '@/native/platform';

function Layout() {
  useEffect(() => {
    if (!isNative()) return;
    import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
      // The app is dark-only (gallery black), so the status bar is always light-on-dark.
      StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined);
      StatusBar.setBackgroundColor({ color: '#0a0a0a' }).catch(() => undefined);
    });
  }, []);
  return (
    <>
      <Outlet />
      <TabBar />
      <Toasts />
      <ScrollRestoration />
    </>
  );
}

/** Shown only while a lazily-loaded desk route (studio / curator / admin) resolves on a cold deep link. */
function RouteFallback() {
  return (
    <div className="boot" role="status" aria-live="polite">
      <span className="boot__mark" aria-hidden="true" />
      Loading Kofi Collections
    </div>
  );
}

// Role desks (/studio, /curator, /admin) and the intake (/join) are route-level `lazy` chunks; the gates stay eager.
// Hash router: works identically on Vercel, file:// previews and inside Capacitor WebViews.
const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      ...programmeRoutes,
      ...galleryRoutes,
      { path: '/account', element: <AccountScreen /> },
      // Artist intake (v5): not role-gated, the screen decides per role. Lazy chunk.
      ...joinRoutes,
      { path: '/studio', element: <RoleGate roles={['artist']} />, children: studioRoutes },
      { path: '/curator', element: <RoleGate roles={['curator']} />, children: curatorRoutes },
      { path: '/admin', element: <RoleGate roles={['admin']} />, children: adminRoutes },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App() {
  return (
    <ToastProvider>
      <SessionProvider>
        <RouterProvider router={router} fallbackElement={<RouteFallback />} />
      </SessionProvider>
    </ToastProvider>
  );
}
