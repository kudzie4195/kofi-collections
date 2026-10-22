/**
 * Server-side page fetch with the guards the brief asks for: only public
 * http(s) addresses (checked again after DNS and on every redirect), at most 3
 * redirects followed by hand, a 6 s budget for the whole exchange, 1 MB of
 * body at most, HTML only. No Deno globals: the DNS resolver is injected.
 */
import { isFetchableUrl, isPrivateAddress } from './parse.ts';

export const FETCH_TIMEOUT_MS = 6000;
export const MAX_BYTES = 1024 * 1024;
export const MAX_REDIRECTS = 3;
export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 KofiCollectionsProfileReader/1.0';

export type PageResult =
  | { ok: true; status: number; finalUrl: string; html: string; truncated: boolean }
  | { ok: false; reason: 'blocked' | 'timeout' | 'network' | 'status' | 'not_html' | 'redirects'; status?: number; finalUrl?: string };

export interface FetchDeps {
  fetchImpl: typeof fetch;
  /** Resolve A / AAAA records; undefined when the runtime cannot (then only the literal check applies). */
  resolve?: (host: string) => Promise<string[]>;
  timeoutMs?: number;
  maxBytes?: number;
}

async function hostIsPublic(url: string, resolve: FetchDeps['resolve']): Promise<boolean> {
  if (!isFetchableUrl(url)) return false;
  const host = new URL(url).hostname;
  if (!resolve || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return true;
  try {
    const addrs = await resolve(host);
    return addrs.length > 0 && !addrs.some(isPrivateAddress);
  } catch {
    return true; // resolver unavailable or no answer: the fetch itself will fail if the host does not exist
  }
}

async function readCapped(res: Response, max: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: '', truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > max) {
      chunks.push(value.subarray(0, max - size));
      size = max;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const all = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(all), truncated };
}

export async function fetchPage(startUrl: string, deps: FetchDeps): Promise<PageResult> {
  const timeout = deps.timeoutMs ?? FETCH_TIMEOUT_MS;
  const max = deps.maxBytes ?? MAX_BYTES;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let url = startUrl;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!(await hostIsPublic(url, deps.resolve))) return { ok: false, reason: 'blocked', finalUrl: url };
      let res: Response;
      try {
        res = await deps.fetchImpl(url, {
          method: 'GET',
          redirect: 'manual',
          signal: ctl.signal,
          headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'accept-language': 'en-US,en;q=0.8' },
        });
      } catch (e) {
        return { ok: false, reason: ctl.signal.aborted || (e instanceof Error && e.name === 'AbortError') ? 'timeout' : 'network', finalUrl: url };
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        await res.body?.cancel().catch(() => undefined);
        let next: string;
        try {
          next = new URL(res.headers.get('location')!, url).toString();
        } catch {
          return { ok: false, reason: 'network', finalUrl: url };
        }
        url = next;
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        await res.body?.cancel().catch(() => undefined);
        return { ok: false, reason: 'status', status: res.status, finalUrl: url };
      }
      const type = (res.headers.get('content-type') ?? '').toLowerCase();
      if (type && !/text\/html|application\/xhtml\+xml/.test(type)) {
        await res.body?.cancel().catch(() => undefined);
        return { ok: false, reason: 'not_html', status: res.status, finalUrl: url };
      }
      const { text, truncated } = await readCapped(res, max);
      return { ok: true, status: res.status, finalUrl: url, html: text, truncated };
    }
    return { ok: false, reason: 'redirects', finalUrl: url };
  } catch (e) {
    return { ok: false, reason: ctl.signal.aborted || (e instanceof Error && e.name === 'AbortError') ? 'timeout' : 'network', finalUrl: url };
  } finally {
    clearTimeout(timer);
  }
}
