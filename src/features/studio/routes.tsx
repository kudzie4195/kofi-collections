import type { RouteObject } from 'react-router-dom';
import './studio.css';
import { StudioHome } from './StudioHome';
import { ProfileEditor } from './ProfileEditor';
import { WorkEditorRoute } from './WorkEditor';
import { Vault } from './Vault';
import { ExportScreen } from './ExportScreen';
import { Inquiries } from './Inquiries';
import { Consent } from './Consent';

/** Relative children of /studio. The artist-only role gate lives in the spine. */
export const studioRoutes: RouteObject[] = [
  { index: true, element: <StudioHome /> },
  { path: 'profile', element: <ProfileEditor /> },
  { path: 'work/new', element: <WorkEditorRoute /> },
  { path: 'work/:id', element: <WorkEditorRoute /> },
  { path: 'vault', element: <Vault /> },
  { path: 'export', element: <ExportScreen /> },
  { path: 'inquiries', element: <Inquiries /> },
  { path: 'consent', element: <Consent /> },
];
