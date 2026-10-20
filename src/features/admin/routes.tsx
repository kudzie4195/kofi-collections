import type { RouteObject } from 'react-router-dom';
import { AdminHome } from './AdminHome';
import { AdminArtists } from './AdminArtists';
import { AdminArtistDetail } from './AdminArtistDetail';
import { AdminCurators } from './AdminCurators';
import { AdminInquiries } from './AdminInquiries';
import { AdminActivity } from './AdminActivity';
import { AdminProgramme } from './AdminProgramme';
import { ProgrammeEditorRoute } from './ProgrammeEditor';
import { AdminApplications } from './AdminApplications';
import { AdminApplicationDetail } from './AdminApplicationDetail';
import { AdminCollectors } from './AdminCollectors';

/** Relative children of `/admin`. The role gate lives in the spine. */
export const adminRoutes: RouteObject[] = [
  { index: true, element: <AdminHome /> },
  { path: 'artists', element: <AdminArtists /> },
  { path: 'artists/:id', element: <AdminArtistDetail /> },
  { path: 'curators', element: <AdminCurators /> },
  { path: 'inquiries', element: <AdminInquiries /> },
  { path: 'activity', element: <AdminActivity /> },
  { path: 'programme', element: <AdminProgramme /> },
  { path: 'programme/:kind/:id', element: <ProgrammeEditorRoute /> },
  { path: 'applications', element: <AdminApplications /> },
  { path: 'applications/:id', element: <AdminApplicationDetail /> },
  { path: 'collectors', element: <AdminCollectors /> },
];
