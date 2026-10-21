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
  ...programmeConstraintErrors(),
};

/**
 * Programme constraints (supabase/migrations/0008_programme.sql) → the
 * messages cleanExhibition / cleanOpenCall / cleanEvent / cleanStory and the
 * application / inquiry rules produce in mock mode. The client runs those same
 * validators before writing, so these only surface if the client is bypassed.
 */
function programmeConstraintErrors(): Record<string, { message: string; field?: string }> {
  const out: Record<string, { message: string; field?: string }> = {};
  for (const t of ['exhibitions', 'open_calls', 'events', 'stories']) {
    out[`${t}_title_required`] = { message: 'Title is required.', field: 'title' };
    out[`${t}_title_length`] = { message: 'Keep the title under 160 characters.', field: 'title' };
    out[`${t}_image_src`] = { message: 'Unsupported image.', field: 'image' };
    out[`${t}_image_alt`] = { message: 'Image description is required.', field: 'image' };
    out[`${t}_summary_required`] = { message: 'Summary is required.', field: 'summary' };
    out[`${t}_summary_length`] = { message: 'Keep the summary under 600 characters.', field: 'summary' };
    out[`${t}_body_length`] = { message: 'Keep the body under 20000 characters.', field: 'body' };
    out[`${t}_external_url_scheme`] = { message: 'Links must start with http:// or https://', field: 'externalUrl' };
    out[`${t}_venue_shape`] = { message: 'Venue name and city are required.', field: 'venue' };
    out[`${t}_artworks_limit`] = { message: 'Invalid list of works.', field: 'artworkIds' };
  }
  Object.assign(out, {
    exhibitions_subtitle_length: { message: 'Keep the subtitle under 160 characters.', field: 'subtitle' },
    exhibitions_curated_by_length: { message: 'Keep the curated by under 160 characters.', field: 'curatedBy' },
    exhibitions_dates_order: { message: 'The end date is before the start date.', field: 'endsOn' },
    open_calls_partner_length: { message: 'Keep the partner under 160 characters.', field: 'partner' },
    open_calls_eligibility_required: { message: 'Eligibility is required.', field: 'eligibility' },
    open_calls_eligibility_length: { message: 'Keep the eligibility under 600 characters.', field: 'eligibility' },
    open_calls_fee_required: { message: 'Fee is required.', field: 'fee' },
    open_calls_fee_length: { message: 'Keep the fee under 160 characters.', field: 'fee' },
    open_calls_award_length: { message: 'Keep the award under 600 characters.', field: 'award' },
    open_calls_max_works_range: { message: 'Allow between 1 and 10 works.', field: 'maxWorks' },
    open_calls_dates_order: { message: 'The deadline is before the call opens.', field: 'deadline' },
    open_calls_mediums_no_null: { message: 'Unknown medium.', field: 'mediums' },
    events_times_order: { message: 'The event ends before it starts.', field: 'endsAt' },
    events_rsvp_url_scheme: { message: 'Links must start with http:// or https://', field: 'rsvpUrl' },
    stories_dek_required: { message: 'Standfirst is required.', field: 'dek' },
    stories_dek_length: { message: 'Keep the standfirst under 600 characters.', field: 'dek' },
    stories_body_required: { message: 'Body is required.', field: 'body' },
    stories_author_required: { message: 'Author is required.', field: 'author' },
    stories_author_length: { message: 'Keep the author under 160 characters.', field: 'author' },
    applications_statement_length: { message: 'Write at least a sentence or two about why these works fit the call.', field: 'statement' },
    applications_artworks_count: { message: 'Attach at least one work.', field: 'artworkIds' },
    applications_decision_note_length: { message: 'Keep notes under 2000 characters.', field: 'decisionNote' },
    applications_staff_note_length: { message: 'Keep notes under 2000 characters.', field: 'staffNote' },
    buyer_inquiries_name_length: { message: 'Tell us your name.', field: 'name' },
    buyer_inquiries_email_format: { message: 'Enter an email address we can reply to.', field: 'email' },
    buyer_inquiries_organization_length: { message: 'Keep the organisation name under 160 characters.', field: 'organization' },
    buyer_inquiries_message_length: { message: 'Add a line or two so Kofi knows how to help.', field: 'message' },
    buyer_inquiries_staff_note_length: { message: 'Keep notes under 2000 characters.', field: 'staffNote' },
    // 0009_sales.sql — the guard trigger / RPCs raise the exact domain messages first;
    // these only surface if those were bypassed.
    open_calls_terms_shape: { message: 'The terms are not valid.', field: 'terms' },
    open_calls_auction_terms: { message: 'An auction call must publish its compensation terms.', field: 'terms' },
    lots_lot_number_range: { message: 'Lot number must be between 1 and 9999.', field: 'lotNumber' },
    lots_reserve_nonnegative: { message: 'Enter a whole amount of money, or leave it empty.', field: 'reserve' },
    lots_starting_bid_nonnegative: { message: 'Enter a whole amount of money, or leave it empty.', field: 'startingBid' },
    lots_starting_bid_reserve: { message: 'The starting bid cannot be above the reserve.', field: 'startingBid' },
    payouts_method_length: { message: 'Keep the payment method under 80 characters.', field: 'method' },
    payouts_reference_length: { message: 'Keep the reference under 120 characters.', field: 'reference' },
    payouts_note_length: { message: 'Keep the note under 2000 characters.', field: 'note' },
    payouts_paid_details: { message: 'Say how the artist was paid.', field: 'method' },
  });
  return out;
}

/**
 * Foreign keys whose violation means "the thing you linked was deleted
 * meanwhile" on a form — reported like the mock's checkProgrammeRefs().
 * Any other 23503 is a NotFoundError.
 */
export const FOREIGN_KEY_ERRORS: Record<string, { message: string; field?: string }> = {
  open_calls_exhibition_id_fkey: { message: 'That exhibition no longer exists.', field: 'exhibitionId' },
  events_exhibition_id_fkey: { message: 'That exhibition no longer exists.', field: 'exhibitionId' },
  stories_artist_id_fkey: { message: 'That artist no longer exists.', field: 'artistId' },
  open_calls_organizer_institution_id_fkey: { message: 'That institution no longer exists.', field: 'organizerInstitutionId' },
};

export const SESSION_ENDED_MESSAGE = 'Your session has ended. Sign in again from Account.';
export const NETWORK_MESSAGE = 'Could not reach Kofi Collections. Check your connection and try again.';
/** PostgREST answers PGRST106 when the requested schema is not in its exposed-schemas list. */
export const SCHEMA_NOT_EXPOSED_MESSAGE =
  'This Supabase project does not expose the "kofi" schema yet. Add kofi under Settings → API → Exposed schemas (see docs/SUPABASE.md).';
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
 *     (except the programme form links in FOREIGN_KEY_ERRORS → ValidationError)
 *   22023 invalid_parameter_value (RPC validation, HINT = field), 23514 CHECK,
 *   23502 NOT NULL, 23505 UNIQUE, 22P02 bad enum/number  → ValidationError
 *   PGRST301/PGRST302 / 401 JWT problems  → ForbiddenError (sign in again)
 *   PGRST106 (schema not exposed by the project)  → Error naming the setup step
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
    case '23503': {
      const constraint = /constraint "([^"]+)"/.exec(message)?.[1];
      const known = constraint ? FOREIGN_KEY_ERRORS[constraint] : undefined;
      if (known) return new ValidationError(known.message, known.field);
      return new NotFoundError('That record no longer exists.');
    }
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
    case 'PGRST106':
      return new Error(SCHEMA_NOT_EXPOSED_MESSAGE);
    case 'PGRST301':
    case 'PGRST302':
    case 'PGRST303':
      return new ForbiddenError(SESSION_ENDED_MESSAGE);
    default:
      break;
  }

  if (/invalid schema: ?kofi|schema must be one of the following/i.test(message)) return new Error(SCHEMA_NOT_EXPOSED_MESSAGE);
  if (err.status === 401 || /jwt/i.test(message)) return new ForbiddenError(SESSION_ENDED_MESSAGE);
  if (err.status === 403) return new ForbiddenError(message && !isEngineForbiddenMessage(message) ? message : GENERIC_FORBIDDEN);
  if (err.status === 404) return new NotFoundError(message || 'Not found.');
  if (/failed to fetch|network ?error|load failed|fetch failed/i.test(message)) return new Error(NETWORK_MESSAGE);
  return new Error(message || fallback);
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}
