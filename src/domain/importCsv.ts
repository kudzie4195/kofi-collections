import type { ArtworkInput } from '@/data/DataSource';
import { parseCsv } from './export';
import type { ArtworkStatus, Unit, Visibility } from './types';
import { ARTWORK_STATUSES, MEDIUMS, VISIBILITIES } from './types';

/**
 * Reviewable CSV import (guide §02: "CSV/JSON export owned by the artist and
 * reviewable import options"). Accepts the app's own export format or any
 * spreadsheet with the same column names (case/space-insensitive). Nothing is
 * written until the artist reviews every row and confirms; imported works
 * always start as "Only me" drafts without images.
 */

export interface ImportRow {
  line: number;
  input?: ArtworkInput;
  problems: string[];
  preview: { title: string; year: string; medium: string; dimensions: string; price: string };
}

export interface ImportResult {
  rows: ImportRow[];
  ok: number;
  failed: number;
  columns: string[];
  missingColumns: string[];
}

const REQUIRED = ['title', 'year', 'medium', 'height', 'width', 'unit'] as const;
const ALIASES: Record<string, string> = {
  name: 'title',
  'title of work': 'title',
  material: 'materials',
  medium_type: 'medium',
  h: 'height',
  w: 'width',
  d: 'depth',
  units: 'unit',
  price: 'price_amount',
  amount: 'price_amount',
  currency: 'price_currency',
  notes: 'description',
  rights: 'rights_note',
  'rights note': 'rights_note',
};

function normHeader(h: string): string {
  const k = h.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ALIASES[k] ?? ALIASES[h.trim().toLowerCase()] ?? k;
}

export function importArtworksCsv(text: string): ImportResult {
  const rows = parseCsv(text);
  if (rows.length === 0) return { rows: [], ok: 0, failed: 0, columns: [], missingColumns: [...REQUIRED] };
  const header = rows[0]!.map(normHeader);
  const col = (name: string) => header.indexOf(name);
  const missingColumns = REQUIRED.filter((r) => col(r) < 0);
  const out: ImportRow[] = [];
  const thisYear = new Date().getFullYear();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    const get = (name: string) => {
      const idx = col(name);
      return idx >= 0 ? (r[idx] ?? '').trim() : '';
    };
    const problems: string[] = [];
    const title = get('title');
    if (!title) problems.push('Title is missing.');
    const year = Number.parseInt(get('year'), 10);
    if (!Number.isInteger(year) || year < 1900 || year > thisYear + 1) problems.push(`Year "${get('year')}" must be between 1900 and ${thisYear + 1}.`);
    const mediumRaw = get('medium').toLowerCase();
    const medium = MEDIUMS.find((m) => m === mediumRaw);
    if (!medium) problems.push(`Medium "${get('medium')}" is not one of: ${MEDIUMS.join(', ')}.`);
    const height = Number.parseFloat(get('height'));
    const width = Number.parseFloat(get('width'));
    const depthRaw = get('depth');
    const depth = depthRaw ? Number.parseFloat(depthRaw) : undefined;
    if (!(height > 0) || !(width > 0)) problems.push('Height and width must be numbers greater than zero.');
    if (depth !== undefined && !(depth >= 0)) problems.push('Depth cannot be negative.');
    const unitRaw = get('unit').toLowerCase();
    const unit: Unit | undefined = unitRaw === 'cm' || unitRaw === 'in' ? unitRaw : undefined;
    if (!unit) problems.push(`Unit "${get('unit')}" must be cm or in.`);
    const materials = get('materials')
      .split(/;|,/)
      .map((m) => m.trim())
      .filter(Boolean);
    if (materials.length === 0) problems.push('List at least one material (separate several with ;).');
    const statusRaw = get('status').toLowerCase();
    const status: ArtworkStatus = (ARTWORK_STATUSES as string[]).includes(statusRaw) ? (statusRaw as ArtworkStatus) : 'available';
    const priceAmountRaw = get('price_amount');
    const priceAmount = priceAmountRaw ? Number.parseFloat(priceAmountRaw.replace(/[^0-9.]/g, '')) : undefined;
    const priceCurrency = (get('price_currency') || 'USD').toUpperCase();
    if (priceAmount !== undefined && !(priceAmount >= 0)) problems.push(`Price "${priceAmountRaw}" is not a number.`);
    if (priceAmount !== undefined && !/^[A-Z]{3}$/.test(priceCurrency)) problems.push(`Currency "${get('price_currency')}" must be a 3-letter code.`);
    const pv = get('price_visibility').toLowerCase();
    const priceVisibility: Visibility = (VISIBILITIES as string[]).includes(pv) ? (pv as Visibility) : 'private';

    const preview = {
      title: title || '(no title)',
      year: get('year') || '—',
      medium: get('medium') || '—',
      dimensions: height && width ? `${height} × ${width}${depth !== undefined ? ` × ${depth}` : ''} ${unitRaw || ''}`.trim() : '—',
      price: priceAmount !== undefined ? (Number.isFinite(priceAmount) ? `${priceCurrency} ${priceAmount}` : `price “${priceAmountRaw}” not a number`) : 'no price',
    };

    const row: ImportRow = { line: i + 1, problems, preview };
    if (problems.length === 0 && medium && unit) {
      const input: ArtworkInput = {
        title,
        year,
        medium,
        materials,
        dimensions: depth !== undefined ? { height, width, depth, unit } : { height, width, unit },
        description: get('description'),
        images: [],
        status,
        rightsNote: get('rights_note'),
        priceVisibility,
        // Imported works are always private drafts until the artist adds images and publishes.
        visibility: 'private',
        tags: get('tags')
          .split(/;|,/)
          .map((t) => t.trim())
          .filter(Boolean),
      };
      if (priceAmount !== undefined) input.price = { amount: priceAmount, currency: priceCurrency };
      row.input = input;
    }
    out.push(row);
  }
  const ok = out.filter((r) => r.input).length;
  return { rows: out, ok, failed: out.length - ok, columns: header, missingColumns };
}

export const IMPORT_TEMPLATE_CSV =
  'title,year,medium,materials,height,width,depth,unit,status,price_amount,price_currency,price_visibility,description,rights_note,tags\r\n' +
  'Example work,2025,painting,oil on linen; gesso,60,45,,cm,available,1200,USD,institutions,A short description,© Your Name,study; blue\r\n';
