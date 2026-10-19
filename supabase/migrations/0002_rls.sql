-- =============================================================================
-- Kofi Collections — 0002 row-level security, column privileges, guards, audit
--
-- Layers (each one fails closed on its own):
--   1. Column privileges: sensitive columns (artist contact/legal name/full
--      region/Kofi notes/consent, artwork price) are NOT selectable by the
--      API roles at all. The redacting views in 0003 reach them only through
--      security-definer functions that re-check permission per row.
--   2. RLS on every table (row visibility mirrors src/domain/visibility.ts).
--   3. Guard triggers on direct client writes: what an owner / admin may change.
--      "Direct client write" = current_user is anon/authenticated. Code running
--      as the table owner (security-definer RPCs in 0005, service role, SQL
--      editor) is trusted and performs its own checks.
--   4. Audit triggers write append-only audit_events rows server-side, so the
--      audit trail does not depend on the client remembering to log.
-- =============================================================================

-- ------------------------------------------------------- identity helpers ----
-- All security definer + pinned search_path so they can read profiles /
-- artists / curators without recursing into those tables' RLS.

create or replace function kofi.current_role_of() returns kofi.role
language sql stable security definer set search_path = kofi, public as $$
  select coalesce((select p.role from kofi.profiles p where p.id = auth.uid()), 'public'::kofi.role)
$$;

create or replace function kofi.is_admin() returns boolean
language sql stable security definer set search_path = kofi, public as $$
  select kofi.current_role_of() = 'admin'
$$;

create or replace function kofi.my_artist_id() returns uuid
language sql stable security definer set search_path = kofi, public as $$
  select a.id
  from kofi.artists a
  join kofi.profiles p on p.id = a.user_id
  where a.user_id = auth.uid() and p.role = 'artist'
$$;

create or replace function kofi.my_curator_id() returns uuid
language sql stable security definer set search_path = kofi, public as $$
  select c.id
  from kofi.curators c
  join kofi.profiles p on p.id = c.user_id
  where c.user_id = auth.uid() and p.role = 'curator'
$$;

-- The verified flag always comes from the curator record, never the client.
create or replace function kofi.is_verified_curator() returns boolean
language sql stable security definer set search_path = kofi, public as $$
  select exists (
    select 1
    from kofi.curators c
    join kofi.profiles p on p.id = c.user_id
    where c.user_id = auth.uid() and p.role = 'curator' and c.status = 'verified'
  )
$$;

-- Exactly canSee() from src/domain/visibility.ts:
--   owner (artist role + own artist id) → true; admin → true;
--   public → anyone; institutions → verified curators; kofi/private → nobody else.
create or replace function kofi.can_see(level kofi.visibility, owner_artist_id uuid) returns boolean
language sql stable security definer set search_path = kofi, public as $$
  select case
    when owner_artist_id is not null and owner_artist_id = kofi.my_artist_id() then true
    when kofi.is_admin() then true
    when level = 'public' then true
    when level = 'institutions' then kofi.is_verified_curator()
    else false
  end
$$;

-- artistVisibleTo(): owner/admin always; otherwise approved AND can_see(profile visibility).
create or replace function kofi.artist_visible(p_artist_id uuid) returns boolean
language sql stable security definer set search_path = kofi, public as $$
  select coalesce((
    select a.id = kofi.my_artist_id()
        or kofi.is_admin()
        or (a.status = 'approved' and kofi.can_see(a.visibility, a.id))
    from kofi.artists a where a.id = p_artist_id
  ), false)
$$;

-- artworkVisibleTo(): owner/admin always; otherwise artist visible AND can_see(record visibility).
create or replace function kofi.artwork_visible(p_artwork_id uuid) returns boolean
language sql stable security definer set search_path = kofi, public as $$
  select coalesce((
    select w.artist_id = kofi.my_artist_id()
        or kofi.is_admin()
        or (kofi.artist_visible(w.artist_id) and kofi.can_see(w.visibility, w.artist_id))
    from kofi.artworks w where w.id = p_artwork_id
  ), false)
$$;

create or replace function kofi.owns_artwork(p_artwork_id uuid) returns boolean
language sql stable security definer set search_path = kofi, public as $$
  select exists (select 1 from kofi.artworks w where w.id = p_artwork_id and w.artist_id = kofi.my_artist_id())
$$;

create or replace function kofi.owns_shortlist(p_shortlist_id uuid) returns boolean
language sql stable security definer set search_path = kofi, public as $$
  select exists (select 1 from kofi.shortlists s where s.id = p_shortlist_id and s.curator_id = kofi.my_curator_id())
$$;

-- A curator may only shortlist work they are authorized to see, and never a
-- draft (private) or Kofi-only record.
create or replace function kofi.artwork_shortlistable(p_artwork_id uuid) returns boolean
language sql stable security definer set search_path = kofi, public as $$
  select kofi.artwork_visible(p_artwork_id)
     and exists (select 1 from kofi.artworks w where w.id = p_artwork_id and w.visibility not in ('private', 'kofi'))
$$;

-- Inquiries only go to approved, public artists, about public work of theirs the curator can see.
create or replace function kofi.inquiry_target_ok(p_artist_id uuid, p_artwork_id uuid) returns boolean
language sql stable security definer set search_path = kofi, public as $$
  select exists (select 1 from kofi.artists a where a.id = p_artist_id and a.status = 'approved' and a.visibility = 'public')
     and (
       p_artwork_id is null
       or exists (
         select 1 from kofi.artworks w
         where w.id = p_artwork_id and w.artist_id = p_artist_id and w.visibility = 'public'
           and kofi.artwork_visible(w.id)
       )
     )
$$;

create or replace function kofi.can_read_inquiry(p_inquiry_id uuid) returns boolean
language sql stable security definer set search_path = kofi, public as $$
  select coalesce((
    select kofi.is_admin()
        or i.curator_id = kofi.my_curator_id()
        or (i.artist_id = kofi.my_artist_id() and i.status <> 'pending')
    from kofi.inquiries i where i.id = p_inquiry_id
  ), false)
$$;

-- ------------------------------------------------------------ audit writer ---
-- The only path into audit_events. Actor is always derived from the JWT —
-- callers cannot choose who the event is attributed to.
create or replace function kofi.write_audit(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_meta jsonb default null,
  p_consent_version text default null
) returns void
language plpgsql security definer set search_path = kofi, public as $$
declare
  v_uid uuid := auth.uid();
  v_role kofi.role;
  v_name text;
  v_api boolean := nullif(current_setting('request.jwt.claims', true), '') is not null
                or nullif(current_setting('request.jwt.claim.sub', true), '') is not null;
begin
  -- Bulk demo restore (kofi.kofi_demo_reset in supabase/seed_content.sql) opts out
  -- for its own transaction. API clients cannot set this: PostgREST exposes
  -- no way to run SET/set_config, and no API-callable function sets it.
  if current_setting('kofi.seeding', true) = 'on' then
    return;
  end if;
  if v_uid is not null then
    select p.role, nullif(p.display_name, '') into v_role, v_name from kofi.profiles p where p.id = v_uid;
  end if;
  insert into kofi.audit_events (actor_id, actor_role, actor_name, action, entity_type, entity_id, meta, consent_version)
  values (
    coalesce(v_uid::text, case when v_api then 'anonymous' else 'system' end),
    coalesce(v_role, case when v_uid is null and not v_api then 'admin'::kofi.role else 'public'::kofi.role end),
    coalesce(v_name, case when v_uid is null and not v_api then 'Kofi backend' else coalesce(v_role::text, 'public') end),
    p_action, p_entity_type, p_entity_id, p_meta, p_consent_version
  );
end $$;

-- ----------------------------------------------------------- guard triggers --

create or replace function kofi.artists_guard() returns trigger
language plpgsql set search_path = kofi, public as $$
declare
  owner_editable text[] := array[
    'working_name', 'legal_name', 'pronouns', 'bio', 'statement',
    'region_city', 'region_region', 'region_country', 'region_precision',
    'mediums', 'career_stage',
    'experience_commissions', 'experience_public_art', 'experience_residencies',
    'experience_institutional_shows', 'experience_years_practicing',
    'availability_commissions', 'availability_sales', 'availability_exhibitions',
    'links', 'contact_email', 'contact_phone', 'contact_studio_address',
    'visibility', 'avatar_color', 'updated_at'
  ];
  admin_editable text[] := array['status', 'kofi_notes', 'updated_at'];
begin
  if current_user not in ('anon', 'authenticated') then
    return new; -- trusted server code (security-definer RPC, service role)
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.kofi_notes is not null
       or new.consent_version is not null or new.consent_accepted_at is not null then
      raise exception 'New profiles start as drafts. Review status, notes and consent are set by Kofi.'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if kofi.is_admin() and old.id is distinct from kofi.my_artist_id() then
    if (to_jsonb(new) - admin_editable) is distinct from (to_jsonb(old) - admin_editable) then
      raise exception 'Kofi staff can change review status and notes only. Artists edit their own profiles.'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    raise exception 'Only Kofi staff can change review status.' using errcode = '42501';
  end if;
  if new.kofi_notes is distinct from old.kofi_notes then
    raise exception 'Kofi notes are written by Kofi staff.' using errcode = '42501';
  end if;
  if (to_jsonb(new) - owner_editable) is distinct from (to_jsonb(old) - owner_editable) then
    raise exception 'That field cannot be changed here.' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger artists_guard before insert or update on kofi.artists
  for each row execute function kofi.artists_guard();

create or replace function kofi.artworks_guard() returns trigger
language plpgsql set search_path = kofi, public as $$
declare
  admin_editable text[] := array['reviewed_at', 'updated_at'];
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.reviewed_at is not null then
      raise exception 'Only Kofi staff can mark work as reviewed.' using errcode = '42501';
    end if;
    return new;
  end if;
  if kofi.is_admin() and old.artist_id is distinct from kofi.my_artist_id() then
    if (to_jsonb(new) - admin_editable) is distinct from (to_jsonb(old) - admin_editable) then
      raise exception 'Kofi staff can only mark work as reviewed.' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.reviewed_at is distinct from old.reviewed_at then
    raise exception 'Only Kofi staff can mark work as reviewed.' using errcode = '42501';
  end if;
  if new.id <> old.id or new.artist_id <> old.artist_id or new.created_at <> old.created_at then
    raise exception 'That field cannot be changed here.' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger artworks_guard before insert or update on kofi.artworks
  for each row execute function kofi.artworks_guard();

create or replace function kofi.curators_guard() returns trigger
language plpgsql set search_path = kofi, public as $$
declare
  admin_editable text[] := array['status', 'verification_note', 'verified_at', 'updated_at'];
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.verification_note is not null or new.verified_at is not null then
      raise exception 'New verification requests start as pending.' using errcode = '42501';
    end if;
    return new;
  end if;
  if kofi.is_admin() and old.user_id is distinct from auth.uid() then
    if (to_jsonb(new) - admin_editable) is distinct from (to_jsonb(old) - admin_editable) then
      raise exception 'Kofi staff can change verification status and notes only.' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status
     or new.verification_note is distinct from old.verification_note
     or new.verified_at is distinct from old.verified_at then
    raise exception 'Only Kofi staff can change verification status.' using errcode = '42501';
  end if;
  if new.id <> old.id or new.user_id <> old.user_id or new.created_at <> old.created_at then
    raise exception 'That field cannot be changed here.' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger curators_guard before insert or update on kofi.curators
  for each row execute function kofi.curators_guard();

-- Inquiry status machine. Applies to every authenticated caller, including
-- calls made through the set_inquiry_status RPC (it keys off auth.uid(), not
-- current_user). Only JWT-less backend maintenance bypasses it.
create or replace function kofi.inquiries_transition() returns trigger
language plpgsql set search_path = kofi, public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null and current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  -- ON DELETE SET NULL from artworks (the artist deleted the work). API roles
  -- have no UPDATE privilege on artwork_id, so this can only be the FK action.
  if old.artwork_id is not null and new.artwork_id is null
     and (to_jsonb(new) - array['artwork_id', 'updated_at']) = (to_jsonb(old) - array['artwork_id', 'updated_at']) then
    return new;
  end if;
  if new.id <> old.id or new.curator_id <> old.curator_id or new.artist_id <> old.artist_id
     or new.artwork_id is distinct from old.artwork_id or new.message <> old.message
     or new.created_at <> old.created_at then
    raise exception 'The request itself cannot be edited.' using errcode = '42501';
  end if;
  if kofi.is_admin() then
    if new.status not in ('forwarded', 'declined') then
      raise exception 'Kofi can forward or decline; the artist accepts.' using errcode = '42501';
    end if;
    if old.status <> 'pending' then
      raise exception 'This inquiry has already been decided.' using errcode = '22023';
    end if;
  elsif old.artist_id = kofi.my_artist_id() then
    if old.status <> 'forwarded' then
      raise exception 'Only forwarded inquiries can be answered.' using errcode = '22023';
    end if;
    if new.status not in ('accepted', 'declined') then
      raise exception 'Artists accept or decline.' using errcode = '42501';
    end if;
  else
    raise exception 'You do not have access to this.' using errcode = '42501';
  end if;
  new.decided_at := now();
  new.decided_by := v_uid::text;
  new.staff_note := coalesce(nullif(btrim(new.staff_note), ''), old.staff_note);
  return new;
end $$;

create trigger inquiries_transition before update on kofi.inquiries
  for each row execute function kofi.inquiries_transition();

-- ----------------------------------------------------------- audit triggers --

create or replace function kofi.artists_audit() returns trigger
language plpgsql security definer set search_path = kofi, public as $$
declare
  ignore_cols text[] := array['updated_at', 'kofi_notes'];
begin
  if tg_op = 'INSERT' then
    perform kofi.write_audit('artist.create', 'artist', new.id::text);
  elsif new.status is distinct from old.status then
    perform kofi.write_audit('artist.status', 'artist', new.id::text, jsonb_build_object('status', new.status));
  elsif new.consent_version is distinct from old.consent_version or new.consent_accepted_at is distinct from old.consent_accepted_at then
    perform kofi.write_audit('artist.consent', 'artist', new.id::text,
      jsonb_build_object('version', new.consent_version), new.consent_version);
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

create trigger artists_audit after insert or update on kofi.artists
  for each row execute function kofi.artists_audit();

create or replace function kofi.artworks_audit() returns trigger
language plpgsql security definer set search_path = kofi, public as $$
declare
  review_cols text[] := array['reviewed_at', 'updated_at'];
begin
  if tg_op = 'INSERT' then
    perform kofi.write_audit('artwork.create', 'artwork', new.id::text);
  elsif tg_op = 'DELETE' then
    perform kofi.write_audit('artwork.delete', 'artwork', old.id::text);
  elsif new.visibility is distinct from old.visibility or new.price_visibility is distinct from old.price_visibility then
    perform kofi.write_audit('artwork.visibility', 'artwork', new.id::text,
      jsonb_build_object('visibility', new.visibility, 'priceVisibility', new.price_visibility));
  elsif new.reviewed_at is distinct from old.reviewed_at and (to_jsonb(new) - review_cols) = (to_jsonb(old) - review_cols) then
    perform kofi.write_audit('artwork.update', 'artwork', new.id::text, jsonb_build_object('reviewed', true));
  else
    perform kofi.write_audit('artwork.update', 'artwork', new.id::text);
  end if;
  return null;
end $$;

create trigger artworks_audit after insert or update or delete on kofi.artworks
  for each row execute function kofi.artworks_audit();

create or replace function kofi.shortlists_audit() returns trigger
language plpgsql security definer set search_path = kofi, public as $$
begin
  if tg_op = 'INSERT' then
    perform kofi.write_audit('shortlist.create', 'shortlist', new.id::text);
  else
    perform kofi.write_audit('shortlist.delete', 'shortlist', old.id::text);
  end if;
  return null;
end $$;

create trigger shortlists_audit after insert or delete on kofi.shortlists
  for each row execute function kofi.shortlists_audit();

create or replace function kofi.shortlist_items_audit() returns trigger
language plpgsql security definer set search_path = kofi, public as $$
begin
  if tg_op = 'INSERT' then
    update kofi.shortlists set updated_at = now() where id = new.shortlist_id;
    perform kofi.write_audit('shortlist.add', 'shortlist', new.shortlist_id::text,
      jsonb_build_object('artworkId', new.artwork_id));
  else
    -- Rows removed by cascade (shortlist or artwork deleted) are not a curator action.
    if exists (select 1 from kofi.shortlists s where s.id = old.shortlist_id)
       and exists (select 1 from kofi.artworks w where w.id = old.artwork_id) then
      update kofi.shortlists set updated_at = now() where id = old.shortlist_id;
      perform kofi.write_audit('shortlist.remove', 'shortlist', old.shortlist_id::text,
        jsonb_build_object('artworkId', old.artwork_id));
    end if;
  end if;
  return null;
end $$;

create trigger shortlist_items_audit after insert or delete on kofi.shortlist_items
  for each row execute function kofi.shortlist_items_audit();

create or replace function kofi.documents_audit() returns trigger
language plpgsql security definer set search_path = kofi, public as $$
begin
  if tg_op = 'INSERT' then
    perform kofi.write_audit('document.add', 'document', new.id::text, jsonb_build_object('type', new.type));
  else
    perform kofi.write_audit('document.remove', 'document', old.id::text);
  end if;
  return null;
end $$;

create trigger documents_audit after insert or delete on kofi.documents
  for each row execute function kofi.documents_audit();

create or replace function kofi.curators_audit() returns trigger
language plpgsql security definer set search_path = kofi, public as $$
declare
  ignore_cols text[] := array['updated_at'];
begin
  if tg_op = 'INSERT' then
    perform kofi.write_audit('curator.request', 'curator', new.id::text);
  elsif (to_jsonb(new) - ignore_cols) = (to_jsonb(old) - ignore_cols) then
    null; -- no-op update
  elsif auth.uid() is not distinct from new.user_id then
    perform kofi.write_audit('curator.request', 'curator', new.id::text);
  else
    perform kofi.write_audit('curator.status', 'curator', new.id::text, jsonb_build_object('status', new.status));
  end if;
  return null;
end $$;

create trigger curators_audit after insert or update on kofi.curators
  for each row execute function kofi.curators_audit();

create or replace function kofi.inquiries_audit() returns trigger
language plpgsql security definer set search_path = kofi, public as $$
begin
  if tg_op = 'INSERT' then
    perform kofi.write_audit('inquiry.create', 'inquiry', new.id::text, jsonb_build_object('artistId', new.artist_id));
  elsif new.status is distinct from old.status then
    perform kofi.write_audit('inquiry.status', 'inquiry', new.id::text, jsonb_build_object('status', new.status));
  end if;
  return null;
end $$;

create trigger inquiries_audit after insert or update on kofi.inquiries
  for each row execute function kofi.inquiries_audit();

-- ------------------------------------------------------------- privileges ----
-- Start from nothing and grant back exactly what each role needs. (0000 gives
-- anon/authenticated no default table privileges in `kofi`, so the table
-- revoke is belt-and-braces. It is scoped to schema `kofi`: the other
-- product's grants in `public` are never touched.)
revoke all on all tables in schema kofi from anon, authenticated;

-- Internal helpers live in the API-exposed `kofi` schema, so take EXECUTE away
-- from every API role. Triggers still fire them (PostgreSQL checks EXECUTE on
-- a trigger function only when the trigger is created), and the
-- security-definer RPCs call write_audit() as the function owner.
revoke all on function kofi.write_audit(text, text, text, jsonb, text) from public, anon, authenticated;
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'kofi'::regnamespace and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

grant select on kofi.profiles to authenticated;
grant update (display_name) on kofi.profiles to authenticated;

-- Artists: contact_*, legal_name, region_*, kofi_notes, consent_*, user_id are
-- NOT selectable. Read them through kofi.artists_visible (0003).
grant select (
  id, working_name, pronouns, bio, statement, mediums, career_stage,
  experience_commissions, experience_public_art, experience_residencies,
  experience_institutional_shows, experience_years_practicing,
  availability_commissions, availability_sales, availability_exhibitions,
  links, visibility, status, avatar_color, created_at, updated_at
) on kofi.artists to anon, authenticated;
grant insert, update on kofi.artists to authenticated;

-- Artworks: price_amount / price_currency are NOT selectable. Read them through
-- kofi.artworks_visible (0003), which redacts per price_visibility.
grant select (
  id, artist_id, title, year, medium, materials, height, width, depth, unit,
  description, status, rights_note, price_visibility, visibility, tags,
  reviewed_at, created_at, updated_at
) on kofi.artworks to anon, authenticated;
grant insert, update, delete on kofi.artworks to authenticated;

grant select on kofi.artwork_images to anon, authenticated;
grant insert, update, delete on kofi.artwork_images to authenticated;

grant select on kofi.institutions to authenticated;

grant select, insert, update, delete on kofi.curators to authenticated;

grant select, insert, update, delete on kofi.shortlists to authenticated;
grant select, insert, update, delete on kofi.shortlist_items to authenticated;

grant select on kofi.inquiries to authenticated;
grant insert (curator_id, artist_id, artwork_id, message) on kofi.inquiries to authenticated;
grant update (status, staff_note) on kofi.inquiries to authenticated;
grant delete on kofi.inquiries to authenticated;

grant select, insert, delete on kofi.documents to authenticated;
grant update (type, title, custodian, date, artwork_id, visibility, file_name) on kofi.documents to authenticated;

grant select on kofi.consents to authenticated;
grant select on kofi.audit_events to authenticated;

-- -------------------------------------------------------------------- RLS ----
alter table kofi.profiles enable row level security;
alter table kofi.artists enable row level security;
alter table kofi.artworks enable row level security;
alter table kofi.artwork_images enable row level security;
alter table kofi.institutions enable row level security;
alter table kofi.curators enable row level security;
alter table kofi.shortlists enable row level security;
alter table kofi.shortlist_items enable row level security;
alter table kofi.inquiries enable row level security;
alter table kofi.documents enable row level security;
alter table kofi.consents enable row level security;
alter table kofi.audit_events enable row level security;

-- profiles
create policy profiles_select on kofi.profiles for select to authenticated
  using (id = auth.uid() or kofi.is_admin());
create policy profiles_update_self on kofi.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- artists
create policy artists_select on kofi.artists for select to anon, authenticated
  using (kofi.can_see(visibility, id) and (status = 'approved' or id = kofi.my_artist_id() or kofi.is_admin()));
create policy artists_insert_self on kofi.artists for insert to authenticated
  with check (user_id = auth.uid() and kofi.current_role_of() = 'artist');
create policy artists_update_owner on kofi.artists for update to authenticated
  using (id = kofi.my_artist_id()) with check (id = kofi.my_artist_id());
-- Admin may update status / kofi_notes only (artists_guard enforces the columns).
create policy artists_update_admin on kofi.artists for update to authenticated
  using (kofi.is_admin()) with check (kofi.is_admin());

-- artworks
create policy artworks_select on kofi.artworks for select to anon, authenticated
  using (
    artist_id = kofi.my_artist_id()
    or kofi.is_admin()
    or (kofi.can_see(visibility, artist_id) and kofi.artist_visible(artist_id))
  );
create policy artworks_insert_owner on kofi.artworks for insert to authenticated
  with check (artist_id = kofi.my_artist_id());
create policy artworks_update_owner on kofi.artworks for update to authenticated
  using (artist_id = kofi.my_artist_id()) with check (artist_id = kofi.my_artist_id());
-- Admin may set reviewed_at only (artworks_guard enforces the column).
create policy artworks_update_admin on kofi.artworks for update to authenticated
  using (kofi.is_admin()) with check (kofi.is_admin());
create policy artworks_delete_owner on kofi.artworks for delete to authenticated
  using (artist_id = kofi.my_artist_id());

-- artwork_images follow their artwork. Storage refs must point into the
-- owner's own folder, so nobody can "publish" another artist's private upload
-- by linking it from their own public work.
create policy artwork_images_select on kofi.artwork_images for select to anon, authenticated
  using (kofi.artwork_visible(artwork_id));
create policy artwork_images_insert_owner on kofi.artwork_images for insert to authenticated
  with check (
    kofi.owns_artwork(artwork_id)
    and (src like 'data:image/%' or starts_with(src, 'storage:artwork-images/' || kofi.my_artist_id()::text || '/'))
  );
create policy artwork_images_update_owner on kofi.artwork_images for update to authenticated
  using (kofi.owns_artwork(artwork_id))
  with check (
    kofi.owns_artwork(artwork_id)
    and (src like 'data:image/%' or starts_with(src, 'storage:artwork-images/' || kofi.my_artist_id()::text || '/'))
  );
create policy artwork_images_delete_owner on kofi.artwork_images for delete to authenticated
  using (kofi.owns_artwork(artwork_id));

-- institutions: curators and Kofi staff (mirrors listInstitutions).
create policy institutions_select on kofi.institutions for select to authenticated
  using (kofi.current_role_of() in ('curator', 'admin'));

-- curators
create policy curators_select on kofi.curators for select to authenticated
  using (user_id = auth.uid() or kofi.is_admin());
create policy curators_insert_self on kofi.curators for insert to authenticated
  with check (user_id = auth.uid() and kofi.current_role_of() = 'curator');
create policy curators_update_self on kofi.curators for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy curators_admin_all on kofi.curators for all to authenticated
  using (kofi.is_admin()) with check (kofi.is_admin());

-- shortlists / items: the curator owns them.
create policy shortlists_owner on kofi.shortlists for all to authenticated
  using (curator_id = kofi.my_curator_id()) with check (curator_id = kofi.my_curator_id());
create policy shortlist_items_select on kofi.shortlist_items for select to authenticated
  using (kofi.owns_shortlist(shortlist_id));
create policy shortlist_items_insert on kofi.shortlist_items for insert to authenticated
  with check (kofi.owns_shortlist(shortlist_id) and kofi.artwork_shortlistable(artwork_id));
create policy shortlist_items_update on kofi.shortlist_items for update to authenticated
  using (kofi.owns_shortlist(shortlist_id))
  with check (kofi.owns_shortlist(shortlist_id) and kofi.artwork_shortlistable(artwork_id));
create policy shortlist_items_delete on kofi.shortlist_items for delete to authenticated
  using (kofi.owns_shortlist(shortlist_id));

-- inquiries
create policy inquiries_select on kofi.inquiries for select to authenticated
  using (
    kofi.is_admin()
    or curator_id = kofi.my_curator_id()
    or (artist_id = kofi.my_artist_id() and status <> 'pending')
  );
create policy inquiries_insert_verified_curator on kofi.inquiries for insert to authenticated
  with check (
    kofi.is_verified_curator()
    and curator_id = kofi.my_curator_id()
    and status = 'pending' and decided_at is null and decided_by is null and staff_note is null
    and kofi.inquiry_target_ok(artist_id, artwork_id)
  );
create policy inquiries_update_admin on kofi.inquiries for update to authenticated
  using (kofi.is_admin()) with check (kofi.is_admin());
create policy inquiries_update_artist on kofi.inquiries for update to authenticated
  using (artist_id = kofi.my_artist_id() and status = 'forwarded')
  with check (artist_id = kofi.my_artist_id());
create policy inquiries_delete_admin on kofi.inquiries for delete to authenticated
  using (kofi.is_admin());

-- documents: the artist's private vault. Admin can list metadata; opening a
-- file goes through open_document() (0004), which logs the access.
create policy documents_owner on kofi.documents for all to authenticated
  using (artist_id = kofi.my_artist_id())
  with check (
    artist_id = kofi.my_artist_id()
    and starts_with(file_ref, kofi.my_artist_id()::text || '/')
    and (artwork_id is null or kofi.owns_artwork(artwork_id))
  );
create policy documents_admin_select on kofi.documents for select to authenticated
  using (kofi.is_admin());

-- consents / audit: read-only through the API (no insert/update/delete policies).
create policy consents_select on kofi.consents for select to authenticated
  using (user_id = auth.uid() or kofi.is_admin());
create policy audit_events_select_admin on kofi.audit_events for select to authenticated
  using (kofi.is_admin());
