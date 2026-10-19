import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { Role } from '@/domain/types';
import { useViewer } from '@/state/session';

/** Renders child routes only for the given roles; otherwise sends the viewer to sign in. */
export function RoleGate({ roles }: { roles: Role[] }) {
  const viewer = useViewer();
  const loc = useLocation();
  if (!roles.includes(viewer.role)) {
    return <Navigate to="/account" replace state={{ from: loc.pathname, needs: roles }} />;
  }
  return <Outlet />;
}
