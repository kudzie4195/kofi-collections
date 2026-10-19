-- =============================================================================
-- Kofi Collections — 0001 schema
--
-- Columns mirror src/domain/types.ts in snake_case. Nested TS objects are
-- flattened: Region → region_city/region_region/region_country/region_precision,
-- Dimensions → height/width/depth/unit, Price → price_amount/price_currency,
-- ArtistExperience → experience_*, ArtistAvailability → availability_*,
-- ArtistContact → contact_*.
--
-- Field-level visibility is enforced in 0002 (RLS + column privileges +
-- guard triggers) and 0003 (redacting views). Audit/consent tables are
-- append-only (trigger below + no UPDATE/DELETE policies in 0002).
--
-- Every object lives in schema `kofi` (created in 0000). Internal helpers
-- (trigger functions, the audit writer) live there too so that
-- `drop schema kofi cascade` removes everything; 0002 revokes EXECUTE on them
-- from public/anon/authenticated, so they are not callable through the API.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- enums ------
create type kofi.visibility as enum ('public', 'institutions', 'kofi', 'private');
create type kofi.role as enum ('public', 'artist', 'curator', 'admin');
create type kofi.medium as enum (
  'painting', 'drawing', 'printmaking', 'sculpture', 'ceramics', 'textile',
  'photography', 'video', 'installation', 'mixed media', 'digital', 'performance'
);
create type kofi.career_stage as enum ('emerging', 'mid-career', 'established');
create type kofi.artwork_status as enum ('available', 'on hold', 'sold', 'not for sale', 'commission sample');
create type kofi.artist_status as enum ('draft', 'pending', 'approved', 'paused');
create type kofi.curator_status as enum ('pending', 'verified', 'rejected');
create type kofi.inquiry_status as enum ('pending', 'forwarded', 'accepted', 'declined');
create type kofi.document_type as enum (
  'invoice', 'appraisal', 'condition report', 'provenance', 'insurance', 'contract', 'other'
);
create type kofi.unit as enum ('cm', 'in');
create type kofi.region_precision as enum ('city', 'region', 'country');
create type kofi.institution_type as enum ('museum', 'gallery', 'university', 'nonprofit', 'corporate', 'municipal', 'other');

-- ---------------------------------------------------------- utilities --------
create or replace function kofi.touch_updated_at() returns trigger
language plpgsql set search_path = kofi, public as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function kofi.forbid_mutation() returns trigger
language plpgsql set search_path = kofi, public as $$
begin
  raise exception '% is append-only: % is not allowed.', tg_table_name, lower(tg_op)
    using errcode = '42501';
end $$;

-- ------------------------------------------------------------- profiles ------
create table kofi.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role kofi.role not null default 'public',
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A new auth user gets a Kofi profile. Self-service sign-up may ask for
-- 'artist' or 'curator' (both still need Kofi review/verification); 'admin' is
-- never self-assignable — staff are promoted with the service role.
--
-- auth.users is SHARED with another product, which typically has its own
-- trigger named `on_auth_user_created`; trigger names are per table, so ours
-- is prefixed to avoid the clash. And because this trigger fires on that
-- product's sign-ups too, it must never abort them: any failure here is
-- downgraded to a WARNING and the user simply has no Kofi profile (Kofi then
-- treats them as role 'public', see kofi.current_role_of()).
create or replace function kofi.handle_new_user() returns trigger
language plpgsql security definer set search_path = kofi, public as $$
declare
  requested text := new.raw_user_meta_data ->> 'kofi_role';
begin
  -- Opt-in only: users who did not sign up through Kofi (no kofi_role) get no
  -- Kofi profile row at all; kofi.current_role_of() treats them as 'public'.
  if requested is null or requested not in ('artist', 'curator', 'public') then
    return new;
  end if;
  begin
    insert into kofi.profiles (id, role, display_name)
    values (
      new.id,
      case when requested in ('artist', 'curator') then requested::kofi.role else 'public'::kofi.role end,
      coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(new.email, ''), '@', 1))
    )
    on conflict (id) do nothing;
  exception when others then
    raise warning 'kofi.handle_new_user: no Kofi profile for %: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return new;
end $$;

create trigger kofi_on_auth_user_created
  after insert on auth.users
  for each row execute function kofi.handle_new_user();

-- -------------------------------------------------------------- artists ------
create table kofi.artists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  working_name text not null constraint artists_working_name_required check (char_length(btrim(working_name)) > 0),
  legal_name text,
  pronouns text,
  bio text not null default '',
  statement text,
  region_city text,
  region_region text not null default '',
  region_country text not null,
  region_precision kofi.region_precision not null default 'region',
  mediums kofi.medium[] not null default '{}',
  career_stage kofi.career_stage not null default 'emerging',
  experience_commissions boolean not null default false,
  experience_public_art boolean not null default false,
  experience_residencies boolean not null default false,
  experience_institutional_shows boolean not null default false,
  experience_years_practicing integer constraint artists_years_nonnegative check (experience_years_practicing is null or experience_years_practicing >= 0),
  availability_commissions boolean not null default false,
  availability_sales boolean not null default false,
  availability_exhibitions boolean not null default false,
  links jsonb not null default '[]'::jsonb constraint artists_links_array check (jsonb_typeof(links) = 'array'),
  contact_email text not null constraint artists_contact_email_format check (contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_phone text,
  contact_studio_address text,
  kofi_notes text,
  visibility kofi.visibility not null default 'private'
    constraint artists_visibility_allowed check (visibility in ('public', 'kofi', 'private')),
  status kofi.artist_status not null default 'draft',
  consent_version text,
  consent_accepted_at timestamptz,
  avatar_color text not null default '#2436F5',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index artists_status_idx on kofi.artists (status);
create index artists_visibility_idx on kofi.artists (visibility);
create trigger artists_touch before update on kofi.artists
  for each row execute function kofi.touch_updated_at();

-- ------------------------------------------------------------- artworks ------
create table kofi.artworks (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references kofi.artists (id) on delete cascade,
  title text not null constraint artworks_title_required check (char_length(btrim(title)) > 0),
  year integer not null constraint artworks_year_range check (year between 1900 and 2100),
  medium kofi.medium not null,
  materials text[] not null constraint artworks_materials_required check (cardinality(materials) > 0),
  height numeric not null,
  width numeric not null,
  depth numeric,
  unit kofi.unit not null default 'cm',
  description text not null default '',
  status kofi.artwork_status not null default 'available',
  rights_note text not null default '',
  price_amount numeric constraint artworks_price_nonnegative check (price_amount is null or price_amount >= 0),
  price_currency text constraint artworks_price_currency_format check (price_currency is null or price_currency ~ '^[A-Z]{3}$'),
  price_visibility kofi.visibility not null default 'private',
  visibility kofi.visibility not null default 'private',
  tags text[] not null default '{}',
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artworks_dimensions_positive check (height > 0 and width > 0),
  constraint artworks_depth_nonnegative check (depth is null or depth >= 0),
  constraint artworks_price_pair check ((price_amount is null) = (price_currency is null))
);
create index artworks_artist_id_idx on kofi.artworks (artist_id);
create index artworks_visibility_idx on kofi.artworks (visibility);
create index artworks_medium_idx on kofi.artworks (medium);
create index artworks_status_idx on kofi.artworks (status);
create trigger artworks_touch before update on kofi.artworks
  for each row execute function kofi.touch_updated_at();

-- ------------------------------------------------------- artwork_images ------
-- src is either an inline data:image/ URL (seeded placeholders) or
-- 'storage:artwork-images/<artist_id>/<image_id>.<ext>' (uploads). The
-- client resolves storage refs to short-lived signed URLs.
create table kofi.artwork_images (
  id uuid primary key default gen_random_uuid(),
  artwork_id uuid not null references kofi.artworks (id) on delete cascade,
  src text not null
    constraint artwork_images_src_kind check (src like 'data:image/%' or src like 'storage:artwork-images/%')
    constraint artwork_images_src_size check (char_length(src) <= 8620000),
  alt text not null default '',
  is_primary boolean not null default false,
  metadata_stripped boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index artwork_images_artwork_id_idx on kofi.artwork_images (artwork_id);
create index artwork_images_src_storage_idx on kofi.artwork_images (src) where src like 'storage:%';

-- --------------------------------------------------------- institutions ------
create table kofi.institutions (
  id uuid primary key default gen_random_uuid(),
  name text not null constraint institutions_name_required check (char_length(btrim(name)) > 0),
  type kofi.institution_type not null default 'other',
  website text,
  city text,
  country text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index institutions_name_ci_idx on kofi.institutions (lower(btrim(name)));
create trigger institutions_touch before update on kofi.institutions
  for each row execute function kofi.touch_updated_at();

-- ------------------------------------------------------------- curators ------
create table kofi.curators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  name text not null constraint curators_name_required check (char_length(btrim(name)) > 0),
  title text not null default '',
  institution_id uuid not null references kofi.institutions (id),
  work_email text not null constraint curators_work_email_format check (work_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  purpose text not null constraint curators_purpose_length check (char_length(btrim(purpose)) >= 20),
  status kofi.curator_status not null default 'pending',
  verification_note text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index curators_status_idx on kofi.curators (status);
create index curators_institution_id_idx on kofi.curators (institution_id);
create trigger curators_touch before update on kofi.curators
  for each row execute function kofi.touch_updated_at();

-- ----------------------------------------------------------- shortlists ------
create table kofi.shortlists (
  id uuid primary key default gen_random_uuid(),
  curator_id uuid not null references kofi.curators (id) on delete cascade,
  name text not null constraint shortlists_name_required check (char_length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shortlists_curator_id_idx on kofi.shortlists (curator_id);
create trigger shortlists_touch before update on kofi.shortlists
  for each row execute function kofi.touch_updated_at();

create table kofi.shortlist_items (
  shortlist_id uuid not null references kofi.shortlists (id) on delete cascade,
  artwork_id uuid not null references kofi.artworks (id) on delete cascade,
  note text,
  added_at timestamptz not null default now(),
  primary key (shortlist_id, artwork_id)
);
create index shortlist_items_artwork_id_idx on kofi.shortlist_items (artwork_id);

-- ------------------------------------------------------------ inquiries ------
-- A controlled introduction request. Never carries artist contact fields.
create table kofi.inquiries (
  id uuid primary key default gen_random_uuid(),
  curator_id uuid not null references kofi.curators (id) on delete cascade,
  artist_id uuid not null references kofi.artists (id) on delete cascade,
  artwork_id uuid references kofi.artworks (id) on delete set null,
  message text not null constraint inquiries_message_length check (char_length(btrim(message)) >= 20),
  status kofi.inquiry_status not null default 'pending',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  staff_note text,
  updated_at timestamptz not null default now()
);
create index inquiries_artist_id_idx on kofi.inquiries (artist_id);
create index inquiries_curator_id_idx on kofi.inquiries (curator_id);
create index inquiries_status_idx on kofi.inquiries (status);
create trigger inquiries_touch before update on kofi.inquiries
  for each row execute function kofi.touch_updated_at();

-- ------------------------------------------------------------ documents ------
-- file_ref is the object path inside the private `vault` bucket
-- ('<artist_id>/<document_id>'). It is never a public URL.
create table kofi.documents (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references kofi.artists (id) on delete cascade,
  artwork_id uuid references kofi.artworks (id) on delete set null,
  type kofi.document_type not null default 'other',
  title text not null constraint documents_title_required check (char_length(btrim(title)) > 0),
  custodian text not null default '',
  date date,
  file_ref text not null unique,
  file_name text not null,
  size_bytes bigint not null constraint documents_size_limit check (size_bytes >= 0 and size_bytes <= 10485760),
  visibility kofi.visibility not null default 'private'
    constraint documents_visibility_allowed check (visibility in ('private', 'kofi')),
  created_at timestamptz not null default now()
);
create index documents_artist_id_idx on kofi.documents (artist_id);
create index documents_artwork_id_idx on kofi.documents (artwork_id);
create index documents_visibility_idx on kofi.documents (visibility);

-- ------------------------------------------------------------- consents ------
-- Append-only. No foreign keys on purpose: the record must outlive the
-- profile/artist rows it refers to.
create table kofi.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  artist_id uuid,
  version text not null constraint consents_version_required check (char_length(btrim(version)) > 0),
  accepted_at timestamptz not null default now()
);
create index consents_user_id_idx on kofi.consents (user_id);
create trigger consents_append_only before update or delete on kofi.consents
  for each row execute function kofi.forbid_mutation();
create trigger consents_no_truncate before truncate on kofi.consents
  for each statement execute function kofi.forbid_mutation();

-- --------------------------------------------------------- audit_events ------
-- Append-only. Written only by kofi.write_audit (triggers + RPCs) and
-- kofi.log_audit(). No foreign keys: entries outlive the entities.
create table kofi.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id text not null,
  actor_role kofi.role not null,
  actor_name text not null,
  action text not null constraint audit_events_action_known check (action in (
    'artist.create', 'artist.update', 'artist.status', 'artist.export', 'artist.consent',
    'artwork.create', 'artwork.update', 'artwork.delete', 'artwork.visibility',
    'document.add', 'document.remove', 'document.open', 'private.view',
    'curator.request', 'curator.status',
    'shortlist.create', 'shortlist.add', 'shortlist.remove', 'shortlist.delete',
    'inquiry.create', 'inquiry.status'
  )),
  entity_type text not null constraint audit_events_entity_known check (entity_type in (
    'artist', 'artwork', 'document', 'curator', 'shortlist', 'inquiry'
  )),
  entity_id text not null,
  at timestamptz not null default now(),
  consent_version text,
  meta jsonb
);
create index audit_events_at_idx on kofi.audit_events (at desc);
create index audit_events_entity_idx on kofi.audit_events (entity_type, entity_id);
create index audit_events_actor_action_idx on kofi.audit_events (actor_id, action, at desc);
create trigger audit_events_append_only before update or delete on kofi.audit_events
  for each row execute function kofi.forbid_mutation();
create trigger audit_events_no_truncate before truncate on kofi.audit_events
  for each statement execute function kofi.forbid_mutation();
