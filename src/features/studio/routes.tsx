import type { RouteObject } from 'react-router-dom';
import './studio.css';
import './opportunities.css';
import { StudioHome } from './StudioHome';
import { ProfileEditor } from './ProfileEditor';
import { WorkEditorRoute } from './WorkEditor';
import { Vault } from './Vault';
import { ExportScreen } from './ExportScreen';
import { Inquiries } from './Inquiries';
import { Consent } from './Consent';
import { ImportScreen } from './ImportScreen';
import { Opportunities } from './Opportunities';
import { ApplyScreen } from './ApplyScreen';
import { Applications } from './Applications';

/** Relative children of /studio. The artist-only role gate lives in the spine. */
export const studioRoutes: RouteObject[] = [
  { index: true, element: <StudioHome /> },
  { path: 'profile', element: <ProfileEditor /> },
  { path: 'work/new', element: <WorkEditorRoute /> },
  { path: 'work/:id', element: <WorkEditorRoute /> },
  { path: 'vault', element: <Vault /> },
  { path: 'export', element: <ExportScreen /> },
  { path: 'import', element: <ImportScreen /> },
  { path: 'inquiries', element: <Inquiries /> },
  { path: 'consent', element: <Consent /> },
  { path: 'opportunities', element: <Opportunities /> },
  { path: 'apply/:callId', element: <ApplyScreen /> },
  { path: 'applications', element: <Applications /> },
];
