-- =============================================================================
-- Kofi Collections — plain-Postgres shim for the Supabase platform objects.
--
-- Load this ONLY into a throwaway local Postgres (never into a Supabase
-- project — Supabase already provides all of this). It recreates the minimum
-- the migrations depend on so they can be executed and the RLS tests run:
--
--   * roles anon / authenticated / service_role (+ Supabase's default grants)
--   * auth schema: auth.users, auth.identities, auth.uid(), auth.role()
--   * extensions schema with pgcrypto (Supabase installs it there)
--   * storage schema: storage.buckets, storage.objects (RLS on), storage.foldername()
--   * the supabase_realtime publication
--
-- auth.uid() is defined exactly as Supabase defines it: it reads the `sub`
-- claim from `request.jwt.claim.sub` or the `request.jwt.claims` JSON that
-- PostgREST sets per request. Tests impersonate a user with
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase grants everything in `public` to the API roles by default and relies
-- on RLS + explicit revokes. Mirror that so the migrations' revokes are tested.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- ---------------------------------------------------------------- auth -------
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key,
  aud text,
  role text,
  email text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_sign_in_at timestamptz,
  confirmation_token text,
  email_change text,
  email_change_token_new text,
  recovery_token text
);

create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  identity_data jsonb not null,
  provider text not null,
  last_sign_in_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (provider_id, provider)
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;

-- -------------------------------------------------------------- storage ------
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  owner uuid,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
grant all on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

-- Same contract as Supabase's storage.foldername(): all path segments but the last.
create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- -------------------------------------------------------------- realtime -----
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- ------------------------------------------------- the OTHER product -------
-- Kofi shares its Supabase project with another product that already owns
-- `public`. Recreate the parts of it that are most likely to collide, BEFORE
-- the Kofi migrations run, so the test run proves the migrations neither
-- touch nor clash with them:
--   * public.profiles / public.consent_records / public.admin_users
--   * public.is_admin() (same name as a Kofi helper)
--   * the standard Supabase-template trigger `on_auth_user_created` on
--     auth.users (same name the Kofi migration used before it moved to `kofi`)
--   * two pre-existing "real" users with public.profiles rows
-- isolation_test.sql checks all of this is byte-for-byte unchanged afterwards.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  plan text not null default 'free',
  updated_at timestamptz default now()
);
alter table public.profiles enable row level security;
create policy "other product: own profile" on public.profiles for select to authenticated using (id = auth.uid());

create table if not exists public.consent_records (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete cascade,
  kind text not null,
  granted_at timestamptz not null default now()
);
create table if not exists public.admin_users (user_id uuid primary key references auth.users (id) on delete cascade);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid())
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name) values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

insert into auth.users (id, aud, role, email, raw_user_meta_data) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'real.user.one@example.net', '{"full_name":"Real User One"}'),
  ('eeeeeeee-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'real.user.two@example.net', '{"full_name":"Real User Two"}')
on conflict (id) do nothing;
update public.profiles set plan = 'pro' where id = 'eeeeeeee-0000-4000-8000-000000000002';
insert into public.admin_users (user_id) values ('eeeeeeee-0000-4000-8000-000000000001') on conflict do nothing;
insert into public.consent_records (user_id, kind) values ('eeeeeeee-0000-4000-8000-000000000001', 'terms');

-- Fingerprint of everything in `public` (objects + data of the other
-- product's tables), taken now, before any Kofi migration. Stored outside
-- `public` so it does not change the fingerprint itself.
create schema if not exists kofi_test;
create or replace function kofi_test.public_fingerprint() returns text
language sql stable as $$
  select md5(string_agg(x, E'\n' order by x)) from (
    select 'rel ' || c.relname || ' ' || c.relkind::text || ' ' || coalesce(array_to_string(c.relacl, ','), '') from pg_class c where c.relnamespace = 'public'::regnamespace
    union all
    select 'col ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || coalesce(array_to_string(a.attacl, ','), '')
      from pg_attribute a join pg_class c on c.oid = a.attrelid
      where c.relnamespace = 'public'::regnamespace and a.attnum > 0 and not a.attisdropped
    union all
    select 'fn ' || p.oid::regprocedure::text || ' ' || md5(p.prosrc) || ' ' || coalesce(array_to_string(p.proacl, ','), '') from pg_proc p where p.pronamespace = 'public'::regnamespace
    union all
    select 'type ' || t.typname from pg_type t where t.typnamespace = 'public'::regnamespace
    union all
    select 'policy ' || pol.polname || ' on ' || c.relname from pg_policy pol join pg_class c on c.oid = pol.polrelid where c.relnamespace = 'public'::regnamespace
    union all
    select 'trigger ' || t.tgname || ' on ' || c.relname from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
    union all
    select 'auth-trigger ' || t.tgname || ' -> ' || t.tgfoid::regproc::text from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal and t.tgfoid::regproc::text not like 'kofi.%'
    union all
    select 'row profiles ' || p::text from public.profiles p where p.id::text like 'eeeeeeee-%'
    union all
    select 'row admin_users ' || a::text from public.admin_users a
    union all
    select 'row consent_records ' || r.user_id || ' ' || r.kind from public.consent_records r
  ) s (x)
$$;
create table kofi_test.baseline as select kofi_test.public_fingerprint() as fp, now() as taken_at;
