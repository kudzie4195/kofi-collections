import type { RouteObject } from 'react-router-dom';

/**
 * Relative children of `/admin`. The role gate lives in the spine.
 * Each screen is a route-level `lazy` chunk so visitors never download the desk.
 */
export const adminRoutes: RouteObject[] = [
  { index: true, lazy: () => import('./AdminHome').then((m) => ({ Component: m.AdminHome })) },
  { path: 'artists', lazy: () => import('./AdminArtists').then((m) => ({ Component: m.AdminArtists })) },
  { path: 'artists/:id', lazy: () => import('./AdminArtistDetail').then((m) => ({ Component: m.AdminArtistDetail })) },
  { path: 'curators', lazy: () => import('./AdminCurators').then((m) => ({ Component: m.AdminCurators })) },
  { path: 'inquiries', lazy: () => import('./AdminInquiries').then((m) => ({ Component: m.AdminInquiries })) },
  { path: 'activity', lazy: () => import('./AdminActivity').then((m) => ({ Component: m.AdminActivity })) },
  { path: 'programme', lazy: () => import('./AdminProgramme').then((m) => ({ Component: m.AdminProgramme })) },
  { path: 'programme/:kind/:id', lazy: () => import('./ProgrammeEditor').then((m) => ({ Component: m.ProgrammeEditorRoute })) },
  { path: 'applications', lazy: () => import('./AdminApplications').then((m) => ({ Component: m.AdminApplications })) },
  { path: 'applications/:id', lazy: () => import('./AdminApplicationDetail').then((m) => ({ Component: m.AdminApplicationDetail })) },
  { path: 'collectors', lazy: () => import('./AdminCollectors').then((m) => ({ Component: m.AdminCollectors })) },
  { path: 'lots', lazy: () => import('./AdminLots').then((m) => ({ Component: m.AdminLots })) },
  { path: 'payouts', lazy: () => import('./AdminPayouts').then((m) => ({ Component: m.AdminPayouts })) },
  { path: 'reports', lazy: () => import('./AdminReports').then((m) => ({ Component: m.AdminReports })) },
];
