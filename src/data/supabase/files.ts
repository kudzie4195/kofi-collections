/** data: URL ⇄ Blob helpers for Storage uploads/downloads. Browser + jsdom safe. */

export interface ParsedDataUrl {
  mime: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export function parseDataUrl(dataUrl: string): ParsedDataUrl | undefined {
  const m = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return undefined;
  const mime = (m[1] || 'text/plain').toLowerCase();
  const body = m[4] ?? '';
  if (m[3]) {
    let bin: string;
    try {
      bin = atob(body);
    } catch {
      return undefined;
    }
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime, bytes };
  }
  let text: string;
  try {
    text = decodeURIComponent(body);
  } catch {
    return undefined;
  }
  return { mime, bytes: new Uint8Array(new TextEncoder().encode(text)) };
}

export function dataUrlToBlob(dataUrl: string): Blob | undefined {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return undefined;
  return new Blob([parsed.bytes], { type: parsed.mime });
}

export async function blobToDataUrl(blob: Blob, fallbackType = 'application/octet-stream'): Promise<string> {
  const type = blob.type || fallbackType;
  if (typeof FileReader !== 'undefined') {
    const url = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error ?? new Error('Could not read the file.'));
      r.readAsDataURL(blob);
    });
    // Normalise the media type (some engines emit "data:;base64," for untyped blobs).
    return url.replace(/^data:[^,]*?(;base64)?,/, (_m, b64: string | undefined) => `data:${type}${b64 ?? ''},`);
  }
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return `data:${type};base64,${btoa(bin)}`;
}

/** Image types uploaded to the artwork-images bucket (matches its allowed_mime_types). */
export const UPLOADABLE_IMAGE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function newUuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
