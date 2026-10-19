-- Kofi Collections — run this ONCE in the colorlabpro SQL editor (Dashboard → SQL).
-- Everything below lives in schema kofi except the realtime publication line, which only ADDS kofi tables.
-- 1) save_artwork RPC (the client needs it to save works)
create or replace function kofi.save_artwork(p_artwork jsonb, p_images jsonb) returns uuid
language plpgsql volatile security invoker set search_path = kofi, public as $$
declare
  v_artist uuid := kofi.my_artist_id();
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
    v_access := kofi.describe_access('artwork', v_id);
    if v_access = 'not_found' then
      raise exception 'Artwork not found.' using errcode = 'P0002';
    elsif v_access <> 'owner' then
      raise exception 'You can only edit your own work.' using errcode = '42501';
    end if;
    update kofi.artworks set
      title = p_artwork ->> 'title',
      year = (p_artwork ->> 'year')::integer,
      medium = (p_artwork ->> 'medium')::kofi.medium,
      materials = array(select jsonb_array_elements_text(coalesce(p_artwork -> 'materials', '[]'::jsonb))),
      height = (p_artwork #>> '{dimensions,height}')::numeric,
      width = (p_artwork #>> '{dimensions,width}')::numeric,
      depth = (p_artwork #>> '{dimensions,depth}')::numeric,
      unit = (p_artwork #>> '{dimensions,unit}')::kofi.unit,
      description = coalesce(p_artwork ->> 'description', ''),
      status = (p_artwork ->> 'status')::kofi.artwork_status,
      rights_note = coalesce(p_artwork ->> 'rightsNote', ''),
      price_amount = (p_artwork #>> '{price,amount}')::numeric,
      price_currency = p_artwork #>> '{price,currency}',
      price_visibility = (p_artwork ->> 'priceVisibility')::kofi.visibility,
      visibility = (p_artwork ->> 'visibility')::kofi.visibility,
      tags = array(select jsonb_array_elements_text(coalesce(p_artwork -> 'tags', '[]'::jsonb)))
    where id = v_id;
  else
    insert into kofi.artworks (
      artist_id, title, year, medium, materials, height, width, depth, unit, description,
      status, rights_note, price_amount, price_currency, price_visibility, visibility, tags
    ) values (
      v_artist,
      p_artwork ->> 'title',
      (p_artwork ->> 'year')::integer,
      (p_artwork ->> 'medium')::kofi.medium,
      array(select jsonb_array_elements_text(coalesce(p_artwork -> 'materials', '[]'::jsonb))),
      (p_artwork #>> '{dimensions,height}')::numeric,
      (p_artwork #>> '{dimensions,width}')::numeric,
      (p_artwork #>> '{dimensions,depth}')::numeric,
      (p_artwork #>> '{dimensions,unit}')::kofi.unit,
      coalesce(p_artwork ->> 'description', ''),
      (p_artwork ->> 'status')::kofi.artwork_status,
      coalesce(p_artwork ->> 'rightsNote', ''),
      (p_artwork #>> '{price,amount}')::numeric,
      p_artwork #>> '{price,currency}',
      (p_artwork ->> 'priceVisibility')::kofi.visibility,
      (p_artwork ->> 'visibility')::kofi.visibility,
      array(select jsonb_array_elements_text(coalesce(p_artwork -> 'tags', '[]'::jsonb)))
    )
    returning id into v_id;
  end if;

  v_keep := array(
    select (e ->> 'id')::uuid from jsonb_array_elements(p_images) e where nullif(e ->> 'id', '') is not null
  );
  delete from kofi.artwork_images where artwork_id = v_id and not (id = any (v_keep));
  insert into kofi.artwork_images (id, artwork_id, src, alt, is_primary, metadata_stripped, position)
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
grant execute on function kofi.save_artwork(jsonb, jsonb) to authenticated;
revoke execute on function kofi.save_artwork(jsonb, jsonb) from public, anon;

-- 2) realtime (optional; additive)

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping realtime setup';
    return;
  end if;
  foreach t in array array[
    'artists', 'artworks', 'artwork_images', 'curators', 'shortlists',
    'shortlist_items', 'inquiries', 'documents'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'kofi' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table kofi.%I', t);
    end if;
  end loop;
end $$;

-- 3) demo reset: not installed (content was seeded directly, without snapshot tables). Reseed by re-running seed_content.sql if ever needed.

insert into kofi.applied_migrations (name) values ('0005_save_artwork'), ('0006_realtime') on conflict do nothing;
notify pgrst, 'reload schema';
