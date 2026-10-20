import type { RouteObject } from 'react-router-dom';
import { ArtistScreen } from './ArtistScreen';
import { ArtistsScreen } from './ArtistsScreen';
import { ArtworkScreen } from './ArtworkScreen';
import { GalleryScreen } from './GalleryScreen';
import './gallery.css';

export const galleryRoutes: RouteObject[] = [
  { path: '/works', element: <GalleryScreen /> },
  { path: '/work/:id', element: <ArtworkScreen /> },
  { path: '/artists', element: <ArtistsScreen /> },
  { path: '/artists/:id', element: <ArtistScreen /> },
];
