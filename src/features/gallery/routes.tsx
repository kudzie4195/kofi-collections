import type { RouteObject } from 'react-router-dom';
import { TopBar } from '@/ui';

function Placeholder({ title }: { title: string }) {
  return (
    <div className="screen">
      <TopBar title={title} />
      <main className="container"><p>Coming soon.</p></main>
    </div>
  );
}

export const galleryRoutes: RouteObject[] = [
  { path: '/', element: <Placeholder title="Gallery" /> },
  { path: '/work/:id', element: <Placeholder title="Artwork" /> },
  { path: '/artists', element: <Placeholder title="Artists" /> },
  { path: '/artists/:id', element: <Placeholder title="Artist" /> },
];
