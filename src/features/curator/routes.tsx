import type { RouteObject } from 'react-router-dom';
import { TopBar } from '@/ui';

function Placeholder() {
  return (
    <div className="screen">
      <TopBar title="curator" />
      <main className="container"><p>Coming soon.</p></main>
    </div>
  );
}

export const curatorRoutes: RouteObject[] = [{ index: true, element: <Placeholder /> }];
