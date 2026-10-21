import type { RouteObject } from 'react-router-dom';
import './studio.css';
import './opportunities.css';
import './sales.css';

/**
 * Relative children of /studio. The artist-only role gate lives in the spine.
 * Each screen is a route-level `lazy` chunk so visitors never download the desk.
 */
export const studioRoutes: RouteObject[] = [
  { index: true, lazy: () => import('./StudioHome').then((m) => ({ Component: m.StudioHome })) },
  { path: 'profile', lazy: () => import('./ProfileEditor').then((m) => ({ Component: m.ProfileEditor })) },
  { path: 'work/new', lazy: () => import('./WorkEditor').then((m) => ({ Component: m.WorkEditorRoute })) },
  { path: 'work/:id', lazy: () => import('./WorkEditor').then((m) => ({ Component: m.WorkEditorRoute })) },
  { path: 'vault', lazy: () => import('./Vault').then((m) => ({ Component: m.Vault })) },
  { path: 'export', lazy: () => import('./ExportScreen').then((m) => ({ Component: m.ExportScreen })) },
  { path: 'import', lazy: () => import('./ImportScreen').then((m) => ({ Component: m.ImportScreen })) },
  { path: 'inquiries', lazy: () => import('./Inquiries').then((m) => ({ Component: m.Inquiries })) },
  { path: 'consent', lazy: () => import('./Consent').then((m) => ({ Component: m.Consent })) },
  { path: 'opportunities', lazy: () => import('./Opportunities').then((m) => ({ Component: m.Opportunities })) },
  { path: 'apply/:callId', lazy: () => import('./ApplyScreen').then((m) => ({ Component: m.ApplyScreen })) },
  { path: 'sales', lazy: () => import('./Sales').then((m) => ({ Component: m.Sales })) },
  { path: 'applications', lazy: () => import('./Applications').then((m) => ({ Component: m.Applications })) },
];
