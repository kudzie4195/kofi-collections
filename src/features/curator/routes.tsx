import type { RouteObject } from 'react-router-dom';

/**
 * Relative children of `/curator`. The role gate lives in the spine.
 * Each screen is a route-level `lazy` chunk so visitors never download the desk.
 */
export const curatorRoutes: RouteObject[] = [
  { index: true, lazy: () => import('./CuratorHome').then((m) => ({ Component: m.CuratorHome })) },
  { path: 'shortlists/:id', lazy: () => import('./ShortlistScreen').then((m) => ({ Component: m.ShortlistScreen })) },
  { path: 'verify', lazy: () => import('./VerifyScreen').then((m) => ({ Component: m.VerifyScreen })) },
  { path: 'inquiries', lazy: () => import('./CuratorInquiries').then((m) => ({ Component: m.CuratorInquiries })) },
];
