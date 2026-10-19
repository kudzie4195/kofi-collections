import type { ArtDocument, Artist, Artwork } from './types';
import { formatDimensions } from './units';

export interface ArtistExportBundle {
  exportedAt: string;
  format: 'kofi-collections-export';
  version: 1;
  notice: string;
  artist: Artist;
  artworks: Artwork[];
  documents: Omit<ArtDocument, 'fileRef'>[];
}

export const EXPORT_NOTICE =
  'Fictional demonstration data. Exported by the artist from Kofi Collections. ' +
  'The artist retains ownership and copyright of all works and records.';

/** Full, artist-owned JSON export. Includes private fields — it belongs to the artist. */
export function buildArtistExport(
  artist: Artist,
  artworks: Artwork[],
  documents: ArtDocument[],
  now = new Date(),
): ArtistExportBundle {
  return {
    exportedAt: now.toISOString(),
    format: 'kofi-collections-export',
    version: 1,
    notice: EXPORT_NOTICE,
    artist,
    artworks: artworks.map((a) => ({
      ...a,
      // Images are included inline in mock mode (data URLs) — the artist owns them.
      images: a.images.map((i) => ({ ...i })),
    })),
    documents: documents.map(({ fileRef: _fileRef, ...rest }) => rest),
  };
}

export const ARTWORK_CSV_COLUMNS = [
  'id',
  'title',
  'year',
  'medium',
  'materials',
  'height',
  'width',
  'depth',
  'unit',
  'dimensions_display',
  'status',
  'price_amount',
  'price_currency',
  'price_visibility',
  'visibility',
  'rights_note',
  'tags',
  'description',
  'created_at',
  'updated_at',
] as const;

export function csvEscape(value: unknown): string {
  if (value === undefined || value === null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** RFC 4180 CSV of the artist's artworks. One row per work, header included. */
export function artworksToCsv(artworks: Artwork[]): string {
  const header = ARTWORK_CSV_COLUMNS.join(',');
  const rows = artworks.map((a) =>
    [
      a.id,
      a.title,
      a.year,
      a.medium,
      a.materials.join('; '),
      a.dimensions.height,
      a.dimensions.width,
      a.dimensions.depth ?? '',
      a.dimensions.unit,
      formatDimensions(a.dimensions),
      a.status,
      a.price?.amount ?? '',
      a.price?.currency ?? '',
      a.priceVisibility,
      a.visibility,
      a.rightsNote,
      a.tags.join('; '),
      a.description,
      a.createdAt,
      a.updatedAt,
    ]
      .map(csvEscape)
      .join(','),
  );
  return [header, ...rows].join('\r\n') + '\r\n';
}

/** Minimal CSV parser for reviewable re-import (handles quotes, CRLF). Returns rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
