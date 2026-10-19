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
