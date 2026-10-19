-- =============================================================================
-- Kofi Collections — 0005 RPCs
--
-- Every privileged transition goes through a function that (a) checks the
-- caller's role from the JWT, never from arguments, (b) raises errors whose
-- SQLSTATE the client maps to ForbiddenError (42501) / NotFoundError (P0002) /
-- ValidationError (22023, HINT = form field), with the same messages as
-- src/data/mock/MockDataSource.ts, and (c) is audited — either explicitly here
-- or by the table's audit trigger (0002).
-- =============================================================================

-- Who the server thinks the caller is. The client uses this instead of
-- trusting its own Viewer object.
create or replace function public.whoami()
returns table (
  user_id uuid, role public.role, display_name text,
  artist_id uuid, curator_id uuid, curator_verified boolean
)
language sql stable security definer set search_path = public as $$
  select
    auth.uid(),
    public.current_role_of(),
    coalesce((select nullif(p.display_name, '') from public.profiles p where p.id = auth.uid()), 'Visitor'),
    public.my_artist_id(),
    public.my_curator_id(),
    public.is_verified_curator()
$$;

-- Distinguish "does not exist" from "exists but is not yours" so the client can
-- show the same NotFound/Forbidden messages as the mock. Reveals only whether
-- an (unguessable) uuid exists.
create or replace function public.describe_access(p_kind text, p_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if p_kind = 'artwork' then
    select artist_id into v_owner from public.artworks where id = p_id;
    if not found then return 'not_found'; end if;
    return case when v_owner = public.my_artist_id() then 'owner' else 'other' end;
  elsif p_kind = 'document' then
    select artist_id into v_owner from public.documents where id = p_id;
    if not found then return 'not_found'; end if;
    return case when v_owner = public.my_artist_id() then 'owner' else 'other' end;
  elsif p_kind = 'shortlist' then
    select curator_id into v_owner from public.shortlists where id = p_id;
    if not found then return 'not_found'; end if;
    return case when v_owner = public.my_curator_id() then 'owner' else 'other' end;
  end if;
  raise exception 'Unknown kind %', p_kind using errcode = '22023';
end $$;

-- Client-reported audit events. The actor always comes from the JWT. Only
-- events the server cannot observe itself may be logged this way.
create or replace function public.log_audit(
  p_action text, p_entity_type text, p_entity_id text, p_meta jsonb default null
) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to do this.' using errcode = '42501';
  end if;
  if p_action not in ('private.view') then
    raise exception 'That action is recorded by the server, not the client.' using errcode = '42501';
  end if;
  perform kofi_private.write_audit(p_action, p_entity_type, p_entity_id, p_meta);
end $$;

-- ------------------------------------------------------------- artist side ---

create or replace function public.accept_consent(p_version text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_artist uuid := public.my_artist_id();
begin
  if v_artist is null then
    raise exception 'Sign in as an artist to do this.' using errcode = '42501';
  end if;
  if p_version is null or btrim(p_version) = '' then
    raise exception 'Choose the consent version to accept.' using errcode = '22023', hint = 'consent';
  end if;
  -- artists_audit logs 'artist.consent' with the version.
  update public.artists set consent_version = p_version, consent_accepted_at = now() where id = v_artist;
  insert into public.consents (user_id, artist_id, version) values (auth.uid(), v_artist, p_version);
end $$;

create or replace function public.submit_for_review() returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  a public.artists%rowtype;
begin
  select * into a from public.artists where id = public.my_artist_id();
  if not found then
    raise exception 'Sign in as an artist to do this.' using errcode = '42501';
  end if;
  if a.consent_version is null then
    raise exception 'Accept the consent terms before submitting.' using errcode = '22023', hint = 'consent';
  end if;
  if a.status = 'approved' then
    return;
  end if;
  update public.artists set status = 'pending' where id = a.id; -- audited as artist.status
end $$;

-- Atomic create/update of an artwork and its image list. SECURITY INVOKER on
-- purpose: RLS, column privileges and artworks_guard all apply to the caller.
-- Storage uploads happen before this call (client), so p_images only carries
-- data:image/ URLs or storage refs inside the caller's own folder (policy).
create or replace function public.save_artwork(p_artwork jsonb, p_images jsonb) returns uuid
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_artist uuid := public.my_artist_id();
  v_id uuid := nullif(p_artwork ->> 'id', '')::uuid;
  v_access text;
  v_keep uuid[];
begin
  if v_artist is null then
    raise exception 'Sign in as an artist to do this.' using errcode = '42501';
  end if;
  if p_images is null or jsonb_typeof(p_images) <> 'array' then
    raise exception 'Unsupported image.' using errcode = '22023', hint = 'images';
  end if;
  if p_artwork ->> 'visibility' = 'public' and jsonb_array_length(p_images) = 0 then
    raise exception 'Add at least one image before publishing.' using errcode = '22023', hint = 'images';
  end if;

  if v_id is not null then
    v_access := public.describe_access('artwork', v_id);
    if v_access = 'not_found' then
      raise exception 'Artwork not found.' using errcode = 'P0002';
    elsif v_access <> 'owner' then
      raise exception 'You can only edit your own work.' using errcode = '42501';
    end if;
    update public.artworks set
      title = p_artwork ->> 'title',
      year = (p_artwork ->> 'year')::integer,
      medium = (p_artwork ->> 'medium')::public.medium,
      materials = array(select jsonb_array_elements_text(coalesce(p_artwork -> 'materials', '[]'::jsonb))),
      height = (p_artwork #>> '{dimensions,height}')::numeric,
      width = (p_artwork #>> '{dimensions,width}')::numeric,
      depth = (p_artwork #>> '{dimensions,depth}')::numeric,
      unit = (p_artwork #>> '{dimensions,unit}')::public.unit,
      description = coalesce(p_artwork ->> 'description', ''),
      status = (p_artwork ->> 'status')::public.artwork_status,
      rights_note = coalesce(p_artwork ->> 'rightsNote', ''),
      price_amount = (p_artwork #>> '{price,amount}')::numeric,
      price_currency = p_artwork #>> '{price,currency}',
      price_visibility = (p_artwork ->> 'priceVisibility')::public.visibility,
      visibility = (p_artwork ->> 'visibility')::public.visibility,
      tags = array(select jsonb_array_elements_text(coalesce(p_artwork -> 'tags', '[]'::jsonb)))
    where id = v_id;
  else
    insert into public.artworks (
      artist_id, title, year, medium, materials, height, width, depth, unit, description,
      status, rights_note, price_amount, price_currency, price_visibility, visibility, tags
    ) values (
      v_artist,
      p_artwork ->> 'title',
      (p_artwork ->> 'year')::integer,
      (p_artwork ->> 'medium')::public.medium,
      array(select jsonb_array_elements_text(coalesce(p_artwork -> 'materials', '[]'::jsonb))),
      (p_artwork #>> '{dimensions,height}')::numeric,
      (p_artwork #>> '{dimensions,width}')::numeric,
      (p_artwork #>> '{dimensions,depth}')::numeric,
      (p_artwork #>> '{dimensions,unit}')::public.unit,
      coalesce(p_artwork ->> 'description', ''),
      (p_artwork ->> 'status')::public.artwork_status,
      coalesce(p_artwork ->> 'rightsNote', ''),
      (p_artwork #>> '{price,amount}')::numeric,
      p_artwork #>> '{price,currency}',
      (p_artwork ->> 'priceVisibility')::public.visibility,
      (p_artwork ->> 'visibility')::public.visibility,
      array(select jsonb_array_elements_text(coalesce(p_artwork -> 'tags', '[]'::jsonb)))
    )
    returning id into v_id;
  end if;

  v_keep := array(
    select (e ->> 'id')::uuid from jsonb_array_elements(p_images) e where nullif(e ->> 'id', '') is not null
  );
  delete from public.artwork_images where artwork_id = v_id and not (id = any (v_keep));
  insert into public.artwork_images (id, artwork_id, src, alt, is_primary, metadata_stripped, position)
  select
    coalesce(nullif(e ->> 'id', '')::uuid, gen_random_uuid()),
    v_id,
    e ->> 'src',
    coalesce(e ->> 'alt', ''),
    coalesce((e ->> 'isPrimary')::boolean, false),
    coalesce((e ->> 'metadataStripped')::boolean, false),
    (o - 1)::integer
  from jsonb_array_elements(p_images) with ordinality as t (e, o)
  on conflict (id) do update set
    artwork_id = excluded.artwork_id,
    src = excluded.src,
    alt = excluded.alt,
    is_primary = excluded.is_primary,
    metadata_stripped = excluded.metadata_stripped,
    position = excluded.position;
  return v_id;
end $$;

create or replace function public.export_my_data() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_artist uuid := public.my_artist_id();
  v_result jsonb;
  v_works integer;
  v_docs integer;
begin
  if v_artist is null then
    raise exception 'Sign in as an artist to do this.' using errcode = '42501';
  end if;
  select count(*) into v_works from public.artworks where artist_id = v_artist;
  select count(*) into v_docs from public.documents where artist_id = v_artist;
  select jsonb_build_object(
    -- Everything the artist entered, minus Kofi's internal notes (staff-only, guide §04).
    'artist', (select to_jsonb(a) - 'kofi_notes' from public.artists a where a.id = v_artist),
    'artworks', coalesce((
      select jsonb_agg(
        to_jsonb(w) || jsonb_build_object('images', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', i.id, 'src', i.src, 'alt', i.alt,
            'isPrimary', i.is_primary, 'metadataStripped', i.metadata_stripped
          ) order by i.position, i.created_at)
          from public.artwork_images i where i.artwork_id = w.id
        ), '[]'::jsonb))
        order by w.created_at
      )
      from public.artworks w where w.artist_id = v_artist
    ), '[]'::jsonb),
    -- Metadata only: file_ref is stripped. The artist downloads files individually.
    'documents', coalesce((
      select jsonb_agg(to_jsonb(d) - 'file_ref' order by d.created_at)
      from public.documents d where d.artist_id = v_artist
    ), '[]'::jsonb)
  ) into v_result;
  perform kofi_private.write_audit('artist.export', 'artist', v_artist::text,
    jsonb_build_object('artworks', v_works, 'documents', v_docs));
  return v_result;
end $$;

-- ------------------------------------------------------------ curator side ---

create or replace function public.request_verification(
  p_name text, p_title text, p_work_email text, p_purpose text, p_institution jsonb
) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_inst_name text := btrim(coalesce(p_institution ->> 'name', ''));
  v_inst uuid;
  v_type public.institution_type;
  c public.curators%rowtype;
begin
  if auth.uid() is null or public.current_role_of() <> 'curator' then
    raise exception 'Sign in as a curator to request verification.' using errcode = '42501';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Your name is required.' using errcode = '22023', hint = 'name';
  end if;
  if p_work_email is null or p_work_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Use your institutional work email.' using errcode = '22023', hint = 'workEmail';
  end if;
  if v_inst_name = '' then
    raise exception 'Institution name is required.' using errcode = '22023', hint = 'institution';
  end if;
  if p_purpose is null or char_length(btrim(p_purpose)) < 20 then
    raise exception 'Tell Kofi what you are looking for (a sentence or two).' using errcode = '22023', hint = 'purpose';
  end if;

  select id into v_inst from public.institutions where lower(btrim(name)) = lower(v_inst_name);
  if not found then
    v_type := case
      when p_institution ->> 'type' in ('museum', 'gallery', 'university', 'nonprofit', 'corporate', 'municipal', 'other')
        then (p_institution ->> 'type')::public.institution_type
      else 'other'::public.institution_type
    end;
    insert into public.institutions (name, type, website, city, country)
    values (
      v_inst_name, v_type,
      nullif(btrim(coalesce(p_institution ->> 'website', '')), ''),
      nullif(btrim(coalesce(p_institution ->> 'city', '')), ''),
      coalesce(p_institution ->> 'country', '')
    )
    returning id into v_inst;
  end if;

  select * into c from public.curators where user_id = auth.uid();
  if found then
    if c.status = 'verified' then
      return c.id;
    end if;
    update public.curators set
      name = p_name, title = coalesce(p_title, ''), work_email = p_work_email, purpose = p_purpose,
      institution_id = v_inst, status = 'pending', verification_note = null
    where id = c.id;   -- audited as curator.request
    return c.id;
  end if;
  insert into public.curators (user_id, name, title, institution_id, work_email, purpose, status)
  values (auth.uid(), p_name, coalesce(p_title, ''), v_inst, p_work_email, p_purpose, 'pending')
  returning id into c.id;   -- audited as curator.request
  return c.id;
end $$;

-- Status changes go through the transition trigger (0002), which keys off the
-- caller's JWT, so the rules are identical whether the client calls this RPC
-- or issues an UPDATE directly.
create or replace function public.set_inquiry_status(
  p_inquiry_id uuid, p_status public.inquiry_status, p_note text default null
) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'You do not have access to this.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.inquiries where id = p_inquiry_id) then
    raise exception 'Inquiry not found.' using errcode = 'P0002';
  end if;
  update public.inquiries set status = p_status, staff_note = p_note where id = p_inquiry_id;
end $$;

-- --------------------------------------------------------------- Kofi admin ---

create or replace function public.set_artist_status(
  p_artist_id uuid, p_status public.artist_status, p_note text default null
) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Kofi staff only.' using errcode = '42501';
  end if;
  update public.artists set
    status = p_status,
    kofi_notes = case
      when nullif(btrim(coalesce(p_note, '')), '') is null then kofi_notes
      else concat_ws(E'\n', nullif(kofi_notes, ''), to_char(now() at time zone 'utc', 'YYYY-MM-DD') || ': ' || btrim(p_note))
    end
  where id = p_artist_id;   -- audited as artist.status
  if not found then
    raise exception 'Artist not found.' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.set_kofi_notes(p_artist_id uuid, p_notes text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Kofi staff only.' using errcode = '42501';
  end if;
  update public.artists set kofi_notes = p_notes where id = p_artist_id;   -- audited as artist.update {field: kofiNotes}
  if not found then
    raise exception 'Artist not found.' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.mark_artwork_reviewed(p_artwork_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Kofi staff only.' using errcode = '42501';
  end if;
  update public.artworks set reviewed_at = now() where id = p_artwork_id;   -- audited as artwork.update {reviewed: true}
  if not found then
    raise exception 'Artwork not found.' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.set_curator_status(
  p_curator_id uuid, p_status public.curator_status, p_note text default null
) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Kofi staff only.' using errcode = '42501';
  end if;
  update public.curators set
    status = p_status,
    verification_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), verification_note),
    verified_at = case when p_status = 'verified' then now() else null end
  where id = p_curator_id;   -- audited as curator.status
  if not found then
    raise exception 'Curator not found.' using errcode = 'P0002';
  end if;
end $$;

-- None of the mutating RPCs are callable without a session.
revoke execute on function public.log_audit(text, text, text, jsonb) from public, anon;
revoke execute on function public.accept_consent(text) from public, anon;
revoke execute on function public.submit_for_review() from public, anon;
revoke execute on function public.save_artwork(jsonb, jsonb) from public, anon;
revoke execute on function public.export_my_data() from public, anon;
revoke execute on function public.request_verification(text, text, text, text, jsonb) from public, anon;
revoke execute on function public.set_inquiry_status(uuid, public.inquiry_status, text) from public, anon;
revoke execute on function public.set_artist_status(uuid, public.artist_status, text) from public, anon;
revoke execute on function public.set_kofi_notes(uuid, text) from public, anon;
revoke execute on function public.mark_artwork_reviewed(uuid) from public, anon;
revoke execute on function public.set_curator_status(uuid, public.curator_status, text) from public, anon;
grant execute on function
  public.log_audit(text, text, text, jsonb),
  public.accept_consent(text),
  public.submit_for_review(),
  public.save_artwork(jsonb, jsonb),
  public.export_my_data(),
  public.request_verification(text, text, text, text, jsonb),
  public.set_inquiry_status(uuid, public.inquiry_status, text),
  public.set_artist_status(uuid, public.artist_status, text),
  public.set_kofi_notes(uuid, text),
  public.mark_artwork_reviewed(uuid),
  public.set_curator_status(uuid, public.curator_status, text),
  public.open_document(uuid)
to authenticated;
