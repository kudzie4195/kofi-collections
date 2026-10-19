import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DataSource } from '@/data/DataSource';
import { loadDataSource } from '@/data';
import type { DemoIdentity, Viewer } from '@/domain/types';
import { PUBLIC_VIEWER } from '@/domain/types';

const SESSION_KEY = 'kofi.session.v1';

interface SessionContextValue {
  viewer: Viewer;
  identities: DemoIdentity[];
  data: DataSource;
  /** Bumps whenever the data source reports a change. Use as an effect dependency. */
  version: number;
  signInAs(identity: DemoIdentity): void;
  signOut(): void;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

function loadViewer(): Viewer {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY) ?? localStorage.getItem(SESSION_KEY);
    if (!raw) return PUBLIC_VIEWER;
    const v = JSON.parse(raw) as Viewer;
    return v && typeof v.role === 'string' ? v : PUBLIC_VIEWER;
  } catch {
    return PUBLIC_VIEWER;
  }
}

export function SessionProvider({ children, dataSource }: { children: ReactNode; dataSource?: DataSource }) {
  const [data, setData] = useState<DataSource | undefined>(dataSource);
  const [identities, setIdentities] = useState<DemoIdentity[]>([]);
  const [viewer, setViewer] = useState<Viewer>(loadViewer);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    (dataSource ? Promise.resolve(dataSource) : loadDataSource()).then(async (ds) => {
      if (!alive) return;
      setData(ds);
      setIdentities(await ds.listDemoIdentities());
    });
    return () => {
      alive = false;
    };
  }, [dataSource]);

  useEffect(() => {
    if (!data) return;
    return data.subscribe(() => setVersion((v) => v + 1));
  }, [data]);

  const signInAs = useCallback((identity: DemoIdentity) => {
    setViewer(identity.viewer);
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(identity.viewer));
    } catch {
      /* ignore */
    }
  }, []);

  const signOut = useCallback(() => {
    setViewer(PUBLIC_VIEWER);
    try {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<SessionContextValue | undefined>(
    () => (data ? { viewer, identities, data, version, signInAs, signOut } : undefined),
    [viewer, identities, data, version, signInAs, signOut],
  );

  if (!value) return <BootSplash />;
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function BootSplash() {
  return (
    <div className="boot" role="status" aria-live="polite">
      <span className="boot__mark" aria-hidden="true" />
      Loading Kofi Collections
    </div>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

export function useViewer(): Viewer {
  return useSession().viewer;
}

export function useData(): DataSource {
  return useSession().data;
}

/* ---------- async query helper ---------- */

export interface QueryState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
}

/**
 * Small data-fetching hook bound to the session's data source. Re-runs when the
 * viewer changes, when the data source reports a change, or when `deps` change.
 */
export function useQuery<T>(fn: (data: DataSource, viewer: Viewer) => Promise<T>, deps: unknown[] = []): QueryState<T> {
  const { data, viewer, version } = useSession();
  const [state, setState] = useState<{ data: T | undefined; error: Error | undefined; loading: boolean }>({
    data: undefined,
    error: undefined,
    loading: true,
  });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fn(data, viewer)
      .then((d) => alive && setState({ data: d, error: undefined, loading: false }))
      .catch((e: unknown) => alive && setState({ data: undefined, error: e instanceof Error ? e : new Error(String(e)), loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, viewer, version, tick, ...deps]);

  return { ...state, reload };
}
