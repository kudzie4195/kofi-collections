-- =============================================================================
-- Kofi Collections — schema isolation assertions (shared Supabase project)
--
-- Kofi lives entirely in schema `kofi`; the other product on the project owns
-- `public`. shim.sql recreated a slice of that product (public.profiles,
-- public.consent_records, public.admin_users, public.is_admin(), an
-- `on_auth_user_created` trigger, two real users) and fingerprinted `public`
-- BEFORE the Kofi migrations ran (kofi_test.baseline). These blocks prove:
--   * migrations + seed created nothing in, and changed nothing about, `public`
--   * `drop schema kofi cascade` removes Kofi completely and leaves `public`
--     (and the other product's auth trigger) untouched
--   * the API-exposed `kofi` schema does not hand out its internal helpers
-- Same conventions as rls_test.sql: RAISE EXCEPTION on failure, NOTICE 'ok: …'.
-- =============================================================================

\set ON_ERROR_STOP on
\set QUIET on

-- ------------------------------------------------- nothing landed in public --
do $$
declare
  n integer;
begin
  -- The Kofi table names must not exist in `public` — except public.profiles,
  -- which belongs to the other product and existed before the migrations ran.
  select count(*) into n from pg_tables
  where schemaname = 'public' and tablename in ('artists', 'artworks', 'documents', 'audit_events', 'consents');
  if n <> 0 then
    raise exception 'FAIL: % Kofi table(s) found in schema public', n;
  end if;
  select count(*) into n from pg_tables
  where schemaname = 'public' and tablename in ('profiles', 'artists', 'artworks', 'documents', 'audit_events', 'consents');
  if n <> 1 then
    raise exception 'FAIL: expected only the other product''s public.profiles among the Kofi table names in public, found %', n;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name in ('role', 'display_name')) then
    raise exception 'FAIL: public.profiles has Kofi columns — the migrations touched the other product''s table';
  end if;
  raise notice 'ok: no Kofi tables in public (count of artists/artworks/documents/audit_events/consents in public = 0; public.profiles is the other product''s, unchanged columns)';

  select count(*) into n from pg_tables
  where schemaname = 'kofi' and tablename in ('profiles', 'artists', 'artworks', 'documents', 'audit_events', 'consents');
  if n <> 6 then
    raise exception 'FAIL: expected the 6 core Kofi tables in schema kofi, found %', n;
  end if;
  raise notice 'ok: the core Kofi tables live in schema kofi';

  if (select fp from kofi_test.baseline) is distinct from kofi_test.public_fingerprint() then
    raise exception 'FAIL: schema public (objects, grants, policies, triggers, the other product''s rows or its auth.users trigger) changed during migrations + seed';
  end if;
  raise notice 'ok: public fingerprint identical before and after migrations + seed (objects, ACLs, policies, triggers, other-product rows)';

  if exists (select 1 from pg_namespace where nspname in ('kofi_private', 'kofi_demo')) then
    raise exception 'FAIL: a Kofi schema other than kofi exists';
  end if;
  raise notice 'ok: Kofi created exactly one schema (kofi)';
end $$;

-- --------------------------------------------------- shape of schema kofi ---
do $$
declare
  n integer;
begin
  select count(*) into n from pg_proc p
  where p.pronamespace = 'kofi'::regnamespace
    and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=kofi, public%';
  if n <> 0 then
    raise exception 'FAIL: % kofi function(s) without search_path = kofi, public', n;
  end if;
  select count(*) into n from pg_class c
  where c.relnamespace = 'kofi'::regnamespace and c.relkind = 'v'
    and not coalesce(c.reloptions @> array['security_invoker=true'], false);
  if n <> 0 then
    raise exception 'FAIL: % kofi view(s) are not security_invoker', n;
  end if;
  select count(*) into n from pg_class c
  where c.relnamespace = 'kofi'::regnamespace and c.relkind = 'r' and not c.relrowsecurity;
  if n <> 0 then
    raise exception 'FAIL: % kofi table(s) without RLS', n;
  end if;
  raise notice 'ok: every kofi function pins search_path = kofi, public; every kofi view is security_invoker; every kofi table has RLS on';

  if exists (select 1 from pg_policy pol join pg_class c on c.oid = pol.polrelid
             where c.relnamespace = 'kofi'::regnamespace
               and (pg_get_expr(pol.polqual, pol.polrelid) ~ '(^|[^.a-z_])(is_admin|my_artist_id|my_curator_id|can_see|current_role_of)\('
                 or pg_get_expr(pol.polwithcheck, pol.polrelid) ~ '(^|[^.a-z_])(is_admin|my_artist_id|my_curator_id|can_see|current_role_of)\(')) then
    raise exception 'FAIL: a kofi RLS policy calls a helper without the kofi. qualifier';
  end if;
  if exists (select 1 from pg_policy pol join pg_class c on c.oid = pol.polrelid
             where c.relnamespace = 'kofi'::regnamespace
               and (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) like '%public.%') then
    raise exception 'FAIL: a kofi RLS policy references schema public';
  end if;
  raise notice 'ok: kofi RLS policies call kofi.* helpers explicitly, never public.*';

  select count(*) into n from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'kofi';
  -- 8 tables from 0006 + 6 programme tables from 0008.
  if n <> 16 or exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public') then
    raise exception 'FAIL: realtime should publish the 16 kofi tables (incl. 0009 lots, payouts) and nothing in public (kofi: %)', n;
  end if;
  raise notice 'ok: supabase_realtime publishes 16 kofi.* tables, none in public';

  if not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created' and tgfoid = 'public.handle_new_user()'::regprocedure)
     or not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'kofi_on_auth_user_created' and tgfoid = 'kofi.handle_new_user()'::regprocedure) then
    raise exception 'FAIL: expected both the other product''s on_auth_user_created and kofi_on_auth_user_created on auth.users';
  end if;
  raise notice 'ok: Kofi''s auth.users trigger is kofi_on_auth_user_created; the other product''s on_auth_user_created is intact';
end $$;

-- ------------------------------------------ a sign-up for the other product --
begin;
insert into auth.users (id, aud, role, email, raw_user_meta_data)
values ('eeeeeeee-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'new.signup@example.net', '{"full_name":"New Signup"}');
do $$
begin
  if not exists (select 1 from public.profiles where id = 'eeeeeeee-0000-4000-8000-000000000003' and full_name = 'New Signup')
     or exists (select 1 from kofi.profiles where id = 'eeeeeeee-0000-4000-8000-000000000003') then
    raise exception 'FAIL: a sign-up without kofi_role should get the other product''s public.profiles row and NO Kofi profile row';
  end if;
  raise notice 'ok: a sign-up without kofi_role gets the other product''s profile only; Kofi stays out of it';
end $$;
rollback;

begin;
insert into auth.users (id, aud, role, email, raw_user_meta_data)
values ('eeeeeeee-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'new.artist@example.net', '{"display_name":"New Artist","kofi_role":"artist"}');
do $$
begin
  if not exists (select 1 from kofi.profiles where id = 'eeeeeeee-0000-4000-8000-000000000004' and role = 'artist' and display_name = 'New Artist') then
    raise exception 'FAIL: a sign-up with kofi_role=artist should get a Kofi artist profile';
  end if;
  raise notice 'ok: a sign-up with kofi_role=artist gets a Kofi artist profile (opt-in)';
end $$;
rollback;

begin;
-- Kofi's trigger must never abort the other product's sign-ups.
alter table kofi.profiles add constraint kofi_test_reject_all check (false) not valid;
insert into auth.users (id, aud, role, email, raw_user_meta_data)
values ('eeeeeeee-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'unlucky@example.net', '{"full_name":"Unlucky"}');
do $$
begin
  if not exists (select 1 from public.profiles where id = 'eeeeeeee-0000-4000-8000-000000000004')
     or exists (select 1 from kofi.profiles where id = 'eeeeeeee-0000-4000-8000-000000000004') then
    raise exception 'FAIL: a failing Kofi profile insert should be skipped without blocking the sign-up';
  end if;
  raise notice 'ok: if the Kofi profile insert fails, the sign-up still succeeds (warning only)';
end $$;
rollback;

-- ------------------------------------------- internals are not API-callable --
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$
begin
  begin
    perform kofi.write_audit('artist.status', 'artist', 'x');
    raise exception 'FAIL: an API role executed kofi.write_audit()';
  exception when insufficient_privilege then
    raise notice 'ok: kofi.write_audit() is not executable by authenticated (%)', sqlerrm;
  end;
  if has_function_privilege('anon', 'kofi.handle_new_user()', 'execute')
     or has_function_privilege('authenticated', 'kofi.artists_guard()', 'execute')
     or has_table_privilege('anon', 'kofi.demo_artists', 'select')
     or has_table_privilege('authenticated', 'kofi.demo_artists', 'select') then
    raise exception 'FAIL: trigger functions or the demo snapshot are reachable by an API role';
  end if;
  raise notice 'ok: trigger functions and the kofi.demo_* snapshot are not reachable by anon/authenticated';
end $$;
rollback;

-- ------------------------------------- drop schema kofi cascade, rolled back --
begin;
savepoint before_drop;
do $$
declare
  public_before text := kofi_test.public_fingerprint();
  public_objects_before bigint;
  public_objects_after bigint;
begin
  select (select count(*) from pg_class where relnamespace = 'public'::regnamespace)
       + (select count(*) from pg_proc where pronamespace = 'public'::regnamespace)
       + (select count(*) from pg_type where typnamespace = 'public'::regnamespace)
    into public_objects_before;

  -- The cascade lists ~100 dependent objects as NOTICEs; keep the log readable.
  perform set_config('client_min_messages', 'warning', true);
  drop schema kofi cascade;
  perform set_config('client_min_messages', 'notice', true);

  select (select count(*) from pg_class where relnamespace = 'public'::regnamespace)
       + (select count(*) from pg_proc where pronamespace = 'public'::regnamespace)
       + (select count(*) from pg_type where typnamespace = 'public'::regnamespace)
    into public_objects_after;
  if public_objects_after <> public_objects_before then
    raise exception 'FAIL: drop schema kofi cascade changed the number of objects in public (% → %)', public_objects_before, public_objects_after;
  end if;
  if kofi_test.public_fingerprint() is distinct from public_before then
    raise exception 'FAIL: drop schema kofi cascade changed schema public or the other product''s data';
  end if;
  raise notice 'ok: drop schema kofi cascade leaves public untouched (% objects before = % after, fingerprint identical)', public_objects_before, public_objects_after;

  if exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'kofi_on_auth_user_created')
     or exists (select 1 from pg_policies where schemaname = 'storage' and policyname like 'kofi %')
     or exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'kofi') then
    raise exception 'FAIL: the cascade left Kofi''s auth trigger, storage policies or realtime tables behind';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created') then
    raise exception 'FAIL: the cascade removed the other product''s auth.users trigger';
  end if;
  raise notice 'ok: the cascade also removed Kofi''s auth.users trigger, its storage policies and its realtime tables; the other product''s trigger stays';

  insert into auth.users (id, aud, role, email) values ('eeeeeeee-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'after.removal@example.net');
  if not exists (select 1 from public.profiles where id = 'eeeeeeee-0000-4000-8000-000000000005') then
    raise exception 'FAIL: sign-ups for the other product broke after removing Kofi';
  end if;
  raise notice 'ok: other-product sign-ups still work after removing Kofi';
end $$;
rollback to savepoint before_drop;
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'kofi')
     or (select count(*) from kofi.artworks) = 0 then
    raise exception 'FAIL: rollback did not restore schema kofi';
  end if;
  raise notice 'ok: rolled back — schema kofi and its data are back';
end $$;
rollback;

\echo 'isolation_test.sql: all assertions passed'
