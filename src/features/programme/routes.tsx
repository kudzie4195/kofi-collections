import { Navigate, useLocation, type RouteObject } from 'react-router-dom';
import { DiscoverScreen } from './DiscoverScreen';
import { ExhibitionScreen, ExhibitionsScreen } from './ExhibitionScreens';
import { CallScreen, CallsScreen } from './CallScreens';
import { JournalScreen, StoryScreen } from './JournalScreens';
import { WhatsOnScreen } from './WhatsOnScreen';
import { AboutScreen } from './AboutScreen';
import { SavedScreen } from './SavedScreen';
import './programme.css';

/** Query params the works gallery understands (see features/gallery/params.ts). */
export const GALLERY_PARAMS = ['q', 'medium', 'material', 'unit', 'max', 'min', 'status', 'stage', 'region', 'commissions', 'publicart', 'bmin', 'bmax', 'bcur', 'undisclosed', 'yfrom', 'yto', 'sort'];

/**
 * `/` is Discover. Old gallery links (`/?medium=painting&max=40`) carry filter
 * params; those go to `/works` with the same params so shared links keep working.
 */
export function HomeRoute() {
  const { search } = useLocation();
  const sp = new URLSearchParams(search);
  if ([...sp.keys()].some((k) => GALLERY_PARAMS.includes(k))) return <Navigate to={`/works?${sp.toString()}`} replace />;
  return <DiscoverScreen />;
}

export const programmeRoutes: RouteObject[] = [
  { path: '/', element: <HomeRoute /> },
  { path: '/exhibitions', element: <ExhibitionsScreen /> },
  { path: '/exhibitions/:id', element: <ExhibitionScreen /> },
  { path: '/calls', element: <CallsScreen /> },
  { path: '/calls/:id', element: <CallScreen /> },
  { path: '/journal', element: <JournalScreen /> },
  { path: '/journal/:id', element: <StoryScreen /> },
  { path: '/whats-on', element: <WhatsOnScreen /> },
  { path: '/about', element: <AboutScreen /> },
  { path: '/saved', element: <SavedScreen /> },
];
