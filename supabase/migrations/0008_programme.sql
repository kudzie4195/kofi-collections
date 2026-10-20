-- =============================================================================
-- Kofi Collections — 0008 the programme
--
-- Exhibitions, open calls, events and journal stories (authored by Kofi), and
-- the two flows that hang off them: artist applications to open calls and
-- collector ("buyer") inquiries routed through Kofi. Mirrors the "Programme"
-- section of src/domain/types.ts and the rules in src/domain/programme.ts.
--
-- Everything is in schema `kofi`. Outside it this migration only ADDS:
--   * one storage bucket row, 'kofi-programme' (public; programme images), and
--     four storage.objects policies named "kofi programme …";
--   * six kofi.* tables to the supabase_realtime publication (as 0006 does).
-- Nothing in `public` (or any other schema) is created, altered, granted or
-- revoked. Existing buckets and policies are not touched.
--
-- Idempotent: safe to run again (create … if not exists, create or replace,
-- drop … if exists + create for policies/triggers). Runs in one transaction.
--
-- Access model (least privilege, same style as 0002/0003):
--   programme tables   RLS select: published OR kofi.is_admin(); writes: admin
--                      only (RLS). anon/authenticated may SELECT every column
--                      except artwork_ids; works are read through the views
--                      kofi.exhibitions_visible / kofi.stories_visible, whose
--                      artwork_ids are filtered server-side to the works the
--                      caller may see (kofi.artwork_visible), keeping order.
--   applications       no table writes for any API role — RPCs only
--                      (submit_application / withdraw_application /
--                      set_application_status). authenticated may SELECT every
--                      column except staff_note (RLS: own rows or admin); the
--                      view kofi.applications_visible adds staff_note for admins
--                      only plus the call title/deadline and artist name.
--   buyer_inquiries    anon: no table access at all. Insert only through
--                      submit_buyer_inquiry() (anon + authenticated); admins
--                      read through kofi.buyer_inquiries_visible and change
--                      status through set_buyer_inquiry_status().
--
-- Error conventions (same as 0005): 42501 → ForbiddenError, P0002 →
-- NotFoundError, 22023 + HINT = form field → ValidationError. Messages are the
-- exact strings src/domain/programme.ts produces, so both data modes show the
-- same copy. Named CHECK constraints map to messages in
-- src/data/supabase/errors.ts.
-- =============================================================================

begin;

-- ------------------------------------------------------ migration ledger -----
create table if not exists kofi.applied_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
alter table kofi.applied_migrations enable row level security;
revoke all on kofi.applied_migrations from anon, authenticated;

-- ---------------------------------------------------------------- enums ------
do $$
begin
  if to_regtype('kofi.application_status') is null then
    create type kofi.application_status as enum ('submitted', 'shortlisted', 'accepted', 'declined', 'withdrawn');
  end if;
  if to_regtype('kofi.buyer_inquiry_status') is null then
    create type kofi.buyer_inquiry_status as enum ('new', 'in progress', 'closed');
  end if;
  if to_regtype('kofi.event_kind') is null then
    create type kofi.event_kind as enum ('opening', 'talk', 'studio visit', 'workshop', 'social');
  end if;
  if to_regtype('kofi.story_kind') is null then
    create type kofi.story_kind as enum ('interview', 'studio visit', 'essay', 'news');
  end if;
  if to_regtype('kofi.buyer_intent') is null then
    create type kofi.buyer_intent as enum ('purchase', 'commission', 'placement', 'exhibition', 'other');
  end if;
end $$;

-- Field limits are the mock data source's (cleanExhibition / cleanOpenCall /
-- cleanEvent / cleanStory in src/data/mock/MockDataSource.ts): titles 160,
-- summaries 600, bodies 20 000, links 2 000, image description 300.
-- ------------------------------------------------- shape checks (pure) ------
-- Each returns true/false, never NULL (a NULL CHECK result would pass).
-- ProgrammeImage.src: an inline data:image/ URL, an object in the
-- kofi-programme bucket, or a photograph bundled with the app (/art/<file>).
create or replace function kofi.programme_image_src_ok(p jsonb) returns boolean
language sql immutable set search_path = kofi, public as $$
  select p is null or coalesce((
    jsonb_typeof(p) = 'object'
    and jsonb_typeof(p -> 'src') = 'string'
    and char_length(p ->> 'src') <= 8620000
    and (
      (p ->> 'src') like 'data:image/%'
      or (p ->> 'src') ~ '^storage:kofi-programme/[A-Za-z0-9_./-]+$'
      or (p ->> 'src') ~ '^/art/[A-Za-z0-9_.-]+$'
    )
    and (p ->> 'src') not like '%..%'
  ), false)
$$;

-- ProgrammeImage.alt is required (screen readers); credit optional.
create or replace function kofi.programme_image_alt_ok(p jsonb) returns boolean
language sql immutable set search_path = kofi, public as $$
  select p is null or coalesce((
    jsonb_typeof(p -> 'alt') = 'string'
    and char_length(btrim(p ->> 'alt')) between 1 and 300
    and (p -> 'credit' is null or jsonb_typeof(p -> 'credit') = 'null'
         or (jsonb_typeof(p -> 'credit') = 'string' and char_length(p ->> 'credit') <= 160))
  ), false)
$$;

-- Venue { name, address?, city }.
create or replace function kofi.venue_ok(p jsonb) returns boolean
language sql immutable set search_path = kofi, public as $$
  select p is null or coalesce((
    jsonb_typeof(p) = 'object'
    and jsonb_typeof(p -> 'name') = 'string' and char_length(btrim(p ->> 'name')) between 1 and 160
    and jsonb_typeof(p -> 'city') = 'string' and char_length(btrim(p ->> 'city')) between 1 and 120
    and (p -> 'address' is null or jsonb_typeof(p -> 'address') = 'null'
         or (jsonb_typeof(p -> 'address') = 'string' and char_length(p ->> 'address') <= 200))
  ), false)
$$;

create or replace function kofi.http_url_ok(p text) returns boolean
language sql immutable set search_path = kofi, public as $$
  select p is null or coalesce(p ~* '^https?://[^\s]+$' and char_length(p) <= 2000, false)
$$;

-- --------------------------------------------------------- exhibitions -------
create table if not exists kofi.exhibitions (
  id uuid primary key default gen_random_uuid(),
  title text not null
    constraint exhibitions_title_required check (char_length(btrim(title)) >= 1)
    constraint exhibitions_title_length check (char_length(btrim(title)) <= 160),
  subtitle text constraint exhibitions_subtitle_length check (subtitle is null or char_length(btrim(subtitle)) <= 160),
  starts_on date not null,
  ends_on date,
  venue jsonb constraint exhibitions_venue_shape check (kofi.venue_ok(venue)),
  summary text not null
    constraint exhibitions_summary_required check (char_length(btrim(summary)) >= 1)
    constraint exhibitions_summary_length check (char_length(btrim(summary)) <= 600),
  body text not null default '' constraint exhibitions_body_length check (char_length(btrim(body)) <= 20000),
  image jsonb
    constraint exhibitions_image_src check (kofi.programme_image_src_ok(image))
    constraint exhibitions_image_alt check (kofi.programme_image_alt_ok(image)),
  artwork_ids uuid[] not null default '{}'
    constraint exhibitions_artworks_limit check (cardinality(artwork_ids) <= 60 and array_position(artwork_ids, null) is null),
  external_url text constraint exhibitions_external_url_scheme check (kofi.http_url_ok(external_url)),
  curated_by text constraint exhibitions_curated_by_length check (curated_by is null or char_length(btrim(curated_by)) <= 160),
  sample boolean not null default false,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exhibitions_dates_order check (ends_on is null or ends_on >= starts_on)
);
create index if not exists exhibitions_starts_on_idx on kofi.exhibitions (starts_on);
create index if not exists exhibitions_published_idx on kofi.exhibitions (published);

-- ---------------------------------------------------------- open_calls -------
create table if not exists kofi.open_calls (
  id uuid primary key default gen_random_uuid(),
  title text not null
    constraint open_calls_title_required check (char_length(btrim(title)) >= 1)
    constraint open_calls_title_length check (char_length(btrim(title)) <= 160),
  partner text constraint open_calls_partner_length check (partner is null or char_length(btrim(partner)) <= 160),
  summary text not null
    constraint open_calls_summary_required check (char_length(btrim(summary)) >= 1)
    constraint open_calls_summary_length check (char_length(btrim(summary)) <= 600),
  body text not null default '' constraint open_calls_body_length check (char_length(btrim(body)) <= 20000),
  eligibility text not null
    constraint open_calls_eligibility_required check (char_length(btrim(eligibility)) >= 1)
    constraint open_calls_eligibility_length check (char_length(btrim(eligibility)) <= 600),
  mediums kofi.medium[] not null default '{}'
    constraint open_calls_mediums_no_null check (array_position(mediums, null) is null),
  opens_on date not null,
  deadline date,
  max_works integer not null default 3 constraint open_calls_max_works_range check (max_works between 1 and 10),
  fee text not null
    constraint open_calls_fee_required check (char_length(btrim(fee)) >= 1)
    constraint open_calls_fee_length check (char_length(btrim(fee)) <= 160),
  award text constraint open_calls_award_length check (award is null or char_length(btrim(award)) <= 600),
  image jsonb
    constraint open_calls_image_src check (kofi.programme_image_src_ok(image))
    constraint open_calls_image_alt check (kofi.programme_image_alt_ok(image)),
  external_url text constraint open_calls_external_url_scheme check (kofi.http_url_ok(external_url)),
  exhibition_id uuid references kofi.exhibitions (id) on delete set null,
  sample boolean not null default false,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint open_calls_dates_order check (deadline is null or deadline >= opens_on)
);
create index if not exists open_calls_opens_on_idx on kofi.open_calls (opens_on);
create index if not exists open_calls_exhibition_id_idx on kofi.open_calls (exhibition_id);

-- -------------------------------------------------------------- events -------
create table if not exists kofi.events (
  id uuid primary key default gen_random_uuid(),
  title text not null
    constraint events_title_required check (char_length(btrim(title)) >= 1)
    constraint events_title_length check (char_length(btrim(title)) <= 160),
  kind kofi.event_kind not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  venue jsonb constraint events_venue_shape check (kofi.venue_ok(venue)),
  summary text not null
    constraint events_summary_required check (char_length(btrim(summary)) >= 1)
    constraint events_summary_length check (char_length(btrim(summary)) <= 600),
  rsvp_url text constraint events_rsvp_url_scheme check (kofi.http_url_ok(rsvp_url)),
  exhibition_id uuid references kofi.exhibitions (id) on delete set null,
  sample boolean not null default false,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_times_order check (ends_at is null or ends_at >= starts_at)
);
create index if not exists events_starts_at_idx on kofi.events (starts_at);
create index if not exists events_exhibition_id_idx on kofi.events (exhibition_id);

-- ------------------------------------------------------------- stories -------
create table if not exists kofi.stories (
  id uuid primary key default gen_random_uuid(),
  title text not null
    constraint stories_title_required check (char_length(btrim(title)) >= 1)
    constraint stories_title_length check (char_length(btrim(title)) <= 160),
  dek text not null
    constraint stories_dek_required check (char_length(btrim(dek)) >= 1)
    constraint stories_dek_length check (char_length(btrim(dek)) <= 600),
  kind kofi.story_kind not null,
  body text not null
    constraint stories_body_required check (char_length(btrim(body)) >= 1)
    constraint stories_body_length check (char_length(btrim(body)) <= 20000),
  author text not null
    constraint stories_author_required check (char_length(btrim(author)) >= 1)
    constraint stories_author_length check (char_length(btrim(author)) <= 160),
  published_on date not null,
  artist_id uuid references kofi.artists (id) on delete set null,
  artwork_ids uuid[] not null default '{}'
    constraint stories_artworks_limit check (cardinality(artwork_ids) <= 60 and array_position(artwork_ids, null) is null),
  image jsonb
    constraint stories_image_src check (kofi.programme_image_src_ok(image))
    constraint stories_image_alt check (kofi.programme_image_alt_ok(image)),
  sample boolean not null default false,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists stories_published_on_idx on kofi.stories (published_on desc);
create index if not exists stories_artist_id_idx on kofi.stories (artist_id);

-- -------------------------------------------------------- applications -------
-- Written only by the RPCs below. One live (non-withdrawn) application per
-- artist per call is also enforced by a partial unique index, so two parallel
-- submissions cannot both succeed.
create table if not exists kofi.applications (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references kofi.open_calls (id) on delete restrict,
  artist_id uuid not null references kofi.artists (id) on delete cascade,
  artwork_ids uuid[] not null
    constraint applications_artworks_count check (cardinality(artwork_ids) between 1 and 10 and array_position(artwork_ids, null) is null),
  statement text not null constraint applications_statement_length check (char_length(btrim(statement)) between 20 and 2000),
  status kofi.application_status not null default 'submitted',
  decision_note text constraint applications_decision_note_length check (decision_note is null or char_length(decision_note) <= 2000),
  staff_note text constraint applications_staff_note_length check (staff_note is null or char_length(staff_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists applications_call_id_idx on kofi.applications (call_id);
create index if not exists applications_artist_id_idx on kofi.applications (artist_id);
create unique index if not exists applications_one_live_per_call_idx
  on kofi.applications (call_id, artist_id) where status <> 'withdrawn';

-- ----------------------------------------------------- buyer_inquiries -------
-- Collector inquiries. Never readable by anon; written only by
-- submit_buyer_inquiry(). consented_at records the "Kofi may email me" tick.
create table if not exists kofi.buyer_inquiries (
  id uuid primary key default gen_random_uuid(),
  artwork_id uuid references kofi.artworks (id) on delete set null,
  artist_id uuid references kofi.artists (id) on delete set null,
  name text not null constraint buyer_inquiries_name_length check (char_length(btrim(name)) between 2 and 120),
  email text not null constraint buyer_inquiries_email_format check (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' and char_length(email) <= 200),
  organization text constraint buyer_inquiries_organization_length check (organization is null or char_length(organization) <= 160),
  intent kofi.buyer_intent not null,
  message text not null constraint buyer_inquiries_message_length check (char_length(btrim(message)) between 10 and 2000),
  status kofi.buyer_inquiry_status not null default 'new',
  staff_note text constraint buyer_inquiries_staff_note_length check (staff_note is null or char_length(staff_note) <= 2000),
  consented_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists buyer_inquiries_email_recent_idx on kofi.buyer_inquiries (lower(email), created_at desc);
create index if not exists buyer_inquiries_status_idx on kofi.buyer_inquiries (status);
create index if not exists buyer_inquiries_artwork_id_idx on kofi.buyer_inquiries (artwork_id);

-- -------------------------------------------------- audit vocabulary --------
alter table kofi.audit_events drop constraint if exists audit_events_action_known;
alter table kofi.audit_events add constraint audit_events_action_known check (action in (
  'artist.create', 'artist.update', 'artist.status', 'artist.export', 'artist.consent',
  'artwork.create', 'artwork.update', 'artwork.delete', 'artwork.visibility',
  'document.add', 'document.remove', 'document.open', 'private.view',
  'curator.request', 'curator.status',
  'shortlist.create', 'shortlist.add', 'shortlist.remove', 'shortlist.delete',
  'inquiry.create', 'inquiry.status',
  'programme.save', 'programme.delete',
  'application.submit', 'application.withdraw', 'application.status',
  'buyer_inquiry.submit', 'buyer_inquiry.status'
));
alter table kofi.audit_events drop constraint if exists audit_events_entity_known;
alter table kofi.audit_events add constraint audit_events_entity_known check (entity_type in (
  'artist', 'artwork', 'document', 'curator', 'shortlist', 'inquiry',
  'exhibition', 'open_call', 'event', 'story', 'application', 'buyer_inquiry'
));

-- ------------------------------------------------------------- triggers -----
drop trigger if exists exhibitions_touch on kofi.exhibitions;
create trigger exhibitions_touch before update on kofi.exhibitions for each row execute function kofi.touch_updated_at();
drop trigger if exists open_calls_touch on kofi.open_calls;
create trigger open_calls_touch before update on kofi.open_calls for each row execute function kofi.touch_updated_at();
drop trigger if exists events_touch on kofi.events;
create trigger events_touch before update on kofi.events for each row execute function kofi.touch_updated_at();
drop trigger if exists stories_touch on kofi.stories;
create trigger stories_touch before update on kofi.stories for each row execute function kofi.touch_updated_at();
drop trigger if exists applications_touch on kofi.applications;
create trigger applications_touch before update on kofi.applications for each row execute function kofi.touch_updated_at();
drop trigger if exists buyer_inquiries_touch on kofi.buyer_inquiries;
create trigger buyer_inquiries_touch before update on kofi.buyer_inquiries for each row execute function kofi.touch_updated_at();

-- created_at is set once; the API column grants already exclude it, this also
-- covers trusted code paths.
create or replace function kofi.programme_keep_created() returns trigger
language plpgsql set search_path = kofi, public as $$
begin
  new.id := old.id;
  new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists exhibitions_keep_created on kofi.exhibitions;
create trigger exhibitions_keep_created before update on kofi.exhibitions for each row execute function kofi.programme_keep_created();
drop trigger if exists open_calls_keep_created on kofi.open_calls;
create trigger open_calls_keep_created before update on kofi.open_calls for each row execute function kofi.programme_keep_created();
drop trigger if exists events_keep_created on kofi.events;
create trigger events_keep_created before update on kofi.events for each row execute function kofi.programme_keep_created();
drop trigger if exists stories_keep_created on kofi.stories;
create trigger stories_keep_created before update on kofi.stories for each row execute function kofi.programme_keep_created();

-- Programme writes are audited server-side: programme.save / programme.delete,
-- entity type from the trigger argument. An update that only clears a
-- reference because the referenced row was deleted (ON DELETE SET NULL) is not
-- a staff action and is not logged.
create or replace function kofi.programme_audit() returns trigger
language plpgsql security definer set search_path = kofi, public as $$
declare
  fk_cols text[] := array['exhibition_id', 'artist_id', 'updated_at'];
begin
  if tg_op = 'DELETE' then
    perform kofi.write_audit('programme.delete', tg_argv[0], old.id::text, jsonb_build_object('title', old.title));
    return null;
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - fk_cols) = (to_jsonb(old) - fk_cols) then
    return null;
  end if;
  perform kofi.write_audit('programme.save', tg_argv[0], new.id::text,
    jsonb_build_object(
      'title', new.title,
      'created', tg_op = 'INSERT',
      'published', new.published,
      'publishedChanged', tg_op = 'UPDATE' and new.published is distinct from old.published));
  return null;
end $$;
drop trigger if exists exhibitions_audit on kofi.exhibitions;
create trigger exhibitions_audit after insert or update or delete on kofi.exhibitions
  for each row execute function kofi.programme_audit('exhibition');
drop trigger if exists open_calls_audit on kofi.open_calls;
create trigger open_calls_audit after insert or update or delete on kofi.open_calls
  for each row execute function kofi.programme_audit('open_call');
drop trigger if exists events_audit on kofi.events;
create trigger events_audit after insert or update or delete on kofi.events
  for each row execute function kofi.programme_audit('event');
drop trigger if exists stories_audit on kofi.stories;
create trigger stories_audit after insert or update or delete on kofi.stories
  for each row execute function kofi.programme_audit('story');

-- Artists never lose a submitted application: a call with applications cannot
-- be deleted (it can be unpublished). Same message as the mock data source.
create or replace function kofi.open_calls_guard_delete() returns trigger
language plpgsql security definer set search_path = kofi, public as $$
begin
  if exists (select 1 from kofi.applications a where a.call_id = old.id) then
    raise exception 'This call has applications. Unpublish it instead.'
      using errcode = '22023', hint = 'call';
  end if;
  return old;
end $$;
drop trigger if exists open_calls_guard_delete on kofi.open_calls;
create trigger open_calls_guard_delete before delete on kofi.open_calls
  for each row execute function kofi.open_calls_guard_delete();

-- artwork_ids has no foreign key (it is an array): check every id exists when
-- the list is written, like the mock's checkProgrammeRefs(). Duplicates are
-- dropped, order kept.
create or replace function kofi.programme_check_artworks() returns trigger
language plpgsql security definer set search_path = kofi, public as $$
begin
  if exists (select 1 from unnest(new.artwork_ids) x where not exists (select 1 from kofi.artworks w where w.id = x)) then
    raise exception 'One of the attached works no longer exists.' using errcode = '22023', hint = 'artworkIds';
  end if;
  new.artwork_ids := array(
    select u.x from unnest(new.artwork_ids) with ordinality as u (x, o)
    group by u.x order by min(u.o)
  );
  return new;
end $$;
drop trigger if exists exhibitions_check_artworks on kofi.exhibitions;
create trigger exhibitions_check_artworks before insert or update of artwork_ids on kofi.exhibitions
  for each row execute function kofi.programme_check_artworks();
drop trigger if exists stories_check_artworks on kofi.stories;
create trigger stories_check_artworks before insert or update of artwork_ids on kofi.stories
  for each row execute function kofi.programme_check_artworks();

-- ----------------------------------------------- read helpers (definer) -----
-- The gallery's rule for a work appearing on a public surface (the mock's
-- discoverable(), same as listArtworks): Kofi admins see every work; everyone
-- else only works they may see (artwork_visible) that are not drafts or
-- Kofi-only, by an approved artist. Owners do not see their own drafts here.
create or replace function kofi.artwork_discoverable(p_artwork_id uuid) returns boolean
language sql stable security definer set search_path = kofi, public as $$
  select coalesce((
    select kofi.is_admin()
        or (kofi.artwork_visible(w.id) and w.visibility not in ('private', 'kofi') and a.status = 'approved')
    from kofi.artworks w join kofi.artists a on a.id = w.artist_id
    where w.id = p_artwork_id
  ), false)
$$;

-- artworkIds as the caller may see them: undiscoverable works are dropped
-- (never stubbed), order kept. '{}' when the caller may not see the item.
create or replace function kofi.programme_artwork_ids(p_kind text, p_id uuid) returns uuid[]
language plpgsql stable security definer set search_path = kofi, public as $$
declare
  v_ids uuid[];
  v_published boolean;
begin
  if p_kind = 'exhibition' then
    select e.artwork_ids, e.published into v_ids, v_published from kofi.exhibitions e where e.id = p_id;
  elsif p_kind = 'story' then
    select s.artwork_ids, s.published into v_ids, v_published from kofi.stories s where s.id = p_id;
  else
    return '{}'::uuid[];
  end if;
  if v_ids is null or not (v_published or kofi.is_admin()) then
    return '{}'::uuid[];
  end if;
  return array(
    select u.x from unnest(v_ids) with ordinality as u (x, o)
    where kofi.artwork_discoverable(u.x)
    order by u.o
  );
end $$;

-- Labels + the Kofi-only note for one application. No row unless the caller
-- is the applying artist or a Kofi admin; staff_note is admin-only.
create or replace function kofi.application_labels(p_id uuid)
returns table (staff_note text, call_title text, call_deadline date, artist_working_name text)
language sql stable security definer set search_path = kofi, public as $$
  select
    case when kofi.is_admin() then a.staff_note end,
    c.title,
    c.deadline,
    ar.working_name
  from kofi.applications a
  join kofi.open_calls c on c.id = a.call_id
  join kofi.artists ar on ar.id = a.artist_id
  where a.id = p_id
    and (kofi.is_admin() or (a.artist_id = kofi.my_artist_id()))
$$;

-- ------------------------------------------------------------------ views ---
create or replace view kofi.exhibitions_visible with (security_invoker = true) as
select
  e.id, e.title, e.subtitle, e.starts_on, e.ends_on, e.venue, e.summary, e.body, e.image,
  kofi.programme_artwork_ids('exhibition', e.id) as artwork_ids,
  e.external_url, e.curated_by, e.sample, e.published, e.created_at, e.updated_at
from kofi.exhibitions e;

-- artist_id is dropped when the caller may not see that artist's profile.
create or replace view kofi.stories_visible with (security_invoker = true) as
select
  s.id, s.title, s.dek, s.kind, s.body, s.author, s.published_on,
  case when s.artist_id is not null and kofi.artist_visible(s.artist_id) then s.artist_id end as artist_id,
  kofi.programme_artwork_ids('story', s.id) as artwork_ids,
  s.image, s.sample, s.published, s.created_at, s.updated_at
from kofi.stories s;

-- exhibition_id is dropped when the caller may not see that exhibition (a
-- draft): the subquery runs under the caller's RLS on kofi.exhibitions.
create or replace view kofi.open_calls_visible with (security_invoker = true) as
select
  c.id, c.title, c.partner, c.summary, c.body, c.eligibility, c.mediums, c.opens_on, c.deadline,
  c.max_works, c.fee, c.award, c.image, c.external_url,
  (select e.id from kofi.exhibitions e where e.id = c.exhibition_id) as exhibition_id,
  c.sample, c.published, c.created_at, c.updated_at
from kofi.open_calls c;

create or replace view kofi.events_visible with (security_invoker = true) as
select
  v.id, v.title, v.kind, v.starts_at, v.ends_at, v.venue, v.summary, v.rsvp_url,
  (select e.id from kofi.exhibitions e where e.id = v.exhibition_id) as exhibition_id,
  v.sample, v.published, v.created_at, v.updated_at
from kofi.events v;

create or replace view kofi.applications_visible with (security_invoker = true) as
select
  a.id, a.call_id, a.artist_id, a.artwork_ids, a.statement, a.status, a.decision_note,
  l.staff_note, a.created_at, a.updated_at, a.decided_at,
  l.call_title, l.call_deadline, l.artist_working_name
from kofi.applications a
left join lateral kofi.application_labels(a.id) l on true;

-- Work title / artist name for the admin inbox. A definer helper (admin-only,
-- like inquiry_labels in 0003), so the view does not depend on the caller's
-- direct privileges on kofi.artworks / kofi.artists.
create or replace function kofi.buyer_inquiry_labels(p_id uuid)
returns table (artwork_title text, artist_working_name text)
language sql stable security definer set search_path = kofi, public as $$
  select w.title, ar.working_name
  from kofi.buyer_inquiries b
  left join kofi.artworks w on w.id = b.artwork_id
  left join kofi.artists ar on ar.id = b.artist_id
  where b.id = p_id and kofi.is_admin()
$$;

create or replace view kofi.buyer_inquiries_visible with (security_invoker = true) as
select
  b.id, b.artwork_id, b.artist_id, b.name, b.email, b.organization, b.intent, b.message,
  b.status, b.staff_note, b.consented_at, b.created_at, b.updated_at,
  l.artwork_title,
  l.artist_working_name
from kofi.buyer_inquiries b
left join lateral kofi.buyer_inquiry_labels(b.id) l on true;

-- ------------------------------------------------------------------- RPCs ---

-- Messages and their order are the mock data source's (src/data/mock/
-- MockDataSource.ts + src/domain/programme.ts). Curly quotes, apostrophes and
-- dashes are written with chr() so the result does not depend on the client
-- encoding the migration is run with.

-- validateApplication() server-side. Only the artist role applies.
create or replace function kofi.submit_application(p_call uuid, p_artwork_ids uuid[], p_statement text) returns uuid
language plpgsql volatile security definer set search_path = kofi, public as $$
declare
  a kofi.artists%rowtype;
  c kofi.open_calls%rowtype;
  w record;
  v_wid uuid;
  v_today date := (now() at time zone 'America/New_York')::date;
  v_ids uuid[] := coalesce(p_artwork_ids, '{}'::uuid[]);
  v_statement text := regexp_replace(coalesce(p_statement, ''), '^\s+|\s+$', '', 'g');
  v_id uuid;
begin
  select * into a from kofi.artists where id = kofi.my_artist_id();
  if not found then
    raise exception 'Sign in as an artist to apply.' using errcode = '42501';
  end if;
  -- A draft call does not exist for an artist (canSeeProgramme).
  select * into c from kofi.open_calls where id = p_call and published;
  if not found then
    raise exception 'Open call not found.' using errcode = 'P0002';
  end if;
  if c.external_url is not null then
    raise exception '%', 'Applications for this call are taken on the partner' || chr(8217) || 's form.' using errcode = '22023', hint = 'call';
  end if;
  if v_today < c.opens_on then
    raise exception 'This call opens on %.', to_char(c.opens_on, 'Mon FMDD, YYYY') using errcode = '22023', hint = 'call';
  end if;
  if c.deadline is not null and v_today > c.deadline then
    raise exception 'This call has closed.' using errcode = '22023', hint = 'call';
  end if;
  if a.status = 'paused' then
    raise exception 'Your profile is paused. Contact Kofi to reopen it before applying.' using errcode = '22023', hint = 'artist';
  end if;
  if a.consent_version is null then
    raise exception 'Accept the data consent in your studio before applying.' using errcode = '22023', hint = 'artist';
  end if;
  if exists (select 1 from kofi.applications x where x.call_id = c.id and x.artist_id = a.id and x.status <> 'withdrawn') then
    raise exception 'You have already applied to this call.' using errcode = '22023', hint = 'call';
  end if;
  if array_position(v_ids, null) is not null then
    raise exception 'You can only attach your own works.' using errcode = '22023', hint = 'artworkIds';
  end if;
  if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then
    raise exception 'Each work can only be attached once.' using errcode = '22023', hint = 'artworkIds';
  end if;
  if cardinality(v_ids) = 0 then
    raise exception 'Attach at least one work.' using errcode = '22023', hint = 'artworkIds';
  end if;
  if cardinality(v_ids) > c.max_works then
    raise exception 'This call accepts up to % %.', c.max_works, case when c.max_works = 1 then 'work' else 'works' end
      using errcode = '22023', hint = 'artworkIds';
  end if;
  foreach v_wid in array v_ids loop
    select x.id, x.artist_id, x.visibility, x.title into w from kofi.artworks x where x.id = v_wid;
    if not found or w.artist_id <> a.id then
      raise exception 'You can only attach your own works.' using errcode = '22023', hint = 'artworkIds';
    end if;
    if w.visibility = 'private' then
      raise exception '%', chr(8220) || w.title || chr(8221) || ' is set to Only me. Change it to Kofi team only or wider to attach it.'
        using errcode = '22023', hint = 'artworkIds';
    end if;
  end loop;
  if char_length(v_statement) < 20 then
    raise exception 'Write at least a sentence or two about why these works fit the call.' using errcode = '22023', hint = 'statement';
  end if;
  if char_length(v_statement) > 2000 then
    raise exception 'Keep the statement under 2000 characters.' using errcode = '22023', hint = 'statement';
  end if;

  begin
    insert into kofi.applications (call_id, artist_id, artwork_ids, statement)
    values (c.id, a.id, v_ids, v_statement)
    returning id into v_id;
  exception when unique_violation then
    -- A parallel submission won the race (one live application per call).
    raise exception 'You have already applied to this call.' using errcode = '22023', hint = 'call';
  end;
  perform kofi.write_audit('application.submit', 'application', v_id::text,
    jsonb_build_object('callId', c.id, 'works', cardinality(v_ids)));
  return v_id;
end $$;

-- canMoveApplication(from, 'withdrawn', 'artist').
create or replace function kofi.withdraw_application(p_id uuid) returns void
language plpgsql volatile security definer set search_path = kofi, public as $$
declare
  v_artist uuid := kofi.my_artist_id();
  x kofi.applications%rowtype;
begin
  if v_artist is null then
    raise exception 'Sign in as an artist to apply.' using errcode = '42501';
  end if;
  select * into x from kofi.applications where id = p_id for update;
  if not found then
    raise exception 'Application not found.' using errcode = 'P0002';
  end if;
  if x.artist_id <> v_artist then
    raise exception 'You can only withdraw your own applications.' using errcode = '42501';
  end if;
  if x.status not in ('submitted', 'shortlisted') then
    raise exception 'This application has been decided and can no longer be withdrawn.' using errcode = '22023', hint = 'status';
  end if;
  update kofi.applications set status = 'withdrawn' where id = x.id;
  perform kofi.write_audit('application.withdraw', 'application', x.id::text, jsonb_build_object('callId', x.call_id));
end $$;

-- canMoveApplication(from, to, 'admin'). Notes: NULL keeps the current note,
-- '' clears it, anything else is stored trimmed.
create or replace function kofi.set_application_status(
  p_id uuid, p_status kofi.application_status, p_decision_note text default null, p_staff_note text default null
) returns void
language plpgsql volatile security definer set search_path = kofi, public as $$
declare
  x kofi.applications%rowtype;
begin
  if not kofi.is_admin() then
    raise exception 'Kofi staff only.' using errcode = '42501';
  end if;
  select * into x from kofi.applications where id = p_id for update;
  if not found then
    raise exception 'Application not found.' using errcode = 'P0002';
  end if;
  if x.status = 'withdrawn' then
    raise exception 'The artist withdrew this application.' using errcode = '22023', hint = 'status';
  end if;
  if p_status = x.status or p_status not in ('shortlisted', 'accepted', 'declined') then
    raise exception 'This application cannot be moved from % to %.', x.status, p_status using errcode = '22023', hint = 'status';
  end if;
  if char_length(coalesce(p_decision_note, '')) > 2000 then
    raise exception 'Keep notes under 2000 characters.' using errcode = '22023', hint = 'decisionNote';
  end if;
  if char_length(coalesce(p_staff_note, '')) > 2000 then
    raise exception 'Keep notes under 2000 characters.' using errcode = '22023', hint = 'staffNote';
  end if;
  update kofi.applications set
    status = p_status,
    decision_note = case when p_decision_note is null then decision_note else nullif(regexp_replace(p_decision_note, '^\s+|\s+$', '', 'g'), '') end,
    staff_note = case when p_staff_note is null then staff_note else nullif(regexp_replace(p_staff_note, '^\s+|\s+$', '', 'g'), '') end,
    decided_at = case when p_status in ('accepted', 'declined') then now() else null end
  where id = x.id;
  perform kofi.write_audit('application.status', 'application', x.id::text,
    jsonb_build_object('status', p_status, 'callId', x.call_id));
end $$;

-- Anyone (incl. visitors) may send a collector inquiry. Returns only the new
-- id, nothing about the artist. Order as the mock: validateBuyerInquiry(), then
-- the work must be discoverable by the caller (artist derived here, never from
-- the client), then at most 5 per email per rolling 24 h
-- (BUYER_INQUIRY_DAILY_LIMIT).
create or replace function kofi.submit_buyer_inquiry(
  p_artwork uuid, p_name text, p_email text, p_org text, p_intent text, p_message text, p_consent boolean
) returns uuid
language plpgsql volatile security definer set search_path = kofi, public as $$
declare
  v_name text := regexp_replace(coalesce(p_name, ''), '^\s+|\s+$', '', 'g');
  v_email text := regexp_replace(coalesce(p_email, ''), '^\s+|\s+$', '', 'g');
  v_org text := nullif(regexp_replace(coalesce(p_org, ''), '^\s+|\s+$', '', 'g'), '');
  v_message text := regexp_replace(coalesce(p_message, ''), '^\s+|\s+$', '', 'g');
  v_artist uuid;
  v_recent integer;
  v_id uuid;
begin
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'Tell us your name.' using errcode = '22023', hint = 'name';
  end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or char_length(coalesce(p_email, '')) > 200 then
    raise exception 'Enter an email address we can reply to.' using errcode = '22023', hint = 'email';
  end if;
  if char_length(coalesce(p_org, '')) > 160 then
    raise exception 'Keep the organisation name under 160 characters.' using errcode = '22023', hint = 'organization';
  end if;
  if p_intent is null or p_intent not in ('purchase', 'commission', 'placement', 'exhibition', 'other') then
    raise exception 'Choose what you are asking about.' using errcode = '22023', hint = 'intent';
  end if;
  if char_length(v_message) < 10 then
    raise exception 'Add a line or two so Kofi knows how to help.' using errcode = '22023', hint = 'message';
  end if;
  if char_length(v_message) > 2000 then
    raise exception 'Keep the message under 2000 characters.' using errcode = '22023', hint = 'message';
  end if;
  if not coalesce(p_consent, false) then
    raise exception 'Tick the box so Kofi can reply to you.' using errcode = '22023', hint = 'consent';
  end if;
  if p_artwork is not null then
    if not kofi.artwork_discoverable(p_artwork) then
      raise exception 'Artwork not found.' using errcode = 'P0002';
    end if;
    select w.artist_id into v_artist from kofi.artworks w where w.id = p_artwork;
  end if;

  -- Serialize per address so parallel requests cannot slip past the limit.
  perform pg_advisory_xact_lock(hashtextextended('kofi.buyer_inquiry:' || lower(v_email), 0));
  select count(*) into v_recent from kofi.buyer_inquiries b
  where lower(b.email) = lower(v_email) and b.created_at > now() - interval '24 hours';
  if v_recent >= 5 then
    raise exception '%', 'Kofi already has your messages ' || chr(8212) || ' we' || chr(8217) || 'll reply soon.'
      using errcode = '22023', hint = 'email';
  end if;

  insert into kofi.buyer_inquiries (artwork_id, artist_id, name, email, organization, intent, message)
  values (p_artwork, v_artist, v_name, v_email, v_org, p_intent::kofi.buyer_intent, v_message)
  returning id into v_id;
  -- No email in the audit trail.
  perform kofi.write_audit('buyer_inquiry.submit', 'buyer_inquiry', v_id::text,
    jsonb_build_object('intent', p_intent, 'artworkId', p_artwork));
  return v_id;
end $$;

-- Notes: NULL keeps the current note, '' clears it.
create or replace function kofi.set_buyer_inquiry_status(
  p_id uuid, p_status kofi.buyer_inquiry_status, p_staff_note text default null
) returns void
language plpgsql volatile security definer set search_path = kofi, public as $$
declare
  v_old kofi.buyer_inquiry_status;
begin
  if not kofi.is_admin() then
    raise exception 'Kofi staff only.' using errcode = '42501';
  end if;
  select status into v_old from kofi.buyer_inquiries where id = p_id for update;
  if not found then
    raise exception 'Inquiry not found.' using errcode = 'P0002';
  end if;
  if char_length(coalesce(p_staff_note, '')) > 2000 then
    raise exception 'Keep notes under 2000 characters.' using errcode = '22023', hint = 'staffNote';
  end if;
  update kofi.buyer_inquiries set
    status = p_status,
    staff_note = case when p_staff_note is null then staff_note else nullif(regexp_replace(p_staff_note, '^\s+|\s+$', '', 'g'), '') end
  where id = p_id;
  perform kofi.write_audit('buyer_inquiry.status', 'buyer_inquiry', p_id::text,
    jsonb_build_object('status', p_status, 'noteOnly', v_old = p_status));
end $$;

-- ------------------------------------------------------------ privileges ----
-- Nothing by default (0000); grant back exactly what each role needs.
revoke all on kofi.exhibitions, kofi.open_calls, kofi.events, kofi.stories,
  kofi.applications, kofi.buyer_inquiries from anon, authenticated;
revoke all on kofi.exhibitions_visible, kofi.stories_visible, kofi.open_calls_visible, kofi.events_visible,
  kofi.applications_visible, kofi.buyer_inquiries_visible from anon, authenticated;

-- Programme: read (artwork_ids only through the *_visible views), admin writes (RLS).
grant select (id, title, subtitle, starts_on, ends_on, venue, summary, body, image,
              external_url, curated_by, sample, published, created_at, updated_at)
  on kofi.exhibitions to anon, authenticated;
grant insert (title, subtitle, starts_on, ends_on, venue, summary, body, image, artwork_ids,
              external_url, curated_by, sample, published),
      update (title, subtitle, starts_on, ends_on, venue, summary, body, image, artwork_ids,
              external_url, curated_by, sample, published),
      delete
  on kofi.exhibitions to authenticated;

grant select on kofi.open_calls to anon, authenticated;
grant insert (title, partner, summary, body, eligibility, mediums, opens_on, deadline, max_works, fee,
              award, image, external_url, exhibition_id, sample, published),
      update (title, partner, summary, body, eligibility, mediums, opens_on, deadline, max_works, fee,
              award, image, external_url, exhibition_id, sample, published),
      delete
  on kofi.open_calls to authenticated;

grant select on kofi.events to anon, authenticated;
grant insert (title, kind, starts_at, ends_at, venue, summary, rsvp_url, exhibition_id, sample, published),
      update (title, kind, starts_at, ends_at, venue, summary, rsvp_url, exhibition_id, sample, published),
      delete
  on kofi.events to authenticated;

grant select (id, title, dek, kind, body, author, published_on, artist_id, image, sample, published,
              created_at, updated_at)
  on kofi.stories to anon, authenticated;
grant insert (title, dek, kind, body, author, published_on, artist_id, artwork_ids, image, sample, published),
      update (title, dek, kind, body, author, published_on, artist_id, artwork_ids, image, sample, published),
      delete
  on kofi.stories to authenticated;

grant select on kofi.exhibitions_visible, kofi.stories_visible, kofi.open_calls_visible, kofi.events_visible to anon, authenticated;

-- Applications: read own (RLS), never staff_note directly; no writes (RPCs).
grant select (id, call_id, artist_id, artwork_ids, statement, status, decision_note,
              created_at, updated_at, decided_at)
  on kofi.applications to authenticated;
grant select on kofi.applications_visible to authenticated;

-- Buyer inquiries: admins read (RLS); no anon access, no direct writes.
grant select on kofi.buyer_inquiries to authenticated;
grant select on kofi.buyer_inquiries_visible to authenticated;

-- RPCs. Mutating ones need a session, except the collector inquiry form.
revoke execute on function kofi.submit_application(uuid, uuid[], text) from public, anon;
revoke execute on function kofi.withdraw_application(uuid) from public, anon;
revoke execute on function kofi.set_application_status(uuid, kofi.application_status, text, text) from public, anon;
revoke execute on function kofi.set_buyer_inquiry_status(uuid, kofi.buyer_inquiry_status, text) from public, anon;
revoke execute on function kofi.submit_buyer_inquiry(uuid, text, text, text, text, text, boolean) from public;
grant execute on function
  kofi.submit_application(uuid, uuid[], text),
  kofi.withdraw_application(uuid),
  kofi.set_application_status(uuid, kofi.application_status, text, text),
  kofi.set_buyer_inquiry_status(uuid, kofi.buyer_inquiry_status, text)
to authenticated;
grant execute on function kofi.submit_buyer_inquiry(uuid, text, text, text, text, text, boolean) to anon, authenticated;

-- Trigger functions (incl. the new ones) are never API-callable.
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
    where p.pronamespace = 'kofi'::regnamespace and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

grant all on kofi.applied_migrations, kofi.exhibitions, kofi.open_calls, kofi.events, kofi.stories,
  kofi.applications, kofi.buyer_inquiries, kofi.exhibitions_visible, kofi.stories_visible,
  kofi.open_calls_visible, kofi.events_visible, kofi.applications_visible, kofi.buyer_inquiries_visible
  to service_role;
grant all on all functions in schema kofi to service_role;

-- ------------------------------------------------------------------- RLS ----
alter table kofi.exhibitions enable row level security;
alter table kofi.open_calls enable row level security;
alter table kofi.events enable row level security;
alter table kofi.stories enable row level security;
alter table kofi.applications enable row level security;
alter table kofi.buyer_inquiries enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['exhibitions', 'open_calls', 'events', 'stories'] loop
    execute format('drop policy if exists %I on kofi.%I', t || '_select', t);
    execute format('drop policy if exists %I on kofi.%I', t || '_insert_admin', t);
    execute format('drop policy if exists %I on kofi.%I', t || '_update_admin', t);
    execute format('drop policy if exists %I on kofi.%I', t || '_delete_admin', t);
    execute format('create policy %I on kofi.%I for select to anon, authenticated using (published or kofi.is_admin())', t || '_select', t);
    execute format('create policy %I on kofi.%I for insert to authenticated with check (kofi.is_admin())', t || '_insert_admin', t);
    execute format('create policy %I on kofi.%I for update to authenticated using (kofi.is_admin()) with check (kofi.is_admin())', t || '_update_admin', t);
    execute format('create policy %I on kofi.%I for delete to authenticated using (kofi.is_admin())', t || '_delete_admin', t);
  end loop;
end $$;

drop policy if exists applications_select on kofi.applications;
create policy applications_select on kofi.applications for select to authenticated
  using (artist_id = kofi.my_artist_id() or kofi.is_admin());

drop policy if exists buyer_inquiries_select_admin on kofi.buyer_inquiries;
create policy buyer_inquiries_select_admin on kofi.buyer_inquiries for select to authenticated
  using (kofi.is_admin());

-- --------------------------------------------------------------- storage ----
-- Public bucket for programme images (exhibition / call / story heroes). It is
-- namespaced, and its contents are editorial images Kofi publishes; artwork
-- photographs stay in the private artwork-images bucket. Public buckets serve
-- objects at /storage/v1/object/public/kofi-programme/<path> without a policy
-- check. Only Kofi admins may upload, replace, delete or list objects; no
-- anon/authenticated SELECT policy is added, so draft images cannot be
-- enumerated through the API (their URLs contain random UUIDs).
-- Existing buckets (artwork-images, vault) and their policies are untouched.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kofi-programme', 'kofi-programme', true, 6291456, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "kofi programme admin read" on storage.objects;
drop policy if exists "kofi programme admin insert" on storage.objects;
drop policy if exists "kofi programme admin update" on storage.objects;
drop policy if exists "kofi programme admin delete" on storage.objects;
create policy "kofi programme admin read" on storage.objects for select to authenticated
  using (bucket_id = 'kofi-programme' and kofi.is_admin());
create policy "kofi programme admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'kofi-programme' and kofi.is_admin());
create policy "kofi programme admin update" on storage.objects for update to authenticated
  using (bucket_id = 'kofi-programme' and kofi.is_admin())
  with check (bucket_id = 'kofi-programme' and kofi.is_admin());
create policy "kofi programme admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'kofi-programme' and kofi.is_admin());

-- -------------------------------------------------------------- realtime ----
-- Same as 0006: add kofi.* tables to the shared publication, only if it exists.
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping realtime setup';
    return;
  end if;
  foreach t in array array['exhibitions', 'open_calls', 'events', 'stories', 'applications', 'buyer_inquiries'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'kofi' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table kofi.%I', t);
    end if;
  end loop;
end $$;

insert into kofi.applied_migrations (name) values ('0008_programme') on conflict do nothing;

commit;

notify pgrst, 'reload schema';
