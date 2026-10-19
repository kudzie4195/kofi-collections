import { ForbiddenError, NotFoundError, ValidationError } from '../DataSource';

/** Shape of a PostgREST / supabase-js error (PostgrestError, StorageError, AuthError all fit). */
export interface PgErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  status?: number | null;
  name?: string;
}

/**
 * Server-side CHECK constraints (supabase/migrations/0001_schema.sql) mapped to
 * the same field + message the mock data source uses, so a server-side
 * rejection reads exactly like the client-side one.
 */
export const CONSTRAINT_ERRORS: Record<string, { message: string; field?: string }> = {
  artworks_title_required: { message: 'Give the work a title.', field: 'title' },
  artworks_year_range: { message: 'Year must be between 1900 and 2100.', field: 'year' },
  artworks_materials_required: { message: 'List at least one material.', field: 'materials' },
  artworks_dimensions_positive: { message: 'Height and width must be greater than zero.', field: 'dimensions' },
  artworks_depth_nonnegative: { message: 'Depth cannot be negative.', field: 'dimensions' },
  artworks_price_nonnegative: { message: 'Price cannot be negative.', field: 'price' },
  artworks_price_currency_format: { message: 'Currency must be a 3-letter code (USD, CAD).', field: 'price' },
  artworks_price_pair: { message: 'Enter both a price and a currency, or leave both empty.', field: 'price' },
  artwork_images_src_kind: { message: 'Unsupported image.', field: 'images' },
  artwork_images_src_size: { message: 'Images must be under 6 MB.', field: 'images' },
  artists_working_name_required: { message: 'Working name is required.', field: 'workingName' },
  artists_contact_email_format: { message: 'Enter a valid email.', field: 'contact' },
  artists_visibility_allowed: { message: 'A profile can be public, Kofi-only or private.', field: 'visibility' },
  artists_years_nonnegative: { message: 'Years practicing cannot be negative.', field: 'experience' },
  artists_links_array: { message: 'Links must be a list.', field: 'links' },
  shortlists_name_required: { message: 'Name the shortlist.', field: 'name' },
  inquiries_message_length: { message: 'Write a short message explaining the opportunity.', field: 'message' },
  documents_title_required: { message: 'Give the document a title.', field: 'title' },
  documents_size_limit: { message: 'Documents must be under 10 MB.', field: 'file' },
  documents_visibility_allowed: { message: 'Vault documents are private or Kofi-only.', field: 'visibility' },
  curators_name_required: { message: 'Your name is required.', field: 'name' },
  curators_work_email_format: { message: 'Use your institutional work email.', field: 'workEmail' },
  curators_purpose_length: { message: 'Tell Kofi what you are looking for (a sentence or two).', field: 'purpose' },
  institutions_name_required: { message: 'Institution name is required.', field: 'institution' },
};

export const SESSION_ENDED_MESSAGE = 'Your session has ended. Sign in again from Account.';
export const NETWORK_MESSAGE = 'Could not reach Kofi Collections. Check your connection and try again.';
const GENERIC_FORBIDDEN = 'You do not have access to this.';

/** Messages Postgres itself produces for privilege / RLS failures — replaced with plain language. */
function isEngineForbiddenMessage(msg: string): boolean {
  return /^(new row violates row-level security policy|permission denied for )/i.test(msg);
}

/**
 * Map a Postgres / PostgREST / Storage error to the app's error classes.
 *
 *   42501 insufficient_privilege, RLS violation  → ForbiddenError
 *   P0002 no_data_found (raised by RPCs), PGRST116 (no row), 23503 FK  → NotFoundError
 *   22023 invalid_parameter_value (RPC validation, HINT = field), 23514 CHECK,
 *   23502 NOT NULL, 23505 UNIQUE, 22P02 bad enum/number  → ValidationError
 *   PGRST301/PGRST302 / 401 JWT problems  → ForbiddenError (sign in again)
 *   network failure  → Error with a "check your connection" message
 */
export function mapPgError(err: PgErrorLike | null | undefined, fallback = 'Something went wrong. Try again.'): Error {
  if (!err) return new Error(fallback);
  if (err instanceof ForbiddenError || err instanceof NotFoundError || err instanceof ValidationError) return err;
  const code = err.code ?? '';
  const message = (err.message ?? '').trim();

  switch (code) {
    case '42501':
      return new ForbiddenError(message && !isEngineForbiddenMessage(message) ? message : GENERIC_FORBIDDEN);
    case 'P0002':
      return new NotFoundError(message || 'Not found.');
    case 'PGRST116':
      return new NotFoundError('Not found.');
    case '23503':
      return new NotFoundError('That record no longer exists.');
    case '22023':
      return new ValidationError(message || 'Check the highlighted field.', err.hint || undefined);
    case '23514': {
      const constraint = /constraint "([^"]+)"/.exec(message)?.[1];
      const known = constraint ? CONSTRAINT_ERRORS[constraint] : undefined;
      if (known) return new ValidationError(known.message, known.field);
      return new ValidationError('One of the values is not allowed. Check the form and try again.');
    }
    case '23502': {
      const column = /column "([^"]+)"/.exec(message)?.[1];
      return new ValidationError('A required field is missing.', column ? snakeToCamel(column) : undefined);
    }
    case '23505':
      return new ValidationError('That already exists.');
    case '22P02':
      if (/uuid/i.test(message)) return new NotFoundError('Not found.');
      return new ValidationError('One of the values is not valid. Check the form and try again.');
    case 'PGRST301':
    case 'PGRST302':
    case 'PGRST303':
      return new ForbiddenError(SESSION_ENDED_MESSAGE);
    default:
      break;
  }

  if (err.status === 401 || /jwt/i.test(message)) return new ForbiddenError(SESSION_ENDED_MESSAGE);
  if (err.status === 403) return new ForbiddenError(message && !isEngineForbiddenMessage(message) ? message : GENERIC_FORBIDDEN);
  if (err.status === 404) return new NotFoundError(message || 'Not found.');
  if (/failed to fetch|network ?error|load failed|fetch failed/i.test(message)) return new Error(NETWORK_MESSAGE);
  return new Error(message || fallback);
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}
