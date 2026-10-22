-- =============================================================================
-- Kofi Collections — 0010 intake: sign-up, profile import, link verification
--
-- Mirrors the v5 section of src/domain/types.ts and the rules in
-- src/domain/intake.ts as the mock data source applies them. Needs 0000-0009.
--
--   artists.verification_token  kofi-xxxxxx (TOKEN_RE), unique, owner/admin
--                               only. Default kofi.make_verification_token()
--                               for every new row; existing rows are filled by
--                               the live patch / ensure_my_artist(), not here,
--                               so the demo artists can keep their fixed codes.
--   artists.imports             ProfileImportRecord[] (newest last, max 20),
--                               written only by record_import(). Owner/admin only.
--   artists.links               unchanged column; elements may now carry
--                               platform / handle / verification / checkedAt
--                               (CHECK artists_links_shape). verification and
--                               checkedAt are written by the checker only: a
--                               direct owner write keeps the previous value for
--                               the same URL, and a new URL starts 'claimed'
--                               (trigger artists_links_guard).
--
-- Read side: anon / authenticated can no longer SELECT artists.links directly;
-- kofi.artists_visible returns links through kofi.artist_intake(), which strips
-- verification / checkedAt for everyone but the owner and Kofi, and appends
-- verification_token + imports (owner/admin only, NULL otherwise).
--
-- RPCs:
--   ensure_my_artist()   the signed-in artist's draft profile (created on first
--                        call with a token and the consent from sign-up
--                        metadata); returns its id. kofi.handle_new_user is
--                        unchanged: it still creates the kofi.profiles row only.
--   record_import(jsonb) owner appends a ProfileImportRecord; audited artist.import.
--   set_link_verification(p_url, p_verification, p_checked_at, p_artist_id)
--                        the profile-import edge function (service role) sets any
--                        value; Kofi staff any value by hand (audited
--                        artist.links); the owner may only reset to 'claimed'.
--   log_audit()          now also accepts artist.import / artist.links (the
--                        edge function logs what it read, as the caller).
--
-- Everything is in schema kofi; nothing outside it is created or changed.
-- Idempotent and safe to re-run. Does not undo 0009 (it restates the audit
-- vocabulary as 0009's list plus the three new actions). Never re-run 0008
-- after 0009 / 0010; if that ever happens, run 0009 and then 0010 again.
-- =============================================================================

begin;

-- --------------------------------------------------------- prerequisites ----
do $$
begin
  if to_regclass('kofi.lots') is null or to_regclass('kofi.applied_migrations') is null
     or to_regprocedure('kofi.js_iso(timestamptz)') is null or to_regprocedure('kofi.try_uuid(text)') is null then
    raise exception '0010_intake needs 0009_sales first (kofi.lots / kofi.js_iso / kofi.try_uuid missing).';
  end if;
end $$;

-- --------------------------------------------------------- pure helpers -----
-- TOKEN_RE from src/domain/intake.ts.
create or replace function kofi.token_ok(p text) returns boolean
language sql immutable set search_path = kofi, public as $$
  select p ~ '^kofi-[abcdefghjkmnpqrstuvwxyz23456789]{6}$'
$$;

-- ArtistLink[] with the v5 keys: at most MAX_LINKS (6), only known keys, every
-- present key a string, url http(s), platform / verification from their lists.
create or replace function kofi.links_shape_ok(p jsonb) returns boolean
language sql immutable set search_path = kofi, public as $$
  select jsonb_typeof(p) = 'array'
     and jsonb_array_length(p) <= 6
     and not exists (
       select 1 from jsonb_array_elements(p) e
       where jsonb_typeof(e) <> 'object'
          or exists (select 1 from jsonb_object_keys(e) k where k not in ('label', 'url', 'platform', 'handle', 'verification', 'checkedAt'))
          or exists (select 1 from jsonb_each(e) kv where jsonb_typeof(kv.value) <> 'string')
          or not (e ? 'label') or char_length(e ->> 'label') > 120
          or not (e ? 'url') or char_length(e ->> 'url') > 2000 or (e ->> 'url') !~* '^https?://[^[:space:]]+$'
          or coalesce(e ->> 'platform', 'website') not in ('instagram', 'website', 'facebook', 'linkedin', 'tiktok', 'youtube', 'other')
          or char_length(coalesce(e ->> 'handle', '')) > 120
          or coalesce(e ->> 'verification', 'claimed') not in ('claimed', 'verified', 'failed', 'unreachable')
          or char_length(coalesce(e ->> 'checkedAt', '')) > 40
     )
$$;

-- What anyone but the owner / Kofi sees of a link: label, url, platform, handle.
create or replace function kofi.links_public(p jsonb) returns jsonb
language sql immutable set search_path = kofi, public as $$
  select coalesce(jsonb_agg(
           case when jsonb_typeof(e) = 'object'
                then jsonb_strip_nulls(jsonb_build_object('label', e -> 'label', 'url', e -> 'url', 'platform', e -> 'platform', 'handle', e -> 'handle'))
                else e end
           order by o), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) with ordinality as t (e, o)
$$;

-- The links without the checker's bookkeeping (for the audit trigger).
create or replace function kofi.links_core(p jsonb) returns jsonb
language sql immutable set search_path = kofi, public as $$
  select coalesce(jsonb_agg(case when jsonb_typeof(e) = 'object' then e - 'verification' - 'checkedAt' else e end order by o), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) with ordinality as t (e, o)
$$;

-- makeVerificationToken(): six characters from the read-aloud alphabet, unused.
-- Definer because it checks uniqueness on a column the API roles cannot read;
-- it is the column default, so the inserting role must be able to execute it.
create or replace function kofi.make_verification_token() returns text
language plpgsql volatile security definer set search_path = kofi, public as $$
declare
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  b bytea;
  t text;
begin
  loop
    b := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    t := 'kofi-';
    for i in 0..5 loop
      t := t || substr(alphabet, 1 + (get_byte(b, i) % 31), 1);
    end loop;
    exit when not exists (select 1 from kofi.artists a where a.verification_token = t);
  end loop;
  return t;
end $$;
revoke all on function kofi.make_verification_token() from public, anon;
grant execute on function kofi.make_verification_token() to authenticated, service_role;

-- ------------------------------------------------------------- columns ------
alter table kofi.artists add column if not exists verification_token text;
alter table kofi.artists add column if not exists imports jsonb not null default '[]'::jsonb;
alter table kofi.artists alter column verification_token set default kofi.make_verification_token();
create unique index if not exists artists_verification_token_key on kofi.artists (verification_token);

alter table kofi.artists drop constraint if exists artists_verification_token_format;
alter table kofi.artists add constraint artists_verification_token_format
  check (verification_token is null or kofi.token_ok(verification_token));
alter table kofi.artists drop constraint if exists artists_imports_shape;
alter table kofi.artists add constraint artists_imports_shape
  check (jsonb_typeof(imports) = 'array' and jsonb_array_length(imports) <= 20);
-- NOT VALID: enforced on every write from now on without failing on a live row
-- written before 0010; validated right away when every row already conforms.
alter table kofi.artists drop constraint if exists artists_links_shape;
alter table kofi.artists add constraint artists_links_shape check (kofi.links_shape_ok(links)) not valid;
do $$
begin
  if not exists (select 1 from kofi.artists where not kofi.links_shape_ok(links)) then
    alter table kofi.artists validate constraint artists_links_shape;
  else
    raise notice '0010: some artists.links rows predate the v5 shape; artists_links_shape stays NOT VALID (new writes are checked).';
  end if;
end $$;

-- ------------------------------------------------------ audit vocabulary ----
-- 0009's list plus artist.signup / artist.import / artist.links.
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
  'lot.save', 'lot.sale', 'lot.delete', 'payout.status', 'report.export',
  'artist.signup', 'artist.import', 'artist.links'
));

-- ------------------------------------------------------------- triggers -----
-- Direct client writes (anon / authenticated) cannot choose a token, imports or
-- a link's verification. Server code (definer RPCs, service role) is trusted.
-- artists_guard (0002) already refuses owner / admin edits of the token and
-- imports columns (they are not in its editable lists); this trigger handles
-- the inside of the links array, which the owner may edit.
create or replace function kofi.artists_links_guard() returns trigger
language plpgsql set search_path = kofi, public as $$
declare
  v_out jsonb := '[]'::jsonb;
  e jsonb;
  prev jsonb;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.verification_token := kofi.make_verification_token();
    new.imports := '[]'::jsonb;
  elsif new.links is not distinct from old.links then
    return new;
  end if;
  if jsonb_typeof(new.links) <> 'array' then
    return new; -- artists_links_array / artists_links_shape reject it
  end if;
  for e in select x from jsonb_array_elements(new.links) x loop
    if jsonb_typeof(e) = 'object' then
      prev := null;
      if tg_op = 'UPDATE' and jsonb_typeof(old.links) = 'array' then
        select o into prev from jsonb_array_elements(old.links) o
        where jsonb_typeof(o) = 'object' and lower(o ->> 'url') = lower(e ->> 'url')
        limit 1;
      end if;
      e := e - 'verification' - 'checkedAt';
      if prev ? 'verification' then
        e := e || jsonb_build_object('verification', prev -> 'verification');
        if prev ? 'checkedAt' then
          e := e || jsonb_build_object('checkedAt', prev -> 'checkedAt');
        end if;
      else
        e := e || '{"verification": "claimed"}'::jsonb;
      end if;
    end if;
    v_out := v_out || jsonb_build_array(e);
  end loop;
  new.links := v_out;
  return new;
end $$;
revoke all on function kofi.artists_links_guard() from public, anon, authenticated;

drop trigger if exists artists_links_guard on kofi.artists;
create trigger artists_links_guard before insert or update on kofi.artists
  for each row execute function kofi.artists_links_guard();

-- 0002's artists_audit, plus: a change that only touches the intake bookkeeping
-- (imports, the token, a link's verification / checkedAt) is not logged here —
-- record_import / set_link_verification / ensure_my_artist log their own
-- artist.import / artist.links / artist.signup events.
create or replace function kofi.artists_audit() returns trigger
language plpgsql security definer set search_path = kofi, public as $$
declare
  ignore_cols text[] := array['updated_at', 'kofi_notes'];
  intake_cols text[] := array['imports', 'verification_token', 'links'];
begin
  if tg_op = 'INSERT' then
    perform kofi.write_audit('artist.create', 'artist', new.id::text);
  elsif new.status is distinct from old.status then
    perform kofi.write_audit('artist.status', 'artist', new.id::text, jsonb_build_object('status', new.status));
  elsif new.consent_version is distinct from old.consent_version or new.consent_accepted_at is distinct from old.consent_accepted_at then
    perform kofi.write_audit('artist.consent', 'artist', new.id::text,
      jsonb_build_object('version', new.consent_version), new.consent_version);
  elsif (new.imports is distinct from old.imports or new.verification_token is distinct from old.verification_token
         or new.links is distinct from old.links)
        and (to_jsonb(new) - ignore_cols - intake_cols) = (to_jsonb(old) - ignore_cols - intake_cols)
        and kofi.links_core(new.links) = kofi.links_core(old.links) then
    null;
  elsif (to_jsonb(new) - ignore_cols) = (to_jsonb(old) - ignore_cols) then
    if new.kofi_notes is distinct from old.kofi_notes then
      perform kofi.write_audit('artist.update', 'artist', new.id::text, jsonb_build_object('field', 'kofiNotes'));
    end if;
  elsif new.visibility is distinct from old.visibility then
    perform kofi.write_audit('artist.update', 'artist', new.id::text, jsonb_build_object('visibility', new.visibility));
  else
    perform kofi.write_audit('artist.update', 'artist', new.id::text);
  end if;
  return null;
end $$;
revoke all on function kofi.artists_audit() from public, anon, authenticated;

-- ------------------------------------------------------- read projection ----
-- Owner / Kofi: the stored links, the token and the import history. Everyone
-- else who may see the artist: links without verification / checkedAt, NULL
-- token and imports. No row when the caller may not see the artist at all.
create or replace function kofi.artist_intake(p_artist_id uuid)
returns table (links jsonb, verification_token text, imports jsonb)
language sql stable security definer set search_path = kofi, public as $$
  select
    case when x.privileged then a.links else kofi.links_public(a.links) end,
    case when x.privileged then a.verification_token end,
    case when x.privileged then a.imports end
  from kofi.artists a
  cross join lateral (select (a.id = kofi.my_artist_id() or kofi.is_admin()) as privileged) x
  where a.id = p_artist_id and kofi.artist_visible(a.id)
$$;

-- Same columns and order as 0003 (links now from artist_intake), plus
-- verification_token and imports appended.
create or replace view kofi.artists_visible with (security_invoker = true) as
select
  a.id,
  a.working_name,
  a.pronouns,
  a.bio,
  a.statement,
  a.mediums,
  a.career_stage,
  a.experience_commissions,
  a.experience_public_art,
  a.experience_residencies,
  a.experience_institutional_shows,
  a.experience_years_practicing,
  a.availability_commissions,
  a.availability_sales,
  a.availability_exhibitions,
  coalesce(i.links, '[]'::jsonb) as links,
  a.status,
  a.visibility,
  a.avatar_color,
  a.created_at,
  a.updated_at,
  x.region_label,
  x.region_city,
  x.region_region,
  x.region_country,
  x.region_precision,
  x.legal_name,
  x.contact_email,
  x.contact_phone,
  x.contact_studio_address,
  x.kofi_notes,
  x.consent_version,
  x.consent_accepted_at,
  (a.id = kofi.my_artist_id() or kofi.is_admin()) as can_edit,
  i.verification_token,
  i.imports
from kofi.artists a
left join lateral kofi.artist_extras(a.id) x on true
left join lateral kofi.artist_intake(a.id) i on true;

-- ------------------------------------------------------------------ RPCs ----
-- The signed-in artist's profile. A Kofi sign-up (auth.signUp with
-- kofi_role = artist) gets a kofi.profiles row from handle_new_user; the
-- artists row is made here on the first call after sign-in (immediately when
-- the project does not ask for email confirmation): a private draft named after
-- the sign-up name, contact = the account email, a fresh token, and the
-- consent version the artist accepted on the form (kofi_consent_version in the
-- sign-up metadata), recorded in kofi.consents. Audited artist.create (trigger)
-- + artist.signup. An existing profile without a token gets one. Idempotent.
create or replace function kofi.ensure_my_artist() returns uuid
language plpgsql volatile security definer set search_path = kofi, public as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_name text;
  v_email text;
  v_meta jsonb;
  v_consent text;
  v_palette constant text[] := array['#2436F5', '#FF5C39', '#CFFF4A', '#FFD23F', '#5b41e6'];
begin
  if v_uid is null then
    raise exception 'Sign in to do this.' using errcode = '42501';
  end if;
  if kofi.current_role_of() <> 'artist' then
    raise exception 'Sign in as an artist to do this.' using errcode = '42501';
  end if;
  select a.id into v_id from kofi.artists a where a.user_id = v_uid;
  if found then
    update kofi.artists set verification_token = kofi.make_verification_token()
    where id = v_id and verification_token is null;
    return v_id;
  end if;
  select nullif(btrim(p.display_name), '') into v_name from kofi.profiles p where p.id = v_uid;
  select lower(u.email), coalesce(u.raw_user_meta_data, '{}'::jsonb) into v_email, v_meta from auth.users u where u.id = v_uid;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Your account has no email address Kofi can use.' using errcode = '22023', hint = 'email';
  end if;
  v_consent := nullif(btrim(v_meta ->> 'kofi_consent_version'), '');
  begin
    insert into kofi.artists (user_id, working_name, bio, region_region, region_country, region_precision,
                              contact_email, visibility, status, consent_version, consent_accepted_at, avatar_color)
    values (v_uid, left(coalesce(v_name, split_part(v_email, '@', 1)), 80), '', '', '', 'region',
            v_email, 'private', 'draft', v_consent, case when v_consent is not null then now() end,
            v_palette[1 + abs(hashtext(v_uid::text)) % array_length(v_palette, 1)])
    returning id into v_id;
  exception when unique_violation then
    select a.id into v_id from kofi.artists a where a.user_id = v_uid; -- a parallel call won
    return v_id;
  end;
  if v_consent is not null then
    insert into kofi.consents (user_id, artist_id, version) values (v_uid, v_id, v_consent);
  end if;
  perform kofi.write_audit('artist.signup', 'artist', v_id::text,
    jsonb_strip_nulls(jsonb_build_object('consentVersion', v_consent)), v_consent);
  return v_id;
end $$;

-- recordImport(): the owner appends what they accepted from one import.
-- Shape = ProfileImportRecord; only the known field names; newest last, max 20.
create or replace function kofi.record_import(p_record jsonb) returns void
language plpgsql volatile security definer set search_path = kofi, public as $$
declare
  v_artist uuid := kofi.my_artist_id();
  v_src jsonb;
  v_fields jsonb;
  v_notes jsonb;
  v_clean jsonb;
  v_all jsonb;
  f jsonb;
begin
  if v_artist is null then
    raise exception 'Sign in as an artist to do this.' using errcode = '42501';
  end if;
  if p_record is null or jsonb_typeof(p_record) <> 'object' then
    raise exception 'The import record is not valid.' using errcode = '22023', hint = 'imports';
  end if;
  v_src := p_record -> 'source';
  if jsonb_typeof(v_src) is distinct from 'object' or jsonb_typeof(v_src -> 'url') is distinct from 'string'
     or (v_src ->> 'url') !~* '^https?://[^[:space:]]+$' or char_length(v_src ->> 'url') > 2000 then
    raise exception 'The import source must be an http(s) link.' using errcode = '22023', hint = 'url';
  end if;
  if jsonb_typeof(p_record -> 'fetchedAt') is distinct from 'string' or char_length(p_record ->> 'fetchedAt') > 40 then
    raise exception 'The import record is not valid.' using errcode = '22023', hint = 'imports';
  end if;
  v_fields := coalesce(p_record -> 'appliedFields', '[]'::jsonb);
  if jsonb_typeof(v_fields) <> 'array' or jsonb_array_length(v_fields) > 9 then
    raise exception 'The import record is not valid.' using errcode = '22023', hint = 'imports';
  end if;
  for f in select x from jsonb_array_elements(v_fields) x loop
    if jsonb_typeof(f) <> 'string' or (f #>> '{}') not in ('workingName', 'bio', 'photoUrl', 'city', 'region', 'country', 'links', 'followers', 'postCount') then
      raise exception 'Unknown imported field.' using errcode = '22023', hint = 'imports';
    end if;
  end loop;
  v_notes := coalesce(p_record -> 'notes', '[]'::jsonb);
  if jsonb_typeof(v_notes) <> 'array' or jsonb_array_length(v_notes) > 10
     or exists (select 1 from jsonb_array_elements(v_notes) n where jsonb_typeof(n) <> 'string' or char_length(n #>> '{}') > 300) then
    raise exception 'The import record is not valid.' using errcode = '22023', hint = 'imports';
  end if;
  v_clean := jsonb_build_object(
    'source', jsonb_strip_nulls(jsonb_build_object(
      'label', left(coalesce(v_src ->> 'label', v_src ->> 'url'), 120),
      'url', v_src ->> 'url',
      'platform', case when (v_src ->> 'platform') in ('instagram', 'website', 'facebook', 'linkedin', 'tiktok', 'youtube', 'other') then v_src ->> 'platform' end,
      'handle', left(v_src ->> 'handle', 120))),
    'fetchedAt', p_record ->> 'fetchedAt',
    'appliedFields', (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements(v_fields) x),
    'notes', v_notes);
  select coalesce(a.imports, '[]'::jsonb) || jsonb_build_array(v_clean) into v_all from kofi.artists a where a.id = v_artist;
  if jsonb_array_length(v_all) > 20 then
    select jsonb_agg(e order by o) into v_all
    from jsonb_array_elements(v_all) with ordinality t (e, o)
    where o > jsonb_array_length(v_all) - 20;
  end if;
  update kofi.artists set imports = v_all where id = v_artist;
  perform kofi.write_audit('artist.import', 'artist', v_artist::text,
    jsonb_build_object('stage', 'applied', 'url', v_src ->> 'url', 'appliedFields', v_clean -> 'appliedFields'));
end $$;

-- One link's check result. Callers:
--   the profile-import edge function with the service-role key (any value; it
--     read the artist's token itself through artists_visible as the caller,
--     fetched the page and compared the token itself) — not audited here, the
--     function logs artist.links as the requesting user;
--   psql / the SQL editor (no JWT): trusted, as above;
--   Kofi staff: any value by hand, for any artist (audited artist.links);
--   the owner: only back to 'claimed' (a check result cannot be self-asserted).
-- Returns the artist's links after the change.
create or replace function kofi.set_link_verification(
  p_url text, p_verification text, p_checked_at timestamptz default now(), p_artist_id uuid default null
) returns jsonb
language plpgsql volatile security definer set search_path = kofi, public as $$
declare
  v_uid uuid := auth.uid();
  -- 'role' is the SET ROLE of the caller (PostgREST sets it per request); a
  -- definer function changes current_user, not this setting.
  v_role text := coalesce(current_setting('role', true), 'none');
  v_trusted boolean := coalesce(auth.role(), '') = 'service_role' or v_role = 'service_role'
                       or (v_uid is null and v_role not in ('anon', 'authenticated') and session_user <> 'authenticator');
  v_admin boolean := v_uid is not null and kofi.is_admin();
  v_artist uuid := coalesce(p_artist_id, kofi.my_artist_id());
  v_links jsonb;
  v_hit boolean := false;
  v_out jsonb := '[]'::jsonb;
  e jsonb;
begin
  if not v_trusted then
    if v_uid is null then
      raise exception 'Sign in to do this.' using errcode = '42501';
    end if;
    if not v_admin then
      if v_artist is null or v_artist is distinct from kofi.my_artist_id() then
        raise exception 'You do not have access to this.' using errcode = '42501';
      end if;
      if p_verification is distinct from 'claimed' then
        raise exception 'Links are verified by Kofi''s checker. Use Check my links.' using errcode = '42501';
      end if;
    end if;
  end if;
  if v_artist is null then
    raise exception 'Artist not found.' using errcode = 'P0002';
  end if;
  if p_verification is null or p_verification not in ('claimed', 'verified', 'failed', 'unreachable') then
    raise exception 'Unknown verification.' using errcode = '22023', hint = 'verification';
  end if;
  select a.links into v_links from kofi.artists a where a.id = v_artist;
  if not found then
    raise exception 'Artist not found.' using errcode = 'P0002';
  end if;
  for e in select x from jsonb_array_elements(coalesce(v_links, '[]'::jsonb)) x loop
    if jsonb_typeof(e) = 'object' and lower(e ->> 'url') = lower(btrim(coalesce(p_url, ''))) then
      v_hit := true;
      e := (e - 'verification' - 'checkedAt') || jsonb_build_object('verification', p_verification);
      if p_verification <> 'claimed' then
        e := e || jsonb_build_object('checkedAt', kofi.js_iso(coalesce(p_checked_at, now())));
      end if;
    end if;
    v_out := v_out || jsonb_build_array(e);
  end loop;
  if not v_hit then
    raise exception 'That link is not on this profile.' using errcode = 'P0002';
  end if;
  update kofi.artists set links = v_out where id = v_artist;
  if not v_trusted then
    perform kofi.write_audit('artist.links', 'artist', v_artist::text,
      jsonb_build_object('url', p_url, 'verification', p_verification, 'by', case when v_admin then 'staff' else 'owner' end));
  end if;
  return v_out;
end $$;

-- 0005's log_audit, plus artist.import / artist.links (what the edge function
-- read or checked, logged as the requesting user). An artist logs against
-- their own profile whatever entity id they pass; Kofi names a real artist.
create or replace function kofi.log_audit(
  p_action text, p_entity_type text, p_entity_id text, p_meta jsonb default null
) returns void
language plpgsql volatile security definer set search_path = kofi, public as $$
declare
  v_artist uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to do this.' using errcode = '42501';
  end if;
  if p_action not in ('private.view', 'artist.import', 'artist.links') then
    raise exception 'That action is recorded by the server, not the client.' using errcode = '42501';
  end if;
  if p_meta is not null and octet_length(p_meta::text) > 4096 then
    raise exception 'Audit detail is too long.' using errcode = '22023', hint = 'meta';
  end if;
  if p_action in ('artist.import', 'artist.links') then
    if kofi.my_artist_id() is not null then
      v_artist := kofi.my_artist_id();
    elsif kofi.is_admin() then
      v_artist := kofi.try_uuid(p_entity_id);
      if v_artist is null or not exists (select 1 from kofi.artists a where a.id = v_artist) then
        raise exception 'Artist not found.' using errcode = 'P0002';
      end if;
    else
      raise exception 'Sign in as an artist to do this.' using errcode = '42501';
    end if;
    perform kofi.write_audit(p_action, 'artist', v_artist::text, p_meta);
    return;
  end if;
  perform kofi.write_audit(p_action, p_entity_type, p_entity_id, p_meta);
end $$;

-- ------------------------------------------------------------ privileges ----
-- artists.links is read through artists_visible (artist_intake) only, so the
-- checker's verification never reaches a visitor by reading the table. The new
-- columns are not in 0002's column grant, so they are not selectable either.
revoke select (links) on kofi.artists from anon, authenticated;
revoke all on function kofi.artist_intake(uuid) from public, anon, authenticated;
grant execute on function kofi.artist_intake(uuid) to anon, authenticated;

revoke all on function kofi.ensure_my_artist() from public, anon;
grant execute on function kofi.ensure_my_artist() to authenticated;
revoke all on function kofi.record_import(jsonb) from public, anon;
grant execute on function kofi.record_import(jsonb) to authenticated;
revoke all on function kofi.set_link_verification(text, text, timestamptz, uuid) from public, anon;
grant execute on function kofi.set_link_verification(text, text, timestamptz, uuid) to authenticated, service_role;
revoke all on function kofi.log_audit(text, text, text, jsonb) from public, anon;
grant execute on function kofi.log_audit(text, text, text, jsonb) to authenticated;

revoke all on kofi.artists_visible from anon, authenticated;
grant select on kofi.artists_visible to anon, authenticated;

insert into kofi.applied_migrations (name) values ('0010_intake') on conflict do nothing;

commit;

notify pgrst, 'reload schema';
