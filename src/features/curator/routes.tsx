import type { RouteObject } from 'react-router-dom';

/**
 * Relative children of `/curator`. The role gate lives in the spine.
 * Each screen is a route-level `lazy` chunk so visitors never download the desk.
 * The partner desk (`calls/…`) gates itself on verification: a pending curator
 * gets an explanation, never an error.
 */
export const curatorRoutes: RouteObject[] = [
  { index: true, lazy: () => import('./CuratorHome').then((m) => ({ Component: m.CuratorHome })) },
  { path: 'shortlists/:id', lazy: () => import('./ShortlistScreen').then((m) => ({ Component: m.ShortlistScreen })) },
  { path: 'verify', lazy: () => import('./VerifyScreen').then((m) => ({ Component: m.VerifyScreen })) },
  { path: 'inquiries', lazy: () => import('./CuratorInquiries').then((m) => ({ Component: m.CuratorInquiries })) },
  { path: 'calls', lazy: () => import('./PartnerCalls').then((m) => ({ Component: m.PartnerCalls })) },
  { path: 'calls/new', lazy: () => import('./PartnerCallEditor').then((m) => ({ Component: m.PartnerCallNew })) },
  { path: 'calls/:id', lazy: () => import('./PartnerCallReview').then((m) => ({ Component: m.PartnerCallReview })) },
  { path: 'calls/:id/edit', lazy: () => import('./PartnerCallEditor').then((m) => ({ Component: m.PartnerCallEdit })) },
  { path: 'calls/:id/applications/:appId', lazy: () => import('./PartnerApplicationDetail').then((m) => ({ Component: m.PartnerApplicationDetail })) },
];
