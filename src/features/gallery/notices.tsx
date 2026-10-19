import { Link } from 'react-router-dom';
import type { Viewer } from '@/domain/types';
import { Icon, Notice } from '@/ui';
import { isPendingCurator } from './helpers';

/**
 * What a non-verified viewer sees where a verified curator would see the
 * shortlist / introduction actions. Returns null for anyone else.
 */
export function CuratorAccessNotice({ viewer }: { viewer: Viewer }) {
  if (isPendingCurator(viewer)) {
    return (
      <Notice tone="butter" icon={<Icon.Building />}>
        Kofi is still verifying your institution. Once you are verified you can save work to shortlists and request introductions.{' '}
        <Link to="/curator/verify" className="strong">
          Check your verification
        </Link>
      </Notice>
    );
  }
  if (viewer.role === 'public') {
    return (
      <Notice tone="plain" icon={<Icon.Building />}>
        Curators from verified institutions can request an introduction.{' '}
        <Link to="/account" className="strong">
          Sign in as a curator
        </Link>
      </Notice>
    );
  }
  return null;
}
