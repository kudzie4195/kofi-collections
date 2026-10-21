-- =============================================================================
-- Kofi Collections — 0009 partners, auctions, payouts, reports
--
-- Mirrors the "Sales" section of src/domain/types.ts and the rules in
-- src/domain/sales.ts + src/domain/reports.ts, as the mock data source applies
-- them (src/data/mock/MockDataSource.ts): same messages, same form fields,
-- same cents arithmetic. Needs 0000-0008.
--
--   open_calls     + kind (kofi.call_kind), organizer_institution_id, terms (jsonb,
--                  shape = CallTerms, checked by kofi.call_terms_ok()).
--   lots           a selected work on an auction call; sale (jsonb) is the frozen
--                  split, written only by record_sale().
--   payouts        what Kofi owes the artist for one sale.
--
-- Everything is in schema `kofi`. Outside it this migration only ADDS one
-- storage.objects policy, "kofi programme partner insert" (verified curators
-- may upload call images under kofi-programme/open-calls/), and two kofi.*
-- tables to the supabase_realtime publication. Nothing in `public` (or any
-- other schema) is created, altered, granted or revoked.
--
-- Access model (least privilege, same style as 0002/0008):
--   partner        a verified curator whose institution is a call's
--                  organizer_institution_id (kofi.is_call_organizer()). May
--                  insert a DRAFT call for their own institution and edit it while
--                  Kofi has not published it (RLS + open_calls_sales_guard, which
--                  forces published = false / sample = false / organiser = theirs
--                  on insert and refuses publishing, re-assigning or editing a
--                  published call). Reads and decides applications to their calls
--                  (staff_note is the reviewers' note: Kofi + organiser, never the
--                  artist). Creates lots and records sales on their auction calls.
--                  Never sees payouts.
--   lots           no table writes for any API role — RPCs only (save_lot,
--                  set_lot_status, record_sale, delete_lot). authenticated may
--                  SELECT every column except `sale` (RLS: Kofi, the organiser, the
--                  lot's artist); kofi.lots_visible returns the sale (buyerRef
--                  removed for the artist) and the payout (Kofi and the artist only).
--   payouts        no table writes — set_payout_status() (Kofi only). SELECT:
--                  Kofi, or the artist it is owed to.
--   reports        kofi_report() (Kofi only) returns the report rows; the client
--                  adds the totals (domain/reports.ts, same code as mock mode).
--
-- Error conventions as 0005/0008: 42501 → ForbiddenError, P0002 →
-- NotFoundError, 22023 + HINT = form field → ValidationError.
--
-- Idempotent: safe to run again. Runs in one transaction (or as
-- supabase/apply/0009_part1..4.sql, one transaction each).
-- =============================================================================

begin;

-- ------------------------------------------------- prerequisites + enums -----
do $$
begin
  if to_regclass('kofi.open_calls') is null or to_regclass('kofi.applied_migrations') is null then
    raise exception '0009_sales needs 0008_programme first (kofi.open_calls / kofi.applied_migrations missing).';
  end if;
  if to_regtype('kofi.call_kind') is null then
    create type kofi.call_kind as enum ('exhibition', 'auction', 'commission', 'award');
  end if;
  if to_regtype('kofi.lot_status') is null then
    create type kofi.lot_status as enum ('planned', 'live', 'sold', 'unsold', 'withdrawn');
  end if;
  if to_regtype('kofi.payout_status') is null then
    create type kofi.payout_status as enum ('due', 'paid', 'void');
  end if;
end $$;

-- ------------------------------------------------ pure helpers (CHECKs) -----
-- validateTerms() from src/domain/sales.ts: the first problem as (field, message),
-- or no row. Whole numbers 0-100, artist + kofi + partner = 100, buyer's premium
-- <= 30, resale royalty <= 25, currency ^[A-Z]{3}$, payment note <= 600.
create or replace function kofi.call_terms_problem(t jsonb)
returns table (field text, message text)
language plpgsql immutable set search_path = kofi, public as $$
declare
  k text;
  v numeric;
begin
  if t is null then
    return;
  end if;
  if jsonb_typeof(t) <> 'object' then
    field := 'terms'; message := 'The terms are not valid.'; return next; return;
  end if;
  foreach k in array array['artistSharePct', 'kofiSharePct', 'partnerSharePct', 'buyerPremiumPct', 'resaleRoyaltyPct'] loop
    if jsonb_typeof(t -> k) is distinct from 'number' then
      field := k; message := 'Use a whole number from 0 to 100.'; return next; return;
    end if;
    v := (t ->> k)::numeric;
    if v <> trunc(v) or v < 0 or v > 100 then
      field := k; message := 'Use a whole number from 0 to 100.'; return next; return;
    end if;
  end loop;
  if (t ->> 'artistSharePct')::numeric + (t ->> 'kofiSharePct')::numeric + (t ->> 'partnerSharePct')::numeric <> 100 then
    field := 'artistSharePct'; message := 'Artist, Kofi and partner shares must add up to 100%.'; return next; return;
  end if;
  if (t ->> 'buyerPremiumPct')::numeric > 30 then
    field := 'buyerPremiumPct'; message := 'A buyer''s premium above 30% is not allowed.'; return next; return;
  end if;
  if (t ->> 'resaleRoyaltyPct')::numeric > 25 then
    field := 'resaleRoyaltyPct'; message := 'A resale royalty above 25% is not allowed.'; return next; return;
  end if;
  if jsonb_typeof(t -> 'currency') is distinct from 'string' or (t ->> 'currency') !~ '^[A-Z]{3}$' then
    field := 'currency'; message := 'Currency must be a 3-letter code (USD, CAD).'; return next; return;
  end if;
  if t ? 'paymentNote' and jsonb_typeof(t -> 'paymentNote') not in ('string', 'null') then
    field := 'paymentNote'; message := 'Payment note must be text.'; return next; return;
  end if;
  if char_length(coalesce(t ->> 'paymentNote', '')) > 600 then
    field := 'paymentNote'; message := 'Keep the payment note under 600 characters.'; return next; return;
  end if;
end $$;

create or replace function kofi.call_terms_ok(t jsonb) returns boolean
language sql immutable set search_path = kofi, public as $$
  select not exists (select 1 from kofi.call_terms_problem(t))
$$;

-- Kofi's calendar day (America/New_York) of an instant — kofiDay() in domain/reports.ts.
create or replace function kofi.kofi_day(p timestamptz) returns date
language sql immutable set search_path = kofi, public as $$
  select (p at time zone 'America/New_York')::date
$$;

-- Today in Kofi's time zone (kofiToday()).
create or replace function kofi.kofi_today() returns date
language sql stable set search_path = kofi, public as $$
  select (now() at time zone 'America/New_York')::date
$$;

-- 12:00 Kofi time on a calendar day, as JavaScript's toISOString() writes it
-- ('2026-10-18T16:00:00.000Z') — kofiNoonIso() in the mock data source.
create or replace function kofi.kofi_noon(p date) returns timestamptz
language sql immutable set search_path = kofi, public as $$
  select (p + time '12:00') at time zone 'America/New_York'
$$;
create or replace function kofi.js_iso(p timestamptz) returns text
language sql immutable set search_path = kofi, public as $$
  select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- isIsoDate() from domain/programme.ts: YYYY-MM-DD and a real calendar day.
create or replace function kofi.iso_date_ok(p text) returns boolean
language plpgsql immutable set search_path = kofi, public as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then
    return false;
  end if;
  return to_char(p::date, 'YYYY-MM-DD') = p;
exception when others then
  return false;
end $$;

-- A JSON value that is a whole number (Number.isInteger()).
create or replace function kofi.json_int(p jsonb) returns numeric
language sql immutable set search_path = kofi, public as $$
  select case when jsonb_typeof(p) = 'number' and (p #>> '{}')::numeric = trunc((p #>> '{}')::numeric)
              then (p #>> '{}')::numeric end
$$;

create or replace function kofi.try_uuid(p text) returns uuid
language plpgsql immutable set search_path = kofi, public as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

-- ------------------------------------------------- open_calls: new columns ---
alter table kofi.open_calls add column if not exists kind kofi.call_kind not null default 'exhibition';
alter table kofi.open_calls add column if not exists organizer_institution_id uuid references kofi.institutions (id) on delete set null;
alter table kofi.open_calls add column if not exists terms jsonb;
alter table kofi.open_calls drop constraint if exists open_calls_terms_shape;
alter table kofi.open_calls add constraint open_calls_terms_shape check (kofi.call_terms_ok(terms));
alter table kofi.open_calls drop constraint if exists open_calls_auction_terms;
alter table kofi.open_calls add constraint open_calls_auction_terms check (not (kind = 'auction' and published) or terms is not null);
create index if not exists open_calls_organizer_idx on kofi.open_calls (organizer_institution_id);
-- Readable by everyone at once (the public call page states the terms); granted
-- here so kofi.open_calls_visible keeps working between the apply parts.
grant select (kind, organizer_institution_id, terms) on kofi.open_calls to anon, authenticated;

-- ------------------------------------------------------------------ lots -----
-- One live lot per work per call, and one lot number per call (withdrawn lots
-- free both). Written only by the RPCs below.
create table if not exists kofi.lots (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references kofi.open_calls (id),
  application_id uuid not null references kofi.applications (id),
  -- No foreign key, like the programme's artwork_ids: an artist may still delete
  -- a work (as in mock mode); the lot and its sale stay on the record and read
  -- "A work that has been removed". save_lot() checks the work exists.
  artwork_id uuid not null,
  artist_id uuid not null references kofi.artists (id) on delete cascade,
  lot_number integer not null constraint lots_lot_number_range check (lot_number between 1 and 9999),
  reserve bigint constraint lots_reserve_nonnegative check (reserve is null or reserve >= 0),
  starting_bid bigint constraint lots_starting_bid_nonnegative check (starting_bid is null or starting_bid >= 0),
  status kofi.lot_status not null default 'planned',
  sale jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lots_starting_bid_reserve check (starting_bid is null or reserve is null or starting_bid <= reserve),
  constraint lots_sale_when_sold check ((status = 'sold') = (sale is not null)),
  constraint lots_sale_shape check (sale is null or coalesce((
    jsonb_typeof(sale) = 'object'
    and kofi.json_int(sale -> 'hammerPrice') > 0
    and kofi.json_int(sale -> 'artistAmount') >= 0
    and kofi.json_int(sale -> 'kofiAmount') >= 0
    and kofi.json_int(sale -> 'partnerAmount') >= 0
    and kofi.json_int(sale -> 'buyerPremium') >= 0
    and (sale ->> 'currency') ~ '^[A-Z]{3}$'
    and jsonb_typeof(sale -> 'terms') = 'object' and kofi.call_terms_ok(sale -> 'terms')
    and jsonb_typeof(sale -> 'soldAt') = 'string'
    and (sale -> 'buyerRef' is null or (jsonb_typeof(sale -> 'buyerRef') = 'string' and char_length(sale ->> 'buyerRef') <= 160))
  ), false))
);
alter table kofi.lots drop constraint if exists lots_artwork_id_fkey;
alter table kofi.lots enable row level security;
revoke all on kofi.lots from anon, authenticated;
create index if not exists lots_call_id_idx on kofi.lots (call_id);
create index if not exists lots_artist_id_idx on kofi.lots (artist_id);
create index if not exists lots_application_id_idx on kofi.lots (application_id);
create index if not exists lots_artwork_id_idx on kofi.lots (artwork_id);
create unique index if not exists lots_one_live_work_idx on kofi.lots (call_id, artwork_id) where status <> 'withdrawn';
create unique index if not exists lots_one_live_number_idx on kofi.lots (call_id, lot_number) where status <> 'withdrawn';

-- --------------------------------------------------------------- payouts -----
create table if not exists kofi.payouts (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references kofi.lots (id),
  artist_id uuid not null references kofi.artists (id) on delete cascade,
  amount bigint not null constraint payouts_amount_nonnegative check (amount >= 0),
  currency text not null constraint payouts_currency_format check (currency ~ '^[A-Z]{3}$'),
  status kofi.payout_status not null default 'due',
  method text constraint payouts_method_length check (method is null or char_length(method) <= 80),
  reference text constraint payouts_reference_length check (reference is null or char_length(reference) <= 120),
  paid_at timestamptz,
  note text constraint payouts_note_length check (note is null or char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payouts_paid_details check ((status = 'paid') = (paid_at is not null) and (status <> 'paid' or method is not null))
);
alter table kofi.payouts enable row level security;
revoke all on kofi.payouts from anon, authenticated;
create index if not exists payouts_lot_id_idx on kofi.payouts (lot_id);
create index if not exists payouts_artist_id_idx on kofi.payouts (artist_id);
create index if not exists payouts_status_idx on kofi.payouts (status);

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
  'buyer_inquiry.submit', 'buyer_inquiry.status',
  'lot.save', 'lot.sale', 'lot.delete', 'payout.status', 'report.export'
));
alter table kofi.audit_events drop constraint if exists audit_events_entity_known;
alter table kofi.audit_events add constraint audit_events_entity_known check (entity_type in (
  'artist', 'artwork', 'document', 'curator', 'shortlist', 'inquiry',
  'exhibition', 'open_call', 'event', 'story', 'application', 'buyer_inquiry',
  'lot', 'payout', 'report'
));

drop trigger if exists lots_touch on kofi.lots;
create trigger lots_touch before update on kofi.lots for each row execute function kofi.touch_updated_at();
drop trigger if exists payouts_touch on kofi.payouts;
create trigger payouts_touch before update on kofi.payouts for each row execute function kofi.touch_updated_at();

-- -------------------------------------------------------- partner helpers ---
-- The institution the caller may organise for: a VERIFIED curator record, never
-- the client's claim. NULL for everyone else (incl. pending curators).
create or replace function kofi.my_verified_institution_id() returns uuid
language sql stable security definer set search_path = kofi, public as $$
  select c.institution_id
  from kofi.curators c
  join kofi.profiles p on p.id = c.user_id
  where c.user_id = auth.uid() and p.role = 'curator' and c.status = 'verified'
  limit 1
$$;

-- isCallOrganizer(): Kofi admins, or a verified curator of the call's organiser institution.
create or replace function kofi.is_call_organizer(p_call_id uuid) returns boolean
language sql stable security definer set search_path = kofi, public as $$
  select kofi.is_admin() or coalesce((
    select c.organizer_institution_id is not null and c.organizer_institution_id = kofi.my_verified_institution_id()
    from kofi.open_calls c where c.id = p_call_id
  ), false)
$$;

-- requireOrganiser() for non-admins: 'Your institution has not been verified yet.'
-- for a curator who is not verified, 'You do not have access to this.' otherwise.
create or replace function kofi.require_organiser() returns uuid
language plpgsql stable security definer set search_path = kofi, public as $$
declare
  v uuid := kofi.my_verified_institution_id();
begin
  if v is not null then
    return v;
  end if;
  if kofi.current_role_of() = 'curator' then
    raise exception 'Your institution has not been verified yet.' using errcode = '42501';
  end if;
  raise exception 'You do not have access to this.' using errcode = '42501';
end $$;

-- Applying is consent to the call's reviewers seeing the attached works (never an
-- Only me work), even when they are not on public view: true when the caller is a
-- partner of a call one of whose applications lists this work.
create or replace function kofi.organiser_sees_artwork(p_artwork_id uuid) returns boolean
language sql stable security definer set search_path = kofi, public as $$
  select exists (
    select 1
    from kofi.artworks w
    join kofi.applications ap on w.id = any (ap.artwork_ids) and ap.artist_id = w.artist_id
    join kofi.open_calls c on c.id = ap.call_id
    where w.id = p_artwork_id and w.visibility <> 'private'
      and c.organizer_institution_id is not null
      and c.organizer_institution_id = kofi.my_verified_institution_id()
  )
$$;

-- 0004's image rule plus the reviewer rule above (so a partner gets signed URLs
-- for the works attached to applications to their calls).
create or replace function kofi.storage_image_readable(p_name text) returns boolean
language sql stable security definer set search_path = kofi, public as $$
  select
    (kofi.my_artist_id() is not null and split_part(p_name, '/', 1) = kofi.my_artist_id()::text)
    or exists (
      select 1
      from kofi.artwork_images i
      join kofi.artworks w on w.id = i.artwork_id
      where i.src = 'storage:artwork-images/' || p_name
        and split_part(p_name, '/', 1) = w.artist_id::text
        and (kofi.artwork_visible(w.id) or kofi.organiser_sees_artwork(w.id))
    )
$$;

-- ------------------------------------------------ open_calls write guard -----
-- Runs for every write (BEFORE INSERT/UPDATE), after RLS has picked the rows:
--   * terms: exact validateTerms() messages; normalised to the CallTerms keys
--   * validateCallTerms(): an auction call always carries terms
--   * locks (Kofi too): a call with lots stays an auction; terms are frozen
--     once a lot has sold
--   * partners (API callers who are not Kofi admins): insert = a draft for their
--     own institution; update = only while unpublished, never publish / re-assign
-- Not security definer on purpose: current_user tells an API request (anon /
-- authenticated) from trusted code (SQL editor, migrations, seeds, definer
-- functions such as kofi_demo_reset()). Lot lookups go through a definer helper.
create or replace function kofi.call_lot_state(p_call uuid) returns text
language sql stable security definer set search_path = kofi, public as $$
  select case
    when exists (select 1 from kofi.lots l where l.call_id = p_call and l.status = 'sold') then 'sold'
    when exists (select 1 from kofi.lots l where l.call_id = p_call) then 'lots'
    else 'none'
  end
$$;

create or replace function kofi.open_calls_sales_guard() returns trigger
language plpgsql set search_path = kofi, public as $$
declare
  pr record;
  v_trusted boolean := current_user not in ('anon', 'authenticated');
  v_lots text;
begin
  select * into pr from kofi.call_terms_problem(new.terms) limit 1;
  if found then
    raise exception '%', pr.message using errcode = '22023', hint = pr.field;
  end if;
  if new.terms is not null then
    new.terms := jsonb_strip_nulls(jsonb_build_object(
      'artistSharePct', new.terms -> 'artistSharePct',
      'kofiSharePct', new.terms -> 'kofiSharePct',
      'partnerSharePct', new.terms -> 'partnerSharePct',
      'buyerPremiumPct', new.terms -> 'buyerPremiumPct',
      'resaleRoyaltyPct', new.terms -> 'resaleRoyaltyPct',
      'currency', new.terms -> 'currency',
      'paymentNote', nullif(btrim(coalesce(new.terms ->> 'paymentNote', '')), '')));
  end if;
  if new.kind = 'auction' and new.terms is null then
    raise exception 'An auction call must publish its compensation terms.' using errcode = '22023', hint = 'terms';
  end if;

  if not (v_trusted or kofi.is_admin()) then
    if tg_op = 'INSERT' then
      new.published := false;
      new.sample := false;
      new.organizer_institution_id := kofi.my_verified_institution_id();
    else
      if old.published then
        raise exception 'Kofi has published this call. Ask Kofi to make changes.' using errcode = '42501';
      end if;
      if new.published is distinct from old.published then
        raise exception 'Only Kofi can publish a call.' using errcode = '42501';
      end if;
      if new.organizer_institution_id is distinct from old.organizer_institution_id then
        raise exception 'You can only edit calls your institution runs.' using errcode = '42501';
      end if;
      new.sample := old.sample;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    v_lots := kofi.call_lot_state(old.id);
    if old.kind = 'auction' and new.kind <> 'auction' and v_lots <> 'none' then
      raise exception 'This call has lots, so it stays an auction.' using errcode = '22023', hint = 'kind';
    end if;
    if new.terms is distinct from old.terms and v_lots = 'sold' then
      raise exception 'Terms are locked once a lot has sold.' using errcode = '22023', hint = 'terms';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists open_calls_sales_guard on kofi.open_calls;
create trigger open_calls_sales_guard before insert or update on kofi.open_calls
  for each row execute function kofi.open_calls_sales_guard();

-- 0008's audit trigger, with the new organiser link in the "reference only"
-- list (an institution deleted → link cleared → not a staff action).
create or replace function kofi.programme_audit() returns trigger
language plpgsql security definer set search_path = kofi, public as $$
declare
  fk_cols text[] := array['exhibition_id', 'artist_id', 'organizer_institution_id', 'updated_at'];
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

-- ------------------------------------------------- read helpers (definer) ----
-- 0008's helpers, extended: the call's organiser reads its applications with
-- the reviewers' note; the artist never gets staff_note.
create or replace function kofi.application_labels(p_id uuid)
returns table (staff_note text, call_title text, call_deadline date, artist_working_name text)
language sql stable security definer set search_path = kofi, public as $$
  select
    case when kofi.is_call_organizer(a.call_id) then a.staff_note end,
    c.title,
    c.deadline,
    ar.working_name
  from kofi.applications a
  join kofi.open_calls c on c.id = a.call_id
  join kofi.artists ar on ar.id = a.artist_id
  where a.id = p_id
    and (kofi.is_call_organizer(a.call_id) or a.artist_id = kofi.my_artist_id())
$$;

-- A partner also sees the exhibition link of its own draft call.
create or replace function kofi.programme_exhibition_link(p_kind text, p_id uuid) returns uuid
language plpgsql stable security definer set search_path = kofi, public as $$
declare
  v_ex uuid;
  v_published boolean;
begin
  if p_kind = 'open_call' then
    select c.exhibition_id, c.published or kofi.is_call_organizer(c.id) into v_ex, v_published from kofi.open_calls c where c.id = p_id;
  elsif p_kind = 'event' then
    select v.exhibition_id, v.published into v_ex, v_published from kofi.events v where v.id = p_id;
  else
    return null;
  end if;
  if v_ex is null or not (v_published or kofi.is_admin()) then
    return null;
  end if;
  return (select e.id from kofi.exhibitions e where e.id = v_ex and (e.published or kofi.is_admin()));
end $$;

-- Sale, payout and labels for one lot, as the caller may see them. No row unless
-- the caller is Kofi, the call's organiser or the lot's artist. The organiser gets
-- the sale with buyerRef but never the payout; the artist gets the sale WITHOUT
-- buyerRef and their payout (the live one, else the latest voided one).
create or replace function kofi.lot_extras(p_id uuid)
returns table (sale jsonb, payout jsonb, call_title text, call_kind kofi.call_kind, artwork_title text, artist_working_name text)
language sql stable security definer set search_path = kofi, public as $$
  select
    case when x.manager then l.sale else l.sale - 'buyerRef' end,
    case when kofi.is_admin() or x.own then (
      select to_jsonb(p) from kofi.payouts p where p.lot_id = l.id
      order by (p.status = 'void'), p.created_at desc, p.id limit 1
    ) end,
    c.title,
    c.kind,
    w.title,
    ar.working_name
  from kofi.lots l
  cross join lateral (select kofi.is_call_organizer(l.call_id) as manager, (l.artist_id = kofi.my_artist_id()) as own) x
  left join kofi.open_calls c on c.id = l.call_id
  left join kofi.artworks w on w.id = l.artwork_id
  left join kofi.artists ar on ar.id = l.artist_id
  where l.id = p_id and (x.manager or x.own)
$$;

create or replace function kofi.payout_labels(p_id uuid)
returns table (artist_working_name text, artwork_title text, call_title text, lot_number integer)
language sql stable security definer set search_path = kofi, public as $$
  select ar.working_name, w.title, c.title, l.lot_number
  from kofi.payouts p
  left join kofi.lots l on l.id = p.lot_id
  left join kofi.open_calls c on c.id = l.call_id
  left join kofi.artworks w on w.id = l.artwork_id
  left join kofi.artists ar on ar.id = p.artist_id
  where p.id = p_id and (kofi.is_admin() or p.artist_id = kofi.my_artist_id())
$$;

-- ------------------------------------------------------------------ views ---
-- 0008's view with the three new columns appended (create or replace keeps
-- existing columns in place).
create or replace view kofi.open_calls_visible with (security_invoker = true) as
select
  c.id, c.title, c.partner, c.summary, c.body, c.eligibility, c.mediums, c.opens_on, c.deadline,
  c.max_works, c.fee, c.award, c.image, c.external_url,
  kofi.programme_exhibition_link('open_call', c.id) as exhibition_id,
  c.sample, c.published, c.created_at, c.updated_at,
  c.kind, c.organizer_institution_id, c.terms
from kofi.open_calls c;

create or replace view kofi.lots_visible with (security_invoker = true) as
select
  l.id, l.call_id, l.application_id, l.artwork_id, l.artist_id, l.lot_number, l.reserve, l.starting_bid, l.status,
  x.sale, x.payout, x.call_title, x.call_kind, x.artwork_title, x.artist_working_name,
  l.created_at, l.updated_at
from kofi.lots l
left join lateral kofi.lot_extras(l.id) x on true;

create or replace view kofi.payouts_visible with (security_invoker = true) as
select
  p.id, p.lot_id, p.artist_id, p.amount, p.currency, p.status, p.method, p.reference, p.paid_at, p.note,
  p.created_at, p.updated_at,
  x.artist_working_name, x.artwork_title, x.call_title, x.lot_number
from kofi.payouts p
left join lateral kofi.payout_labels(p.id) x on true;

-- The works attached to applications to the caller's calls, as a reviewer sees
-- them (the mock's reviewerWork()): any work but an Only me one, even if not on
-- public view; the price still follows its own visibility for this viewer; no
-- contact fields exist in this shape. Same columns as kofi.artworks_visible.
-- Partners only (Kofi admins read kofi.artworks_visible); p_call narrows to one call.
create or replace function kofi.call_application_works(p_call uuid default null)
returns setof kofi.artworks_visible
language sql stable security definer set search_path = kofi, public as $$
  select
    w.id, w.artist_id, w.title, w.year, w.medium, w.materials, w.height, w.width, w.depth, w.unit,
    w.description, w.status, w.rights_note,
    case when s.price_ok then w.price_amount end,
    case when s.price_ok then w.price_currency end,
    (w.price_amount is not null and not s.price_ok),
    w.price_visibility, w.visibility, w.tags, w.reviewed_at, w.created_at, w.updated_at,
    a.working_name, a.career_stage, a.experience_commissions, a.experience_public_art,
    a.experience_residencies, a.experience_institutional_shows, a.experience_years_practicing,
    'approved'::kofi.artist_status, 'public'::kofi.visibility,
    kofi.region_label(a.region_city, a.region_region, a.region_country, a.region_precision),
    false,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'src', i.src, 'alt', i.alt, 'isPrimary', i.is_primary, 'metadataStripped', i.metadata_stripped
      ) order by i.position, i.created_at)
      from kofi.artwork_images i where i.artwork_id = w.id
    ), '[]'::jsonb)
  from kofi.artworks w
  join kofi.artists a on a.id = w.artist_id
  cross join lateral (select kofi.can_see(w.price_visibility, w.artist_id) as price_ok) s
  where kofi.my_verified_institution_id() is not null
    and w.visibility <> 'private'
    and exists (
      select 1 from kofi.applications ap
      join kofi.open_calls c on c.id = ap.call_id
      where w.id = any (ap.artwork_ids) and ap.artist_id = w.artist_id
        and (p_call is null or ap.call_id = p_call)
        and c.organizer_institution_id = kofi.my_verified_institution_id()
    )
$$;
revoke execute on function kofi.call_application_works(uuid) from public, anon;
grant execute on function kofi.call_application_works(uuid) to authenticated;

-- ------------------------------------------------------------------- RPCs ---
-- Each RPC's EXECUTE grant follows it (session required; anon gets nothing).
-- Messages, fields and their order are the mock data source's (saveLot,
-- setLotStatus, recordSale, deleteLot, setPayoutStatus, kofiReport,
-- setApplicationStatus) and src/domain/sales.ts / reports.ts. Curly quotes and
-- apostrophes are chr() so the result does not depend on the client encoding.

-- requireCallManager(): Kofi (unknown call → NotFound) or the call's partner.
create or replace function kofi.require_call_manager(p_call uuid) returns kofi.open_calls
language plpgsql stable security definer set search_path = kofi, public as $$
declare
  c kofi.open_calls%rowtype;
  v_found boolean;
begin
  select * into c from kofi.open_calls where id = p_call;
  v_found := found;
  if kofi.is_admin() then
    if not v_found then
      raise exception 'Open call not found.' using errcode = 'P0002';
    end if;
    return c;
  end if;
  perform kofi.require_organiser();
  if not v_found or c.organizer_institution_id is distinct from kofi.my_verified_institution_id() then
    raise exception 'You can only manage calls your institution runs.' using errcode = '42501';
  end if;
  return c;
end $$;
-- Internal guard, only called from inside the RPCs (definer context).
revoke execute on function kofi.require_call_manager(uuid) from public, anon, authenticated;

-- requireLot(): organiser check, then the lot, then its call.
create or replace function kofi.require_lot(p_id uuid) returns kofi.lots
language plpgsql volatile security definer set search_path = kofi, public as $$
declare
  x kofi.lots%rowtype;
begin
  if not kofi.is_admin() then
    perform kofi.require_organiser();
  end if;
  select * into x from kofi.lots where id = p_id for update;
  if not found then
    raise exception 'Lot not found.' using errcode = 'P0002';
  end if;
  perform kofi.require_call_manager(x.call_id);
  return x;
end $$;
revoke execute on function kofi.require_lot(uuid) from public, anon, authenticated;

-- validateLot() — shared by save_lot() and set_lot_status() (reinstating a
-- withdrawn lot re-checks the rules it was exempt from). Raises the first problem.
create or replace function kofi.lot_rules(
  c kofi.open_calls, ap kofi.applications, w kofi.artworks,
  p_num numeric, p_reserve numeric, p_reserve_bad boolean, p_start numeric, p_start_bad boolean, p_editing uuid
) returns void
language plpgsql stable security definer set search_path = kofi, public as $$
begin
  if c.kind <> 'auction' then
    raise exception 'Only auction calls have lots.' using errcode = '22023', hint = 'callId';
  end if;
  if c.terms is null then
    raise exception '%', 'Set the call' || chr(8217) || 's compensation terms before adding lots.' using errcode = '22023', hint = 'callId';
  end if;
  if ap.call_id <> c.id then
    raise exception 'That application is for a different call.' using errcode = '22023', hint = 'applicationId';
  end if;
  if ap.status <> 'accepted' then
    raise exception 'Only selected (accepted) applications can become lots.' using errcode = '22023', hint = 'applicationId';
  end if;
  if not (w.id = any (ap.artwork_ids)) then
    raise exception 'That work is not on the application.' using errcode = '22023', hint = 'artworkId';
  end if;
  if w.artist_id <> ap.artist_id then
    raise exception 'That work belongs to another artist.' using errcode = '22023', hint = 'artworkId';
  end if;
  if exists (select 1 from kofi.lots l where l.call_id = c.id and l.id is distinct from p_editing and l.status <> 'withdrawn' and l.artwork_id = w.id) then
    raise exception 'This work is already a lot in this auction.' using errcode = '22023', hint = 'artworkId';
  end if;
  if p_num is null or p_num < 1 or p_num > 9999 then
    raise exception 'Lot number must be between 1 and 9999.' using errcode = '22023', hint = 'lotNumber';
  end if;
  if exists (select 1 from kofi.lots l where l.call_id = c.id and l.id is distinct from p_editing and l.status <> 'withdrawn' and l.lot_number = p_num) then
    raise exception 'Lot % is already used in this auction.', p_num using errcode = '22023', hint = 'lotNumber';
  end if;
  if p_reserve_bad then
    raise exception 'Enter a whole amount of money, or leave it empty.' using errcode = '22023', hint = 'reserve';
  end if;
  if p_start_bad then
    raise exception 'Enter a whole amount of money, or leave it empty.' using errcode = '22023', hint = 'startingBid';
  end if;
  if p_reserve is not null and p_start is not null and p_start > p_reserve then
    raise exception 'The starting bid cannot be above the reserve.' using errcode = '22023', hint = 'startingBid';
  end if;
end $$;
revoke execute on function kofi.lot_rules(kofi.open_calls, kofi.applications, kofi.artworks, numeric, numeric, boolean, numeric, boolean, uuid) from public, anon, authenticated;

-- saveLot(): create (no id) or edit a lot. p_lot = LotInput & { id? } as JSON.
create or replace function kofi.save_lot(p_lot jsonb) returns uuid
language plpgsql volatile security definer set search_path = kofi, public as $$
declare
  j jsonb := coalesce(p_lot, '{}'::jsonb);
  v_id uuid;
  ex kofi.lots%rowtype;
  c kofi.open_calls%rowtype;
  ap kofi.applications%rowtype;
  w kofi.artworks%rowtype;
  v_num numeric;
  v_reserve numeric;
  v_start numeric;
  v_reserve_bad boolean := false;
  v_start_bad boolean := false;
  v_constraint text;
begin
  if jsonb_typeof(j) <> 'object' then
    j := '{}'::jsonb;
  end if;
  if not kofi.is_admin() then
    perform kofi.require_organiser();
  end if;
  if j ? 'id' and jsonb_typeof(j -> 'id') = 'string' and j ->> 'id' <> '' then
    select * into ex from kofi.lots where id = kofi.try_uuid(j ->> 'id') for update;
    if not found then
      raise exception 'Lot not found.' using errcode = 'P0002';
    end if;
  end if;
  c := kofi.require_call_manager(kofi.try_uuid(j ->> 'callId'));
  if ex.id is not null then
    if ex.call_id <> c.id then
      raise exception 'A lot cannot move to another call.' using errcode = '22023', hint = 'callId';
    end if;
    if ex.status = 'sold' then
      raise exception 'This lot is sold. Void the sale before editing it.' using errcode = '22023', hint = 'status';
    end if;
  end if;
  select * into ap from kofi.applications where id = kofi.try_uuid(j ->> 'applicationId');
  if not found then
    raise exception 'Choose a selected application.' using errcode = '22023', hint = 'applicationId';
  end if;
  select * into w from kofi.artworks where id = kofi.try_uuid(j ->> 'artworkId');
  if not found then
    raise exception 'That work no longer exists.' using errcode = '22023', hint = 'artworkId';
  end if;

  if j -> 'reserve' is not null and jsonb_typeof(j -> 'reserve') <> 'null' then
    v_reserve := kofi.json_int(j -> 'reserve');
    v_reserve_bad := v_reserve is null or v_reserve < 0;
  end if;
  if j -> 'startingBid' is not null and jsonb_typeof(j -> 'startingBid') <> 'null' then
    v_start := kofi.json_int(j -> 'startingBid');
    v_start_bad := v_start is null or v_start < 0;
  end if;
  v_num := kofi.json_int(j -> 'lotNumber');
  perform kofi.lot_rules(c, ap, w, v_num, v_reserve, v_reserve_bad, v_start, v_start_bad, ex.id);

  begin
    if ex.id is not null then
      update kofi.lots set
        application_id = ap.id, artwork_id = w.id, artist_id = ap.artist_id, lot_number = v_num,
        reserve = v_reserve, starting_bid = v_start
      where id = ex.id;
      v_id := ex.id;
    else
      insert into kofi.lots (call_id, application_id, artwork_id, artist_id, lot_number, reserve, starting_bid, status)
      values (c.id, ap.id, w.id, ap.artist_id, v_num, v_reserve, v_start, 'planned')
      returning id into v_id;
    end if;
  exception when unique_violation then
    -- A parallel save won the race (partial unique indexes).
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'lots_one_live_work_idx' then
      raise exception 'This work is already a lot in this auction.' using errcode = '22023', hint = 'artworkId';
    end if;
    raise exception 'Lot % is already used in this auction.', v_num using errcode = '22023', hint = 'lotNumber';
  end;
  perform kofi.write_audit('lot.save', 'lot', v_id::text,
    jsonb_build_object('callId', c.id, 'lotNumber', v_num, 'created', ex.id is null));
  return v_id;
end $$;
revoke execute on function kofi.save_lot(jsonb) from public, anon;
grant execute on function kofi.save_lot(jsonb) to authenticated;

-- setLotStatus(): canMoveLot(); sold → unsold voids the sale and its payout
-- (kept as 'void'); a paid payout cannot be voided.
create or replace function kofi.set_lot_status(p_id uuid, p_status text) returns void
language plpgsql volatile security definer set search_path = kofi, public as $$
declare
  x kofi.lots%rowtype;
  t kofi.lot_status;
  p kofi.payouts%rowtype;
  c kofi.open_calls%rowtype;
  ap kofi.applications%rowtype;
  w kofi.artworks%rowtype;
  v_constraint text;
begin
  x := kofi.require_lot(p_id);
  if p_status is null or not (p_status = any (enum_range(null::kofi.lot_status)::text[])) then
    raise exception 'Unknown status.' using errcode = '22023', hint = 'status';
  end if;
  t := p_status::kofi.lot_status;
  if not (
    x.status <> t and t <> 'sold' and (
      (x.status = 'sold' and t = 'unsold')
      or (x.status = 'withdrawn' and t = 'planned')
      or (x.status not in ('sold', 'withdrawn') and t in ('live', 'unsold', 'withdrawn', 'planned'))
    )
  ) then
    if t = 'sold' then
      raise exception 'Record the sale to mark a lot sold.' using errcode = '22023', hint = 'status';
    end if;
    raise exception 'This lot cannot move from % to %.', x.status, t using errcode = '22023', hint = 'status';
  end if;
  if x.status = 'withdrawn' then
    -- Reinstating re-checks the rules a withdrawn lot was exempt from.
    select * into c from kofi.open_calls where id = x.call_id;
    if found then select * into ap from kofi.applications where id = x.application_id; end if;
    if found then select * into w from kofi.artworks where id = x.artwork_id; end if;
    if not found then
      raise exception 'The work or its application no longer exists.' using errcode = '22023', hint = 'status';
    end if;
    perform kofi.lot_rules(c, ap, w, x.lot_number, x.reserve, false, x.starting_bid, false, x.id);
  end if;
  if x.status = 'sold' then
    select * into p from kofi.payouts where lot_id = x.id and status <> 'void' order by created_at, id limit 1 for update;
    if found and p.status = 'paid' then
      raise exception 'Payout already paid.' using errcode = '22023', hint = 'status';
    end if;
    if found then
      update kofi.payouts set status = 'void' where id = p.id;
      perform kofi.write_audit('payout.status', 'payout', p.id::text, jsonb_build_object('status', 'void', 'lotId', x.id));
    end if;
    update kofi.lots set sale = null, status = t where id = x.id;
    perform kofi.write_audit('lot.sale', 'lot', x.id::text, jsonb_build_object('voided', true, 'lotNumber', x.lot_number));
    return;
  end if;
  begin
    update kofi.lots set status = t where id = x.id;
  exception when unique_violation then
    -- withdrawn → planned while another live lot took the work / number
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'lots_one_live_work_idx' then
      raise exception 'This work is already a lot in this auction.' using errcode = '22023', hint = 'artworkId';
    end if;
    raise exception 'Lot % is already used in this auction.', x.lot_number using errcode = '22023', hint = 'lotNumber';
  end;
  perform kofi.write_audit('lot.save', 'lot', x.id::text, jsonb_build_object('status', t, 'from', x.status, 'lotNumber', x.lot_number));
end $$;
revoke execute on function kofi.set_lot_status(uuid, text) from public, anon;
grant execute on function kofi.set_lot_status(uuid, text) to authenticated;

-- recordSale(): validateSale(), then splitSale() from the call's terms (cents,
-- artist rounded half-up first, partner next, the remainder to Kofi; premium on
-- top), sold at 12:00 Kofi time; the artist's payout is created 'due'.
-- round(numeric) rounds half away from zero, i.e. half-up for these positive
-- amounts — the same as Math.round() in splitSale().
create or replace function kofi.record_sale(p_id uuid, p_hammer numeric, p_sold_on text, p_buyer_ref text default null) returns void
language plpgsql volatile security definer set search_path = kofi, public as $$
declare
  x kofi.lots%rowtype;
  c kofi.open_calls%rowtype;
  t jsonb;
  v_sold_on text := btrim(coalesce(p_sold_on, ''));
  v_ref text := nullif(btrim(coalesce(p_buyer_ref, '')), '');
  v_artist numeric;
  v_partner numeric;
  v_premium numeric;
  v_sale jsonb;
begin
  x := kofi.require_lot(p_id);
  select * into c from kofi.open_calls where id = x.call_id;
  t := c.terms;
  if t is null then
    raise exception '%', 'Set the call' || chr(8217) || 's compensation terms before recording a sale.' using errcode = '22023', hint = 'terms';
  end if;
  if x.status = 'sold' then
    raise exception 'This lot is already sold. Void the sale first to record it again.' using errcode = '22023', hint = 'status';
  end if;
  if x.status = 'withdrawn' then
    raise exception 'A withdrawn lot cannot be sold.' using errcode = '22023', hint = 'status';
  end if;
  if p_hammer is null or p_hammer <> trunc(p_hammer) or p_hammer <= 0 then
    raise exception 'Enter the hammer price.' using errcode = '22023', hint = 'hammerPrice';
  end if;
  if x.reserve is not null and p_hammer < x.reserve then
    raise exception '%', 'The hammer price is below the artist' || chr(8217) || 's reserve.' using errcode = '22023', hint = 'hammerPrice';
  end if;
  if v_sold_on !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Enter the date of the sale.' using errcode = '22023', hint = 'soldOn';
  end if;
  if v_sold_on collate "C" > to_char(kofi.kofi_today(), 'YYYY-MM-DD') then
    raise exception 'The sale date cannot be in the future.' using errcode = '22023', hint = 'soldOn';
  end if;
  if char_length(coalesce(v_ref, '')) > 160 then
    raise exception 'Keep the buyer reference under 160 characters.' using errcode = '22023', hint = 'buyerRef';
  end if;
  if not kofi.iso_date_ok(v_sold_on) then
    raise exception 'Enter the date of the sale.' using errcode = '22023', hint = 'soldOn';
  end if;

  v_artist := round(p_hammer * (t ->> 'artistSharePct')::numeric / 100);
  v_partner := round(p_hammer * (t ->> 'partnerSharePct')::numeric / 100);
  v_premium := round(p_hammer * (t ->> 'buyerPremiumPct')::numeric / 100);
  v_sale := jsonb_build_object(
    'hammerPrice', p_hammer::bigint,
    'currency', t ->> 'currency',
    'buyerPremium', v_premium::bigint,
    'artistAmount', v_artist::bigint,
    'kofiAmount', (p_hammer - v_artist - v_partner)::bigint,
    'partnerAmount', v_partner::bigint,
    'terms', t,
    'soldAt', kofi.js_iso(kofi.kofi_noon(v_sold_on::date)));
  if v_ref is not null then
    v_sale := v_sale || jsonb_build_object('buyerRef', v_ref);
  end if;
  update kofi.lots set sale = v_sale, status = 'sold' where id = x.id;
  insert into kofi.payouts (lot_id, artist_id, amount, currency, status)
  values (x.id, x.artist_id, v_artist::bigint, t ->> 'currency', 'due');
  -- Never the buyer reference in the audit trail.
  perform kofi.write_audit('lot.sale', 'lot', x.id::text,
    jsonb_build_object('hammer', p_hammer::bigint, 'currency', t ->> 'currency', 'lotNumber', x.lot_number));
end $$;
revoke execute on function kofi.record_sale(uuid, numeric, text, text) from public, anon;
grant execute on function kofi.record_sale(uuid, numeric, text, text) to authenticated;

-- deleteLot(): only a lot that has never been sold (a voided sale stays on record).
create or replace function kofi.delete_lot(p_id uuid) returns void
language plpgsql volatile security definer set search_path = kofi, public as $$
declare
  x kofi.lots%rowtype;
begin
  x := kofi.require_lot(p_id);
  if x.status = 'sold' or exists (select 1 from kofi.payouts p where p.lot_id = x.id) then
    raise exception 'This lot has a sale on record, so it cannot be deleted. Withdraw it instead.' using errcode = '22023', hint = 'status';
  end if;
  delete from kofi.lots where id = x.id;
  perform kofi.write_audit('lot.delete', 'lot', x.id::text, jsonb_build_object('callId', x.call_id, 'lotNumber', x.lot_number));
end $$;
revoke execute on function kofi.delete_lot(uuid) from public, anon;
grant execute on function kofi.delete_lot(uuid) to authenticated;

-- ------------------------------------------- RPCs: payouts, decisions, reports ---
-- (RPC privileges are granted next to each function, so no RPC is ever callable
-- more widely than designed, even between the apply parts.)

-- setPayoutStatus(): Kofi only; canMovePayout(); 'paid' needs a method (<= 80),
-- optional reference (<= 120) and a payment day (default today, not in the
-- future), stored as 12:00 Kofi time. Notes: NULL keeps, '' clears.
create or replace function kofi.set_payout_status(
  p_id uuid, p_status text, p_method text default null, p_reference text default null, p_note text default null, p_paid_on text default null
) returns void
language plpgsql volatile security definer set search_path = kofi, public as $$
declare
  p kofi.payouts%rowtype;
  t kofi.payout_status;
  v_note text := btrim(p_note);
  v_method text := btrim(p_method);
  v_reference text := btrim(p_reference);
  v_paid_on text;
  v_meta jsonb;
begin
  if not kofi.is_admin() then
    raise exception 'Kofi staff only.' using errcode = '42501';
  end if;
  select * into p from kofi.payouts where id = p_id for update;
  if not found then
    raise exception 'Payout not found.' using errcode = 'P0002';
  end if;
  if p_status is null or not (p_status = any (enum_range(null::kofi.payout_status)::text[])) then
    raise exception 'Unknown status.' using errcode = '22023', hint = 'status';
  end if;
  t := p_status::kofi.payout_status;
  if not (p.status <> t and (
       (p.status = 'due' and t in ('paid', 'void'))
    or (p.status = 'paid' and t = 'due')
    or (p.status = 'void' and t = 'due'))) then
    raise exception 'This payout cannot move from % to %.', p.status, t using errcode = '22023', hint = 'status';
  end if;
  if p.status = 'void' and t = 'due' then
    if not exists (select 1 from kofi.lots l where l.id = p.lot_id and l.status = 'sold')
       or exists (select 1 from kofi.payouts o where o.lot_id = p.lot_id and o.id <> p.id and o.status <> 'void') then
      raise exception 'This sale was voided. Record the sale again instead.' using errcode = '22023', hint = 'status';
    end if;
  end if;
  if char_length(coalesce(v_note, '')) > 2000 then
    raise exception 'Keep the note under 2000 characters.' using errcode = '22023', hint = 'note';
  end if;
  if t = 'paid' then
    if char_length(coalesce(v_method, '')) > 80 then
      raise exception 'Keep the payment method under 80 characters.' using errcode = '22023', hint = 'method';
    end if;
    if coalesce(v_method, '') = '' then
      raise exception 'Say how the artist was paid.' using errcode = '22023', hint = 'method';
    end if;
    if char_length(coalesce(v_reference, '')) > 120 then
      raise exception 'Keep the reference under 120 characters.' using errcode = '22023', hint = 'reference';
    end if;
    v_paid_on := coalesce(nullif(p_paid_on, ''), to_char(kofi.kofi_today(), 'YYYY-MM-DD'));
    v_paid_on := btrim(v_paid_on);
    if not kofi.iso_date_ok(v_paid_on) then
      raise exception 'Payment date must be a valid date.' using errcode = '22023', hint = 'paidOn';
    end if;
    if v_paid_on::date > kofi.kofi_today() then
      raise exception 'The payment date cannot be in the future.' using errcode = '22023', hint = 'paidOn';
    end if;
    update kofi.payouts set
      status = t, method = v_method, reference = nullif(v_reference, ''), paid_at = kofi.kofi_noon(v_paid_on::date),
      note = case when p_note is null then note else nullif(v_note, '') end
    where id = p.id;
  else
    update kofi.payouts set
      status = t, method = null, reference = null, paid_at = null,
      note = case when p_note is null then note else nullif(v_note, '') end
    where id = p.id;
  end if;
  v_meta := jsonb_build_object('status', t, 'lotId', p.lot_id);
  if t = 'paid' then
    v_meta := v_meta || jsonb_build_object('method', v_method);
  end if;
  perform kofi.write_audit('payout.status', 'payout', p.id::text, v_meta);
end $$;
revoke execute on function kofi.set_payout_status(uuid, text, text, text, text, text) from public, anon;
grant execute on function kofi.set_payout_status(uuid, text, text, text, text, text) to authenticated;

-- canMoveApplication(from, to, 'admin') for Kofi AND the call's partner. A
-- selection whose works are live lots cannot be moved. Notes: NULL keeps, ''
-- clears, anything else is stored trimmed.
create or replace function kofi.set_application_status(
  p_id uuid, p_status kofi.application_status, p_decision_note text default null, p_staff_note text default null
) returns void
language plpgsql volatile security definer set search_path = kofi, public as $$
declare
  x kofi.applications%rowtype;
begin
  if not kofi.is_admin() then
    perform kofi.require_organiser();
  end if;
  select * into x from kofi.applications where id = p_id for update;
  if not found then
    raise exception 'Application not found.' using errcode = 'P0002';
  end if;
  if not kofi.is_admin() then
    perform kofi.require_call_manager(x.call_id);
  end if;
  if x.status = 'withdrawn' then
    raise exception 'The artist withdrew this application.' using errcode = '22023', hint = 'status';
  end if;
  if p_status = x.status or p_status not in ('shortlisted', 'accepted', 'declined') then
    raise exception 'This application cannot be moved from % to %.', x.status, p_status using errcode = '22023', hint = 'status';
  end if;
  if x.status = 'accepted' and exists (select 1 from kofi.lots l where l.application_id = x.id and l.status <> 'withdrawn') then
    raise exception 'Works from this selection are lots in the auction. Withdraw or delete the lots first.' using errcode = '22023', hint = 'status';
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
revoke execute on function kofi.set_application_status(uuid, kofi.application_status, text, text) from public, anon;
grant execute on function kofi.set_application_status(uuid, kofi.application_status, text, text) to authenticated;

-- kofiReport(): Kofi only. validateRange(), then the three row sets of
-- buildReport() over ALL rows, computed here with the same Kofi-day semantics
-- (America/New_York). Returns {participation, placements, payments}, each row
-- shaped exactly like ParticipationRow / PlacementRow / PaymentRow (optional
-- keys omitted when empty). The client re-sorts with buildReport's comparators
-- and computes the totals. Audits report.export {from, to}.
create or replace function kofi.kofi_report(p_from text, p_to text) returns jsonb
language plpgsql volatile security definer set search_path = kofi, public as $$
declare
  v_from text := btrim(coalesce(p_from, ''));
  v_to text := btrim(coalesce(p_to, ''));
  v_part jsonb;
  v_place jsonb;
  v_pay jsonb;
begin
  if not kofi.is_admin() then
    raise exception 'Kofi staff only.' using errcode = '42501';
  end if;
  if v_from !~ '^\d{4}-\d{2}-\d{2}$' or v_to !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Pick a start and end date.' using errcode = '22023', hint = 'range';
  end if;
  if v_from collate "C" > v_to then
    raise exception 'The start date must be before the end date.' using errcode = '22023', hint = 'range';
  end if;
  if v_from collate "C" > to_char(kofi.kofi_today(), 'YYYY-MM-DD') then
    raise exception 'The start date is in the future.' using errcode = '22023', hint = 'range';
  end if;

  select coalesce(jsonb_agg(r.row order by r.on_day desc, r.name), '[]'::jsonb) into v_part
  from (
    select
      kofi.kofi_day(a.created_at) as on_day,
      coalesce(ar.working_name, 'Unknown artist') as name,
      jsonb_strip_nulls(jsonb_build_object(
        'artistId', a.artist_id,
        'artistWorkingName', coalesce(ar.working_name, 'Unknown artist'),
        'callId', a.call_id,
        'callTitle', coalesce(c.title, 'Deleted call'),
        'callKind', coalesce(c.kind::text, 'exhibition'),
        'organizer', coalesce(i.name, nullif(c.partner, ''), 'Kofi Collections'),
        'applicationId', a.id,
        'status', a.status,
        'worksAttached', cardinality(a.artwork_ids),
        'submittedOn', to_char(kofi.kofi_day(a.created_at), 'YYYY-MM-DD'),
        'decidedOn', to_char(kofi.kofi_day(a.decided_at), 'YYYY-MM-DD'))) as row
    from kofi.applications a
    left join kofi.artists ar on ar.id = a.artist_id
    left join kofi.open_calls c on c.id = a.call_id
    left join kofi.institutions i on i.id = c.organizer_institution_id
    where to_char(kofi.kofi_day(a.created_at), 'YYYY-MM-DD') collate "C" between v_from and v_to
  ) r;

  select coalesce(jsonb_agg(r.row order by r.on_day desc, r.name, r.kind_rank, r.title, r.work_id), '[]'::jsonb) into v_place
  from (
    -- published exhibitions starting in range
    select e.starts_on as on_day, coalesce(ar.working_name, 'Unknown artist') as name, 1 as kind_rank, w.title, w.id as work_id,
      jsonb_build_object('artistId', w.artist_id, 'artistWorkingName', coalesce(ar.working_name, 'Unknown artist'),
        'artworkId', w.id, 'artworkTitle', w.title, 'kind', 'exhibition', 'where', e.title,
        'on', to_char(e.starts_on, 'YYYY-MM-DD')) as row
    from kofi.exhibitions e
    cross join lateral unnest(e.artwork_ids) as u (id)
    join kofi.artworks w on w.id = u.id
    left join kofi.artists ar on ar.id = w.artist_id
    where e.published and to_char(e.starts_on, 'YYYY-MM-DD') collate "C" between v_from and v_to
    union all
    -- selections (accepted applications decided in range)
    select kofi.kofi_day(a.decided_at), coalesce(ar.working_name, 'Unknown artist'), 2, w.title, w.id,
      jsonb_build_object('artistId', w.artist_id, 'artistWorkingName', coalesce(ar.working_name, 'Unknown artist'),
        'artworkId', w.id, 'artworkTitle', w.title, 'kind', 'selection', 'where', coalesce(c.title, 'Deleted call'),
        'on', to_char(kofi.kofi_day(a.decided_at), 'YYYY-MM-DD'))
    from kofi.applications a
    cross join lateral unnest(a.artwork_ids) as u (id)
    join kofi.artworks w on w.id = u.id
    left join kofi.artists ar on ar.id = w.artist_id
    left join kofi.open_calls c on c.id = a.call_id
    where a.status = 'accepted' and a.decided_at is not null and to_char(kofi.kofi_day(a.decided_at), 'YYYY-MM-DD') collate "C" between v_from and v_to
    union all
    -- lots created in range (not withdrawn)
    select kofi.kofi_day(l.created_at), coalesce(ar.working_name, 'Unknown artist'), 3, w.title, w.id,
      jsonb_build_object('artistId', w.artist_id, 'artistWorkingName', coalesce(ar.working_name, 'Unknown artist'),
        'artworkId', w.id, 'artworkTitle', w.title, 'kind', 'lot', 'where', coalesce(c.title, 'Deleted call'),
        'on', to_char(kofi.kofi_day(l.created_at), 'YYYY-MM-DD'))
    from kofi.lots l
    join kofi.artworks w on w.id = l.artwork_id
    left join kofi.artists ar on ar.id = w.artist_id
    left join kofi.open_calls c on c.id = l.call_id
    where l.status <> 'withdrawn' and to_char(kofi.kofi_day(l.created_at), 'YYYY-MM-DD') collate "C" between v_from and v_to
    union all
    -- sales in range
    select kofi.kofi_day((l.sale ->> 'soldAt')::timestamptz), coalesce(ar.working_name, 'Unknown artist'), 4, w.title, w.id,
      jsonb_build_object('artistId', w.artist_id, 'artistWorkingName', coalesce(ar.working_name, 'Unknown artist'),
        'artworkId', w.id, 'artworkTitle', w.title, 'kind', 'sale', 'where', coalesce(c.title, 'Deleted call'),
        'on', to_char(kofi.kofi_day((l.sale ->> 'soldAt')::timestamptz), 'YYYY-MM-DD'),
        'amount', l.sale -> 'hammerPrice', 'currency', l.sale ->> 'currency')
    from kofi.lots l
    join kofi.artworks w on w.id = l.artwork_id
    left join kofi.artists ar on ar.id = w.artist_id
    left join kofi.open_calls c on c.id = l.call_id
    where l.status = 'sold' and l.sale is not null
      and to_char(kofi.kofi_day((l.sale ->> 'soldAt')::timestamptz), 'YYYY-MM-DD') collate "C" between v_from and v_to
  ) r;

  select coalesce(jsonb_agg(r.row order by r.on_day desc, r.name, r.payout_id), '[]'::jsonb) into v_pay
  from (
    select
      kofi.kofi_day((l.sale ->> 'soldAt')::timestamptz) as on_day,
      coalesce(ar.working_name, 'Unknown artist') as name,
      p.id as payout_id,
      jsonb_strip_nulls(jsonb_build_object(
        'payoutId', p.id,
        'artistId', p.artist_id,
        'artistWorkingName', coalesce(ar.working_name, 'Unknown artist'),
        'artworkTitle', coalesce(w.title, 'Deleted work'),
        'callTitle', coalesce(c.title, 'Deleted call'),
        'lotNumber', l.lot_number,
        'hammerPrice', l.sale -> 'hammerPrice',
        'artistAmount', l.sale -> 'artistAmount',
        'kofiAmount', l.sale -> 'kofiAmount',
        'partnerAmount', l.sale -> 'partnerAmount',
        'buyerPremium', l.sale -> 'buyerPremium',
        'currency', l.sale ->> 'currency',
        'status', p.status,
        'soldOn', to_char(kofi.kofi_day((l.sale ->> 'soldAt')::timestamptz), 'YYYY-MM-DD'),
        'paidOn', to_char(kofi.kofi_day(p.paid_at), 'YYYY-MM-DD'),
        'method', nullif(p.method, ''),
        'reference', nullif(p.reference, ''))) as row
    from kofi.payouts p
    join kofi.lots l on l.id = p.lot_id
    left join kofi.artworks w on w.id = l.artwork_id
    left join kofi.open_calls c on c.id = l.call_id
    left join kofi.artists ar on ar.id = p.artist_id
    -- A void payout belongs to a voided sale: never joined to the lot's current sale.
    where p.status <> 'void' and l.sale is not null
      and to_char(kofi.kofi_day((l.sale ->> 'soldAt')::timestamptz), 'YYYY-MM-DD') collate "C" between v_from and v_to
  ) r;

  perform kofi.write_audit('report.export', 'report', v_from || '_' || v_to, jsonb_build_object('from', v_from, 'to', v_to));
  return jsonb_build_object('participation', v_part, 'placements', v_place, 'payments', v_pay);
end $$;
revoke execute on function kofi.kofi_report(text, text) from public, anon;
grant execute on function kofi.kofi_report(text, text) to authenticated;

-- ------------------------------------------------------------ privileges ----
-- Nothing by default (0000); grant back exactly what each role needs.
revoke all on kofi.lots, kofi.payouts, kofi.lots_visible, kofi.payouts_visible from anon, authenticated;

-- Open calls: partners write kind / organiser / terms too (RLS + the guard trigger decide).
grant insert (kind, organizer_institution_id, terms), update (kind, organizer_institution_id, terms)
  on kofi.open_calls to authenticated;

-- Lots: read (RLS) every column except the sale (kofi.lots_visible redacts it); no writes (RPCs).
grant select (id, call_id, application_id, artwork_id, artist_id, lot_number, reserve, starting_bid, status,
              created_at, updated_at)
  on kofi.lots to authenticated;
grant select on kofi.lots_visible to authenticated;

-- Payouts: Kofi and the artist read (RLS); no writes (set_payout_status).
grant select on kofi.payouts to authenticated;
grant select on kofi.payouts_visible to authenticated;

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

grant all on kofi.lots, kofi.payouts, kofi.lots_visible, kofi.payouts_visible to service_role;
grant all on all functions in schema kofi to service_role;

-- ------------------------------------------------------------------- RLS ----
alter table kofi.lots enable row level security;
alter table kofi.payouts enable row level security;

-- Open calls: published for everyone; drafts for Kofi and the call's partner.
-- Partners insert / update their own institution's calls (the guard trigger forces
-- draft-only, organiser = theirs). Deletes stay Kofi-only (0008's policy).
drop policy if exists open_calls_select on kofi.open_calls;
drop policy if exists open_calls_insert_admin on kofi.open_calls;
drop policy if exists open_calls_update_admin on kofi.open_calls;
drop policy if exists open_calls_insert on kofi.open_calls;
drop policy if exists open_calls_update on kofi.open_calls;
create policy open_calls_select on kofi.open_calls for select to anon, authenticated
  using (published or kofi.is_admin()
         or (organizer_institution_id is not null and organizer_institution_id = kofi.my_verified_institution_id()));
create policy open_calls_insert on kofi.open_calls for insert to authenticated
  with check (kofi.is_admin()
              or (organizer_institution_id is not null and organizer_institution_id = kofi.my_verified_institution_id()));
create policy open_calls_update on kofi.open_calls for update to authenticated
  using (kofi.is_admin()
         or (organizer_institution_id is not null and organizer_institution_id = kofi.my_verified_institution_id()))
  with check (kofi.is_admin()
              or (organizer_institution_id is not null and organizer_institution_id = kofi.my_verified_institution_id()));

-- Applications: the artist, Kofi, and the call's partner.
drop policy if exists applications_select on kofi.applications;
create policy applications_select on kofi.applications for select to authenticated
  using (artist_id = kofi.my_artist_id() or kofi.is_call_organizer(call_id));

drop policy if exists lots_select on kofi.lots;
create policy lots_select on kofi.lots for select to authenticated
  using (kofi.is_call_organizer(call_id) or artist_id = kofi.my_artist_id());

drop policy if exists payouts_select on kofi.payouts;
create policy payouts_select on kofi.payouts for select to authenticated
  using (kofi.is_admin() or artist_id = kofi.my_artist_id());

-- --------------------------------------------------------------- storage ----
-- Partners may add an image to a call they write (kofi-programme/open-calls/…,
-- the folder SupabaseDataSource uploads call images to). They cannot replace,
-- delete or list objects; Kofi's four "kofi programme admin …" policies are unchanged.
drop policy if exists "kofi programme partner insert" on storage.objects;
create policy "kofi programme partner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'kofi-programme' and starts_with(name, 'open-calls/') and kofi.my_verified_institution_id() is not null);

-- -------------------------------------------------------------- realtime ----
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping realtime setup';
    return;
  end if;
  foreach t in array array['lots', 'payouts'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'kofi' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table kofi.%I', t);
    end if;
  end loop;
end $$;

insert into kofi.applied_migrations (name) values ('0009_sales') on conflict do nothing;

commit;

notify pgrst, 'reload schema';
