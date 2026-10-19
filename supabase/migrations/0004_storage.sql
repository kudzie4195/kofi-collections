-- =============================================================================
-- Kofi Collections — 0004 storage
--
-- Both buckets are PRIVATE. Nothing is ever reachable through a permanent or
-- guessable public URL (guide §04). Clients obtain short-lived signed URLs
-- with storage.from(bucket).createSignedUrl(s); Supabase Storage checks the
-- SELECT policies below for the caller before it signs.
--
-- artwork-images  object name: <artist_id>/<image_id>.<ext>
--   "Public read only for images whose artwork is visible" cannot be expressed
--   with a public bucket (public buckets bypass RLS), so the bucket is private
--   and the read policy re-uses artwork_visible(): anyone — including anon —
--   can sign a URL for an image exactly when they can see its artwork.
--
-- vault           object name: <artist_id>/<document_id>
--   Owner: read/write/delete own folder.
--   Kofi admin: read only, and only within 2 minutes of a 'document.open'
--   audit row for that file written by open_document() for the same admin.
--   So an admin cannot sign a vault URL without leaving an audit trail.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('artwork-images', 'artwork-images', false, 6291456, array['image/jpeg', 'image/png', 'image/webp']),
  ('vault', 'vault', false, 10485760, null)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Whether the caller may read an artwork-images object.
create or replace function public.storage_image_readable(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select
    (public.my_artist_id() is not null and split_part(p_name, '/', 1) = public.my_artist_id()::text)
    or exists (
      select 1
      from public.artwork_images i
      join public.artworks w on w.id = i.artwork_id
      where i.src = 'storage:artwork-images/' || p_name
        and split_part(p_name, '/', 1) = w.artist_id::text
        and public.artwork_visible(w.id)
    )
$$;

-- Whether the caller (an admin) logged an open of this vault file in the last 2 minutes.
create or replace function public.vault_open_logged(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.documents d
    join public.audit_events e on e.entity_type = 'document' and e.entity_id = d.id::text
    where d.file_ref = p_name
      and e.action = 'document.open'
      and e.actor_id = auth.uid()::text
      and e.at > now() - interval '2 minutes'
  )
$$;

drop policy if exists "kofi artwork images read" on storage.objects;
drop policy if exists "kofi artwork images insert own" on storage.objects;
drop policy if exists "kofi artwork images update own" on storage.objects;
drop policy if exists "kofi artwork images delete own" on storage.objects;
drop policy if exists "kofi vault owner read" on storage.objects;
drop policy if exists "kofi vault owner insert" on storage.objects;
drop policy if exists "kofi vault owner update" on storage.objects;
drop policy if exists "kofi vault owner delete" on storage.objects;
drop policy if exists "kofi vault admin read after audit" on storage.objects;

create policy "kofi artwork images read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'artwork-images' and public.storage_image_readable(name));
create policy "kofi artwork images insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'artwork-images' and (storage.foldername(name))[1] = public.my_artist_id()::text);
create policy "kofi artwork images update own" on storage.objects for update to authenticated
  using (bucket_id = 'artwork-images' and (storage.foldername(name))[1] = public.my_artist_id()::text)
  with check (bucket_id = 'artwork-images' and (storage.foldername(name))[1] = public.my_artist_id()::text);
create policy "kofi artwork images delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'artwork-images' and (storage.foldername(name))[1] = public.my_artist_id()::text);

create policy "kofi vault owner read" on storage.objects for select to authenticated
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = public.my_artist_id()::text);
create policy "kofi vault owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'vault' and (storage.foldername(name))[1] = public.my_artist_id()::text);
create policy "kofi vault owner update" on storage.objects for update to authenticated
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = public.my_artist_id()::text)
  with check (bucket_id = 'vault' and (storage.foldername(name))[1] = public.my_artist_id()::text);
create policy "kofi vault owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = public.my_artist_id()::text);
create policy "kofi vault admin read after audit" on storage.objects for select to authenticated
  using (bucket_id = 'vault' and public.is_admin() and public.vault_open_logged(name));

-- Authorize + audit a vault open. Returns the object path inside the `vault`
-- bucket; the client then calls storage.from('vault').createSignedUrl(path, 60).
create or replace function public.open_document(p_doc_id uuid) returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  d public.documents%rowtype;
  v_owner boolean;
begin
  select * into d from public.documents where id = p_doc_id;
  if not found then
    raise exception 'Document not found.' using errcode = 'P0002';
  end if;
  v_owner := d.artist_id is not distinct from public.my_artist_id();
  if not v_owner and not public.is_admin() then
    raise exception 'This document is private.' using errcode = '42501';
  end if;
  perform kofi_private.write_audit('document.open', 'document', d.id::text, jsonb_build_object('byOwner', v_owner));
  return d.file_ref;
end $$;

revoke execute on function public.open_document(uuid) from public, anon;
