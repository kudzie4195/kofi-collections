-- =============================================================================
-- Kofi Collections — intake: sign-up, imports, link verification (0010_intake.sql)
--
-- Same conventions as sales_test.sql: each block impersonates a user the way
-- PostgREST does (set local role …; set local request.jwt.claims = …), runs in
-- its own transaction and rolls back. RAISE EXCEPTION on failure, NOTICE
-- 'ok: …' on success.
--
-- Demo UUIDs (src/data/supabase/demo.ts):
--   users   mara …01  june …03  priya …05  lena …06 (verified curator)  quincy …08 (admin)
--   artists mara 20…01 (token kofi-7f3a2k, Instagram verified)  june 20…03  priya 20…05 (pending)
-- =============================================================================

\set ON_ERROR_STOP on
\set QUIET on

create or replace function kofi_test.expect_error(p_sql text, p_state text, p_hint text default null, p_like text default null)
returns text language plpgsql as $$
declare
  v_state text;
  v_msg text;
  v_hint text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
    if v_state <> p_state then
      raise exception 'FAIL: % → expected SQLSTATE %, got % (%)', p_sql, p_state, v_state, v_msg;
    end if;
    if p_hint is not null and coalesce(v_hint, '') <> p_hint then
      raise exception 'FAIL: % → expected hint %, got % (%)', p_sql, p_hint, coalesce(v_hint, '<none>'), v_msg;
    end if;
    if p_like is not null and v_msg not like p_like then
      raise exception 'FAIL: % → expected message like "%", got "%"', p_sql, p_like, v_msg;
    end if;
    return v_msg;
  end;
  raise exception 'FAIL: % → expected an error (%), but it succeeded', p_sql, p_state;
end $$;
grant usage on schema kofi_test to anon, authenticated, service_role;
grant execute on function kofi_test.expect_error(text, text, text, text) to anon, authenticated, service_role;

-- true when a links array carries any checker bookkeeping
create or replace function kofi_test.has_verification(p jsonb) returns boolean
language sql immutable as $$
  select exists (select 1 from jsonb_array_elements(coalesce(p, '[]'::jsonb)) e where e ? 'verification' or e ? 'checkedAt')
$$;
grant execute on function kofi_test.has_verification(jsonb) to anon, authenticated, service_role;

-- ================================================================ seed =======
do $$
begin
  if (select count(*) from kofi.artists where verification_token is null) <> 0
     or (select count(distinct verification_token) from kofi.artists) <> (select count(*) from kofi.artists)
     or exists (select 1 from kofi.artists where not kofi.token_ok(verification_token)) then
    raise exception 'FAIL: every seeded artist should have a unique, well-formed token';
  end if;
  if (select verification_token from kofi.artists where id = '20000000-0000-4000-8000-000000000001') <> 'kofi-7f3a2k'
     or (select l ->> 'verification' from kofi.artists a, jsonb_array_elements(a.links) l
         where a.id = '20000000-0000-4000-8000-000000000001' and l ->> 'platform' = 'instagram') <> 'verified'
     or jsonb_array_length((select imports from kofi.artists where id = '20000000-0000-4000-8000-000000000001')) <> 2 then
    raise exception 'FAIL: Mara should have kofi-7f3a2k, a verified Instagram link and two import records';
  end if;
  if not (select convalidated from pg_constraint where conname = 'artists_links_shape' and conrelid = 'kofi.artists'::regclass) then
    raise exception 'FAIL: artists_links_shape should be validated once every row conforms';
  end if;
  raise notice 'ok: seed — unique well-formed tokens for every artist, typed links (Mara''s Instagram verified), import history; links CHECK validated';
end $$;

-- ========================================================= pure helpers ======
do $$
declare
  t text;
  seen text[] := '{}';
begin
  if not kofi.token_ok('kofi-7f3a2k') or kofi.token_ok('kofi-7f3a2') or kofi.token_ok('kofi-7f3a2l') or kofi.token_ok('KOFI-7F3A2K') or kofi.token_ok('kofi-0f3a2k') then
    raise exception 'FAIL: token_ok() should equal TOKEN_RE (no 0/o/1/l, lower case, six characters)';
  end if;
  for i in 1..200 loop
    t := kofi.make_verification_token();
    if not kofi.token_ok(t) or t = any (seen) then
      raise exception 'FAIL: make_verification_token() gave % (bad or repeated)', t;
    end if;
    seen := seen || t;
  end loop;
  if not kofi.links_shape_ok('[]') or not kofi.links_shape_ok('[{"label":"a","url":"https://a.example"}]')
     or not kofi.links_shape_ok('[{"label":"a","url":"http://a.example/x","platform":"website","handle":"a.example","verification":"failed","checkedAt":"2026-10-22T12:00:00.000Z"}]')
     or kofi.links_shape_ok('{}') or kofi.links_shape_ok('[{"url":"https://a.example"}]')
     or kofi.links_shape_ok('[{"label":"a","url":"javascript:alert(1)"}]')
     or kofi.links_shape_ok('[{"label":"a","url":"https://a.example","platform":"myspace"}]')
     or kofi.links_shape_ok('[{"label":"a","url":"https://a.example","verification":"trusted"}]')
     or kofi.links_shape_ok('[{"label":"a","url":"https://a.example","verification":null}]')
     or kofi.links_shape_ok('[{"label":"a","url":"https://a.example","extra":"x"}]')
     or kofi.links_shape_ok((select jsonb_agg(jsonb_build_object('label', 'l' || i, 'url', 'https://s' || i || '.example')) from generate_series(1, 7) i)) then
    raise exception 'FAIL: links_shape_ok() accepts / rejects the wrong arrays';
  end if;
  if kofi.links_public('[{"label":"a","url":"https://a.example","platform":"website","handle":"a.example","verification":"verified","checkedAt":"x"}]')
     <> '[{"label":"a","url":"https://a.example","platform":"website","handle":"a.example"}]'::jsonb
     or kofi.links_public('[{"label":"a","url":"https://a.example"}]') <> '[{"label":"a","url":"https://a.example"}]'::jsonb
     or kofi.links_public(null) <> '[]'::jsonb then
    raise exception 'FAIL: links_public() should keep label/url/platform/handle only';
  end if;
  raise notice 'ok: token_ok() = TOKEN_RE, make_verification_token() unique + well-formed (200 draws), links_shape_ok() (max 6, known keys, strings, http(s), platforms, verifications), links_public()';
end $$;

begin;
do $$
begin
  perform kofi_test.expect_error($q$update kofi.artists set verification_token = 'kofi-7f3a2k' where id = '20000000-0000-4000-8000-000000000003'$q$, '23505');
  perform kofi_test.expect_error($q$update kofi.artists set verification_token = 'kofi-ABCDEF' where id = '20000000-0000-4000-8000-000000000003'$q$, '23514', null, '%artists_verification_token_format%');
  perform kofi_test.expect_error($q$update kofi.artists set links = '[{"label":"a","url":"https://a.example","verification":"maybe"}]' where id = '20000000-0000-4000-8000-000000000003'$q$, '23514', null, '%artists_links_shape%');
  perform kofi_test.expect_error($q$update kofi.artists set imports = (select jsonb_agg(i) from generate_series(1, 21) i) where id = '20000000-0000-4000-8000-000000000003'$q$, '23514', null, '%artists_imports_shape%');
  raise notice 'ok: CHECKs / UNIQUE back the rules even for trusted writers (token unique + format, links shape, at most 20 imports)';
end $$;
rollback;

-- ==================================================== read projection ========
begin;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare
  r record;
begin
  select * into r from kofi.artists_visible where id = '20000000-0000-4000-8000-000000000001';
  if r.verification_token is not null or r.imports is not null or kofi_test.has_verification(r.links)
     or jsonb_array_length(r.links) <> 2 or r.links -> 1 ->> 'handle' <> '@mara.paints' or r.links -> 1 ->> 'platform' <> 'instagram' then
    raise exception 'FAIL: anon should see Mara''s links as label/url/platform/handle and no token / imports / verification: %', row_to_json(r);
  end if;
  if exists (select 1 from kofi.artists_visible where verification_token is not null or imports is not null or kofi_test.has_verification(links)) then
    raise exception 'FAIL: anon sees a token, imports or a verification somewhere';
  end if;
  if exists (select 1 from kofi.artists_visible where id = '20000000-0000-4000-8000-000000000005') then
    raise exception 'FAIL: anon should not see the pending artist';
  end if;
  if kofi_test.has_verification((select links from kofi.artist_intake('20000000-0000-4000-8000-000000000001')))
     or (select verification_token from kofi.artist_intake('20000000-0000-4000-8000-000000000001')) is not null then
    raise exception 'FAIL: artist_intake() through /rpc must give anon the same redacted answer';
  end if;
  perform kofi_test.expect_error($q$select links from kofi.artists$q$, '42501');
  perform kofi_test.expect_error($q$select verification_token from kofi.artists$q$, '42501');
  perform kofi_test.expect_error($q$select imports from kofi.artists$q$, '42501');
  raise notice 'ok: anon — links without verification / checkedAt, no token, no imports (view and /rpc); artists.links / verification_token / imports not selectable';
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated"}';
do $$
begin
  if exists (select 1 from kofi.artists_visible where verification_token is not null or imports is not null or kofi_test.has_verification(links)) then
    raise exception 'FAIL: a verified curator (Lena) sees a token, imports or a verification';
  end if;
  if (select count(*) from kofi.artists_visible) = 0 then
    raise exception 'FAIL: Lena should still see the approved artists';
  end if;
  perform kofi_test.expect_error($q$select links from kofi.artists$q$, '42501');
  raise notice 'ok: verified curator — same redaction as anon';
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}';
do $$
begin
  if exists (select 1 from kofi.artists_visible where id <> '20000000-0000-4000-8000-000000000003'
             and (verification_token is not null or imports is not null or kofi_test.has_verification(links))) then
    raise exception 'FAIL: June sees another artist''s token, imports or verification';
  end if;
  if (select verification_token from kofi.artists_visible where id = '20000000-0000-4000-8000-000000000003') <> 'kofi-jw4b8t' then
    raise exception 'FAIL: June should see her own token';
  end if;
  raise notice 'ok: another artist — redacted; her own profile — token';
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare
  r record;
begin
  select * into r from kofi.artists_visible where id = '20000000-0000-4000-8000-000000000001';
  if r.verification_token <> 'kofi-7f3a2k' or jsonb_array_length(r.imports) <> 2
     or (select l ->> 'verification' from jsonb_array_elements(r.links) l where l ->> 'platform' = 'instagram') <> 'verified'
     or (select l ->> 'checkedAt' from jsonb_array_elements(r.links) l where l ->> 'platform' = 'instagram') is null then
    raise exception 'FAIL: Mara should see her token, imports and verification: %', row_to_json(r);
  end if;
  raise notice 'ok: owner — token, imports, verification and checkedAt';
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$
begin
  if (select verification_token from kofi.artists_visible where id = '20000000-0000-4000-8000-000000000005') <> 'kofi-pv3h8x'
     or (select count(*) from kofi.artists_visible where verification_token is null) <> 0
     or not kofi_test.has_verification((select links from kofi.artists_visible where id = '20000000-0000-4000-8000-000000000005')) then
    raise exception 'FAIL: Kofi should see every token, incl. the pending artist''s, with verification';
  end if;
  raise notice 'ok: Kofi — every artist''s token, imports and verification (incl. pending)';
end $$;
rollback;

-- ========================================== owner writes cannot forge =======
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare
  v jsonb;
begin
  update kofi.artists set links = '[
      {"label":"Website","url":"https://www.mara-oyelaran.com","platform":"website","handle":"mara-oyelaran.com","verification":"verified","checkedAt":"2026-10-22T00:00:00.000Z"},
      {"label":"Instagram","url":"https://www.Instagram.com/mara.paints","platform":"instagram","handle":"@mara.paints","verification":"failed"},
      {"label":"TikTok","url":"https://www.tiktok.com/@mara.paints","platform":"tiktok","handle":"@mara.paints","verification":"verified"}
    ]'::jsonb
  where id = '20000000-0000-4000-8000-000000000001';
  select links into v from kofi.artists_visible where id = '20000000-0000-4000-8000-000000000001';
  if v -> 0 ->> 'verification' <> 'claimed' or v -> 0 ? 'checkedAt'
     or v -> 1 ->> 'verification' <> 'verified' or not (v -> 1 ? 'checkedAt')
     or v -> 2 ->> 'verification' <> 'claimed' then
    raise exception 'FAIL: a direct owner write must keep the checker''s result per URL (case-insensitive) and start new links at claimed: %', v;
  end if;
  perform kofi_test.expect_error($q$update kofi.artists set verification_token = 'kofi-aaaaaa' where id = '20000000-0000-4000-8000-000000000001'$q$, '42501');
  perform kofi_test.expect_error($q$update kofi.artists set imports = '[]' where id = '20000000-0000-4000-8000-000000000001'$q$, '42501');
  perform kofi_test.expect_error($q$select kofi.set_link_verification('https://www.tiktok.com/@mara.paints', 'verified')$q$, '42501', null, 'Links are verified by Kofi''s checker.%');
  v := kofi.set_link_verification('https://www.instagram.com/mara.paints', 'claimed');
  if v -> 1 ->> 'verification' <> 'claimed' or v -> 1 ? 'checkedAt' then
    raise exception 'FAIL: the owner may reset a link to claimed: %', v;
  end if;
  perform kofi_test.expect_error($q$select kofi.set_link_verification('https://www.instagram.com/mara.paints', 'claimed', now(), '20000000-0000-4000-8000-000000000003')$q$, '42501');
  raise notice 'ok: owner — client-sent verification ignored (unchanged URL keeps its result, new URL starts claimed), token / imports not writable, set_link_verification only back to claimed and only on her own links';
end $$;
reset role;
do $$
begin
  if (select count(*) from kofi.audit_events where action = 'artist.links' and entity_id = '20000000-0000-4000-8000-000000000001' and meta ->> 'by' = 'owner') <> 1
     or (select count(*) from kofi.audit_events where action = 'artist.update' and entity_id = '20000000-0000-4000-8000-000000000001' and at >= now()) <> 1 then
    raise exception 'FAIL: the link edit should be one artist.update, the reset one artist.links (by owner)';
  end if;
  raise notice 'ok: audit — the owner''s link edit is one artist.update, her reset one artist.links';
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000010","role":"authenticated"}';
reset role;
insert into auth.users (id, aud, role, email, raw_user_meta_data)
values ('eeeeeeee-0000-4000-8000-000000000010', 'authenticated', 'authenticated', 'direct@example.net', '{"kofi_role":"artist","display_name":"Direct Insert"}');
set local role authenticated;
do $$
declare
  r record;
begin
  insert into kofi.artists (user_id, working_name, region_country, contact_email, verification_token, imports, links)
  values ('eeeeeeee-0000-4000-8000-000000000010', 'Direct Insert', 'Canada', 'direct@example.net', 'kofi-aaaaaa',
          '[{"x":1}]', '[{"label":"IG","url":"https://www.instagram.com/direct","verification":"verified","checkedAt":"2026-01-01"}]');
  select * into r from kofi.artists_visible where id = kofi.my_artist_id();
  if r.verification_token = 'kofi-aaaaaa' or not kofi.token_ok(r.verification_token) or r.imports <> '[]'::jsonb
     or r.links -> 0 ->> 'verification' <> 'claimed' or r.links -> 0 ? 'checkedAt' then
    raise exception 'FAIL: a direct insert must get a server token, no imports and claimed links: %', row_to_json(r);
  end if;
  raise notice 'ok: direct insert (artists_insert_self) — chosen token / imports / verification replaced by the server';
end $$;
rollback;

-- ============================================= set_link_verification ========
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$
declare
  v jsonb;
begin
  v := kofi.set_link_verification('https://www.instagram.com/june.weaves', 'verified', '2026-10-22T12:00:00Z', '20000000-0000-4000-8000-000000000003');
  if v -> 0 ->> 'verification' <> 'verified' or v -> 0 ->> 'checkedAt' <> '2026-10-22T12:00:00.000Z' then
    raise exception 'FAIL: Kofi can set a verification by hand: %', v;
  end if;
  if not exists (select 1 from kofi.audit_events where action = 'artist.links' and entity_id = '20000000-0000-4000-8000-000000000003'
                 and actor_id = '10000000-0000-4000-8000-000000000008' and meta ->> 'by' = 'staff' and meta ->> 'verification' = 'verified') then
    raise exception 'FAIL: a staff verification should be audited as artist.links by Quincy';
  end if;
  if exists (select 1 from kofi.audit_events where action = 'artist.update' and entity_id = '20000000-0000-4000-8000-000000000003' and at >= now()) then
    raise exception 'FAIL: a verification-only change must not also log artist.update';
  end if;
  perform kofi_test.expect_error($q$select kofi.set_link_verification('https://nope.example', 'verified', now(), '20000000-0000-4000-8000-000000000003')$q$, 'P0002', null, 'That link is not on this profile.');
  perform kofi_test.expect_error($q$select kofi.set_link_verification('https://www.instagram.com/june.weaves', 'trusted', now(), '20000000-0000-4000-8000-000000000003')$q$, '22023', 'verification');
  perform kofi_test.expect_error($q$select kofi.set_link_verification('https://www.instagram.com/june.weaves', 'verified')$q$, 'P0002');
  raise notice 'ok: Kofi — any verification by hand (audited artist.links, no artist.update), unknown link P0002, unknown value 22023';
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated"}';
do $$
begin
  perform kofi_test.expect_error($q$select kofi.set_link_verification('https://www.instagram.com/june.weaves', 'verified', now(), '20000000-0000-4000-8000-000000000003')$q$, '42501');
  perform kofi_test.expect_error($q$select kofi.record_import('{}')$q$, '42501');
  perform kofi_test.expect_error($q$select kofi.ensure_my_artist()$q$, '42501', null, 'Sign in as an artist to do this.');
  perform kofi_test.expect_error($q$select kofi.log_audit('artist.import', 'artist', '20000000-0000-4000-8000-000000000003', '{}')$q$, '42501');
  raise notice 'ok: a curator cannot verify links, record imports, make an artist profile or log intake events';
end $$;
rollback;

begin;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
begin
  perform kofi_test.expect_error($q$select kofi.set_link_verification('https://www.instagram.com/june.weaves', 'verified', now(), '20000000-0000-4000-8000-000000000003')$q$, '42501');
  perform kofi_test.expect_error($q$select kofi.ensure_my_artist()$q$, '42501');
  perform kofi_test.expect_error($q$select kofi.record_import('{}')$q$, '42501');
  raise notice 'ok: anon cannot call the intake RPCs';
end $$;
rollback;

begin;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
do $$
declare
  v jsonb;
  n integer := (select count(*) from kofi.audit_events);
begin
  v := kofi.set_link_verification('https://www.instagram.com/deshawn.nightshift', 'failed', '2026-10-22T12:00:00Z', '20000000-0000-4000-8000-000000000004');
  if v -> 0 ->> 'verification' <> 'failed' or v -> 0 ->> 'checkedAt' <> '2026-10-22T12:00:00.000Z' then
    raise exception 'FAIL: the checker (service role) writes any result: %', v;
  end if;
  if (select count(*) from kofi.audit_events) <> n then
    raise exception 'FAIL: the checker''s write is logged by the function as the caller, not here';
  end if;
  raise notice 'ok: service role (the profile-import function) writes check results; not audited here';
end $$;
rollback;

-- ======================================================= record_import ======
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}';
do $$
declare
  v jsonb;
begin
  perform kofi.record_import('{"source":{"label":"Instagram @june.weaves","url":"https://www.instagram.com/june.weaves","platform":"instagram","handle":"@june.weaves","verification":"verified"},"fetchedAt":"2026-10-22T12:00:00.000Z","appliedFields":["workingName","bio","bio"],"notes":["We used your handle."],"extra":1}');
  select imports into v from kofi.artists_visible where id = '20000000-0000-4000-8000-000000000003';
  if jsonb_array_length(v) <> 1 or v -> 0 <> '{"source":{"label":"Instagram @june.weaves","url":"https://www.instagram.com/june.weaves","platform":"instagram","handle":"@june.weaves"},"fetchedAt":"2026-10-22T12:00:00.000Z","appliedFields":["bio","workingName"],"notes":["We used your handle."]}'::jsonb then
    raise exception 'FAIL: record_import should store a cleaned ProfileImportRecord: %', v;
  end if;
  perform kofi_test.expect_error($q$select kofi.record_import('{"source":{"url":"https://a.example"},"fetchedAt":"x","appliedFields":["password"],"notes":[]}')$q$, '22023', 'imports', 'Unknown imported field.');
  perform kofi_test.expect_error($q$select kofi.record_import('{"source":{"url":"javascript:x"},"fetchedAt":"x","appliedFields":[],"notes":[]}')$q$, '22023', 'url');
  perform kofi_test.expect_error($q$select kofi.record_import('[]')$q$, '22023', 'imports');
  for i in 1..25 loop
    perform kofi.record_import(jsonb_build_object('source', jsonb_build_object('label', 'x', 'url', 'https://s' || i || '.example'), 'fetchedAt', '2026-10-22T12:00:00.000Z', 'appliedFields', '[]'::jsonb, 'notes', '[]'::jsonb));
  end loop;
  select imports into v from kofi.artists_visible where id = '20000000-0000-4000-8000-000000000003';
  if jsonb_array_length(v) <> 20 or v -> 19 -> 'source' ->> 'url' <> 'https://s25.example' or v -> 0 -> 'source' ->> 'url' <> 'https://s6.example' then
    raise exception 'FAIL: imports keep the newest 20, oldest first';
  end if;
  raise notice 'ok: record_import — owner only, cleaned shape (known fields, deduped), bad input 22023 with field, newest 20 kept';
end $$;
reset role;
do $$
begin
  if (select count(*) from kofi.audit_events where action = 'artist.import' and entity_id = '20000000-0000-4000-8000-000000000003' and meta ->> 'stage' = 'applied') <> 26
     or exists (select 1 from kofi.audit_events where action = 'artist.update' and entity_id = '20000000-0000-4000-8000-000000000003' and at >= now()) then
    raise exception 'FAIL: record_import is audited as artist.import (one per call) and never as artist.update';
  end if;
  raise notice 'ok: audit — record_import logs artist.import {stage: applied}, no artist.update';
end $$;
rollback;

-- ============================================================ log_audit =====
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
begin
  perform kofi.log_audit('artist.import', 'artwork', '20000000-0000-4000-8000-000000000003', '{"stage":"read","url":"https://www.instagram.com/mara.paints"}');
  perform kofi_test.expect_error($q$select kofi.log_audit('artist.status', 'artist', '20000000-0000-4000-8000-000000000001')$q$, '42501');
  perform kofi_test.expect_error($q$select kofi.log_audit('artist.links', 'artist', null, jsonb_build_object('x', repeat('y', 5000)))$q$, '22023', 'meta');
end $$;
reset role;
do $$
begin
  if not exists (select 1 from kofi.audit_events where action = 'artist.import' and entity_type = 'artist' and entity_id = '20000000-0000-4000-8000-000000000001'
                 and actor_id = '10000000-0000-4000-8000-000000000001' and at >= now()) then
    raise exception 'FAIL: an artist logs intake events against her own profile, whatever id she passes';
  end if;
  raise notice 'ok: log_audit — artist.import / artist.links against the caller''s own profile; server-only actions refused; meta capped';
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$
begin
  perform kofi.log_audit('artist.links', 'artist', '20000000-0000-4000-8000-000000000003', '{"url":"https://www.instagram.com/june.weaves","verification":"verified"}');
  perform kofi_test.expect_error($q$select kofi.log_audit('artist.links', 'artist', 'not-an-id', '{}')$q$, 'P0002');
  raise notice 'ok: Kofi logs intake events for a named artist only';
end $$;
rollback;

-- ============================================================ sign-up =======
-- What GoTrue does on auth.signUp({ options: { data } }): one auth.users row.
-- kofi.handle_new_user (unchanged) makes the profile; the artist row is made
-- by ensure_my_artist() on the first authenticated call.
begin;
insert into auth.users (id, aud, role, email, raw_user_meta_data)
values ('eeeeeeee-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'Flow.Tester@Example.com',
        '{"kofi_role":"artist","display_name":"Flow Tester","kofi_consent_version":"2026-10-v1"}');
do $$
begin
  if not exists (select 1 from kofi.profiles where id = 'eeeeeeee-0000-4000-8000-000000000011' and role = 'artist' and display_name = 'Flow Tester')
     or exists (select 1 from kofi.artists where user_id = 'eeeeeeee-0000-4000-8000-000000000011') then
    raise exception 'FAIL: sign-up should give a Kofi artist profile and no artists row yet';
  end if;
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000011","role":"authenticated"}';
do $$
declare
  v_id uuid;
  r record;
begin
  if (select artist_id from kofi.whoami()) is not null then
    raise exception 'FAIL: whoami should have no artist id before ensure_my_artist';
  end if;
  v_id := kofi.ensure_my_artist();
  if kofi.ensure_my_artist() <> v_id or (select artist_id from kofi.whoami()) <> v_id then
    raise exception 'FAIL: ensure_my_artist should be idempotent and whoami should now know the artist';
  end if;
  select * into r from kofi.artists_visible where id = v_id;
  if r.working_name <> 'Flow Tester' or r.status <> 'draft' or r.visibility <> 'private' or r.contact_email <> 'flow.tester@example.com'
     or not kofi.token_ok(r.verification_token) or r.imports <> '[]'::jsonb or r.links <> '[]'::jsonb
     or r.consent_version <> '2026-10-v1' or r.consent_accepted_at is null or r.region_country <> '' or not r.can_edit then
    raise exception 'FAIL: the new draft is not as designed: %', row_to_json(r);
  end if;
  raise notice 'ok: sign-up — profile from the trigger, then ensure_my_artist(): private draft, sign-up name, lower-cased email, server token, consent version; idempotent';
end $$;
reset role;
do $$
declare
  v_id uuid := (select id from kofi.artists where user_id = 'eeeeeeee-0000-4000-8000-000000000011');
begin
  if (select count(*) from kofi.consents where user_id = 'eeeeeeee-0000-4000-8000-000000000011' and artist_id = v_id and version = '2026-10-v1') <> 1
     or (select count(*) from kofi.audit_events where entity_id = v_id::text and action = 'artist.create') <> 1
     or (select count(*) from kofi.audit_events where entity_id = v_id::text and action = 'artist.signup' and consent_version = '2026-10-v1'
         and actor_id = 'eeeeeeee-0000-4000-8000-000000000011' and actor_role = 'artist') <> 1 then
    raise exception 'FAIL: sign-up should record one consent, one artist.create and one artist.signup';
  end if;
  raise notice 'ok: sign-up audit — one consents row, artist.create + artist.signup by the new artist';
end $$;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
begin
  if exists (select 1 from kofi.artists_visible where working_name = 'Flow Tester') then
    raise exception 'FAIL: a new draft is invisible to visitors';
  end if;
  raise notice 'ok: the new draft is invisible to visitors';
end $$;
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$
begin
  if not exists (select 1 from kofi.artists_visible where working_name = 'Flow Tester' and verification_token is not null and status = 'draft') then
    raise exception 'FAIL: Kofi should see the new draft with its token';
  end if;
  raise notice 'ok: Kofi sees the new draft with its token';
end $$;
rollback;

begin;
insert into auth.users (id, aud, role, email, raw_user_meta_data)
values ('eeeeeeee-0000-4000-8000-000000000012', 'authenticated', 'authenticated', 'no.consent@example.com', '{"kofi_role":"artist"}'),
       ('eeeeeeee-0000-4000-8000-000000000013', 'authenticated', 'authenticated', 'curious@example.com', '{"kofi_role":"curator","display_name":"Curious"}');
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000012","role":"authenticated"}';
do $$
declare
  v_id uuid := kofi.ensure_my_artist();
begin
  if (select working_name from kofi.artists_visible where id = v_id) <> 'no.consent'
     or (select consent_version from kofi.artists_visible where id = v_id) is not null
     or exists (select 1 from kofi.consents where artist_id = v_id) then
    raise exception 'FAIL: without a name / consent in the metadata: name from the email, no consent';
  end if;
  raise notice 'ok: sign-up without a name or consent — name from the email, consent left for acceptConsent';
end $$;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000013","role":"authenticated"}';
do $$
begin
  perform kofi_test.expect_error($q$select kofi.ensure_my_artist()$q$, '42501', null, 'Sign in as an artist to do this.');
  raise notice 'ok: a curator sign-up cannot make an artist profile';
end $$;
reset role;
-- an artist profile from before 0010 (no token) gets one on the next ensure_my_artist()
update kofi.artists set verification_token = null where id = '20000000-0000-4000-8000-000000000004';
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}';
do $$
begin
  if kofi.ensure_my_artist() <> '20000000-0000-4000-8000-000000000004'
     or not kofi.token_ok((select verification_token from kofi.artists_visible where id = '20000000-0000-4000-8000-000000000004')) then
    raise exception 'FAIL: ensure_my_artist should give an existing artist without a token a fresh one';
  end if;
  raise notice 'ok: an existing artist without a token gets one from ensure_my_artist()';
end $$;
rollback;

-- ============================================================== reset =======
begin;
update kofi.artists set verification_token = 'kofi-zzzzzz', imports = '[]', links = '[]' where id = '20000000-0000-4000-8000-000000000001';
select kofi.kofi_demo_reset();
do $$
begin
  if (select verification_token from kofi.artists where id = '20000000-0000-4000-8000-000000000001') <> 'kofi-7f3a2k'
     or jsonb_array_length((select imports from kofi.artists where id = '20000000-0000-4000-8000-000000000001')) <> 2
     or jsonb_array_length((select links from kofi.artists where id = '20000000-0000-4000-8000-000000000001')) <> 2 then
    raise exception 'FAIL: kofi_demo_reset() should restore tokens, imports and typed links';
  end if;
  raise notice 'ok: kofi_demo_reset() restores tokens, imports and typed links';
end $$;
rollback;

-- ============================================== migration properties ========
do $$
declare
  cols text;
begin
  if not exists (select 1 from kofi.applied_migrations where name = '0010_intake') or not exists (select 1 from kofi.applied_migrations where name = '0009_sales') then
    raise exception 'FAIL: 0009_sales and 0010_intake should both be recorded';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'audit_events_action_known'))
       !~ 'lot\.sale.*payout\.status.*report\.export.*artist\.signup.*artist\.import.*artist\.links' then
    raise exception 'FAIL: the audit vocabulary should be 0009''s list plus the three intake actions';
  end if;
  if (select string_agg(prosrc, ' ') from pg_proc where proname = 'set_application_status' and pronamespace = 'kofi'::regnamespace) !~ 'require_call_manager'
     or not exists (select 1 from information_schema.columns where table_schema = 'kofi' and table_name = 'open_calls_visible' and column_name = 'terms')
     or to_regclass('kofi.lots_visible') is null
     or not exists (select 1 from pg_policies where schemaname = 'kofi' and tablename = 'open_calls' and policyname = 'open_calls_insert') then
    raise exception 'FAIL: 0010 must leave 0009''s partner rules, views and policies in place';
  end if;
  select string_agg(column_name, ',' order by ordinal_position) into cols from information_schema.columns where table_schema = 'kofi' and table_name = 'artists_visible';
  if cols <> 'id,working_name,pronouns,bio,statement,mediums,career_stage,experience_commissions,experience_public_art,experience_residencies,experience_institutional_shows,experience_years_practicing,availability_commissions,availability_sales,availability_exhibitions,links,status,visibility,avatar_color,created_at,updated_at,region_label,region_city,region_region,region_country,region_precision,legal_name,contact_email,contact_phone,contact_studio_address,kofi_notes,consent_version,consent_accepted_at,can_edit,verification_token,imports' then
    raise exception 'FAIL: artists_visible should keep 0003''s columns in order and append verification_token, imports: %', cols;
  end if;
  if has_function_privilege('anon', 'kofi.ensure_my_artist()', 'execute') or has_function_privilege('anon', 'kofi.record_import(jsonb)', 'execute')
     or has_function_privilege('anon', 'kofi.set_link_verification(text, text, timestamptz, uuid)', 'execute')
     or has_function_privilege('anon', 'kofi.log_audit(text, text, text, jsonb)', 'execute')
     or has_function_privilege('anon', 'kofi.make_verification_token()', 'execute')
     or has_function_privilege('authenticated', 'kofi.artists_links_guard()', 'execute')
     or not has_function_privilege('authenticated', 'kofi.ensure_my_artist()', 'execute')
     or not has_function_privilege('service_role', 'kofi.set_link_verification(text, text, timestamptz, uuid)', 'execute')
     or has_column_privilege('anon', 'kofi.artists', 'links', 'select') or has_column_privilege('authenticated', 'kofi.artists', 'links', 'select')
     or has_column_privilege('authenticated', 'kofi.artists', 'verification_token', 'select')
     or not has_column_privilege('anon', 'kofi.artists', 'working_name', 'select') then
    raise exception 'FAIL: an intake privilege is wider (or narrower) than designed';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'kofi'::regnamespace
             and p.proname in ('token_ok', 'links_shape_ok', 'links_public', 'links_core', 'make_verification_token', 'artists_links_guard', 'artist_intake', 'ensure_my_artist', 'record_import', 'set_link_verification')
             and not (coalesce(p.proconfig, '{}') @> array['search_path=kofi, public'])) then
    raise exception 'FAIL: every 0010 function pins search_path = kofi, public';
  end if;
  if (select count(*) from pg_proc where proname in ('ensure_my_artist', 'record_import', 'set_link_verification', 'artist_intake', 'make_verification_token') and pronamespace <> 'kofi'::regnamespace) > 0 then
    raise exception 'FAIL: 0010 created a function outside schema kofi';
  end if;
  if exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'auth.users'::regclass and p.proname = 'handle_new_user'
             and p.pronamespace = 'kofi'::regnamespace and p.prosrc ~ 'kofi\.artists') then
    raise exception 'FAIL: kofi.handle_new_user should be unchanged (profiles only)';
  end if;
  raise notice 'ok: 0009 state preserved (audit list superset, partner rules, views, policies); 0010 recorded; artists_visible columns appended; least-privilege grants; search_path pinned; handle_new_user unchanged';
end $$;

\echo 'intake_test.sql: all assertions passed'
