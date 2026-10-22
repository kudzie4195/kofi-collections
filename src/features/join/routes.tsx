import type { RouteObject } from 'react-router-dom';

/**
 * The artist intake: /join (step one, or the artist's first unfinished step) and
 * /join/:step. Not role-gated: visitors start here; the screen decides per role.
 * A route-level `lazy` chunk so the home screen does not carry the intake.
 */
const load = () => import('./JoinScreen').then((m) => ({ Component: m.JoinRoute }));

export const joinRoutes: RouteObject[] = [
  { path: '/join', lazy: load },
  { path: '/join/:step', lazy: load },
];
