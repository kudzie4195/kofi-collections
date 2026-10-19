import type { RouteObject } from 'react-router-dom';
import { CuratorHome } from './CuratorHome';
import { ShortlistScreen } from './ShortlistScreen';
import { VerifyScreen } from './VerifyScreen';
import { CuratorInquiries } from './CuratorInquiries';

/** Relative children of `/curator`. The role gate lives in the spine. */
export const curatorRoutes: RouteObject[] = [
  { index: true, element: <CuratorHome /> },
  { path: 'shortlists/:id', element: <ShortlistScreen /> },
  { path: 'verify', element: <VerifyScreen /> },
  { path: 'inquiries', element: <CuratorInquiries /> },
];
