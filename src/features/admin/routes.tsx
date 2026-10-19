import type { RouteObject } from 'react-router-dom';
import { AdminHome } from './AdminHome';
import { AdminArtists } from './AdminArtists';
import { AdminArtistDetail } from './AdminArtistDetail';
import { AdminCurators } from './AdminCurators';
import { AdminInquiries } from './AdminInquiries';
import { AdminActivity } from './AdminActivity';

/** Relative children of `/admin`. The role gate lives in the spine. */
export const adminRoutes: RouteObject[] = [
  { index: true, element: <AdminHome /> },
  { path: 'artists', element: <AdminArtists /> },
  { path: 'artists/:id', element: <AdminArtistDetail /> },
  { path: 'curators', element: <AdminCurators /> },
  { path: 'inquiries', element: <AdminInquiries /> },
  { path: 'activity', element: <AdminActivity /> },
];
