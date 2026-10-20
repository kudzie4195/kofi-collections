-- =============================================================================
-- Kofi Collections — programme assertions (0008_programme.sql)
--
-- Same conventions as rls_test.sql / rpc_test.sql: each block impersonates a
-- demo user the way PostgREST does (set local role …; set local
-- request.jwt.claims = …), runs in its own transaction and rolls back.
-- RAISE EXCEPTION on failure, NOTICE 'ok: …' on success.
--
-- The tests never depend on today's date: blocks that need an open call move
-- the seeded call's dates around "today" (Kofi time) before impersonating.
--
-- Demo UUIDs (supabase/seed_content.sql header; src/data/supabase/demo.ts):
--   users   mara …01  june …03  deshawn …04  priya …05  lena …06 (verified curator)  owen …07  quincy …08 (admin)
--   artists mara 20…01  june 20…03  deshawn 20…04  priya 20…05 (pending)
--   works   aw_mara_1 30…11 (public)  aw_mara_2 30…12 (public)  aw_mara_3 30…13 (kofi-only)
--           aw_june_1 30…31  aw_june_3 30…33 (private)  aw_deshawn_1 30…41  aw_priya_1 30…51 (pending artist)
--   exhibitions a1…01 Being/Seen · a1…04 Night Weather (mara1, mara2, june1, deshawn1, priya1) · a1…05 Soft Ground
--   calls   a2…01 Art of Advocacy (external form) · a2…02 Night Weather award (in-app) · a2…03 Soft Ground (upcoming) · a2…04 Summer Open (closed)
--   apps    a3…01 Mara/Summer accepted · a3…02 June/Summer declined (staff note) · a3…03 DeShawn/Night Weather submitted
--   stories a5…01 Mara interview (mara1, mara2)
-- =============================================================================

\set ON_ERROR_STOP on
\set QUIET on

-- --------------------------------------------------------- test helpers -----
-- kofi_test is the harness's own schema (shim.sql), never part of Kofi.
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
grant usage on schema kofi_test to anon, authenticated;
grant execute on function kofi_test.expect_error(text, text, text, text) to anon, authenticated;

-- Today in Kofi's time zone, as the RPCs see it.
create or replace function kofi_test.kofi_today() returns date
language sql stable as $$ select (now() at time zone 'America/New_York')::date $$;
grant execute on function kofi_test.kofi_today() to anon, authenticated;

-- =========================================================== programme ======

-- ------------------------------------------------ visitor: published only ---
begin;
insert into kofi.exhibitions (id, title, starts_on, summary, published)
values ('a1ffffff-0000-4000-8000-000000000001', 'Draft show', '2027-05-01', 'Not announced yet.', false);
update kofi.exhibitions set published = false where id = 'a1000000-0000-4000-8000-000000000005';  -- Soft Ground → draft
update kofi.artists set status = 'paused' where id = '20000000-0000-4000-8000-000000000003';      -- June paused
insert into kofi.open_calls (id, title, summary, eligibility, opens_on, fee, published)
values ('a2ffffff-0000-4000-8000-000000000001', 'Draft call', 'Not announced yet.', 'Anyone', '2027-05-01', 'No entry fee', false);
insert into kofi.events (id, title, kind, starts_at, summary, published)
values ('a4ffffff-0000-4000-8000-000000000001', 'Draft event', 'talk', '2027-05-01T18:00:00-04:00', 'Not announced yet.', false);
insert into kofi.stories (id, title, dek, kind, body, author, published_on, artwork_ids, published)
values ('a5ffffff-0000-4000-8000-000000000001', 'Draft story', 'Dek.', 'essay', 'Body.', 'Kofi', '2027-05-01',
        array['30000000-0000-4000-8000-000000000011']::uuid[], false);
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare
  v uuid[];
begin
  if (select count(*) from kofi.exhibitions_visible) <> 4 or exists (select 1 from kofi.exhibitions where not published)
     or (select count(*) from kofi.open_calls) <> 4 or (select count(*) from kofi.events) <> 4
     or (select count(*) from kofi.stories_visible) <> 4 then
    raise exception 'FAIL: a visitor should see exactly the published programme (4 exhibitions, 4 calls, 4 events, 4 stories)';
  end if;
  if exists (select 1 from kofi.exhibitions_visible where id = 'a1ffffff-0000-4000-8000-000000000001')
     or exists (select 1 from kofi.open_calls where id = 'a2ffffff-0000-4000-8000-000000000001')
     or exists (select 1 from kofi.events where id = 'a4ffffff-0000-4000-8000-000000000001')
     or exists (select 1 from kofi.stories_visible where id = 'a5ffffff-0000-4000-8000-000000000001') then
    raise exception 'FAIL: a visitor can see a draft programme item';
  end if;
  raise notice 'ok: visitor sees published exhibitions / calls / events / stories only, never drafts';

  select artwork_ids into v from kofi.exhibitions_visible where id = 'a1000000-0000-4000-8000-000000000004';
  if v <> array['30000000-0000-4000-8000-000000000011', '30000000-0000-4000-8000-000000000012',
                '30000000-0000-4000-8000-000000000041']::uuid[] then
    raise exception 'FAIL: Night Weather works for a visitor should be mara1, mara2, deshawn1 in order (pending Priya and paused June dropped), got %', v;
  end if;
  raise notice 'ok: exhibition artwork_ids are filtered server-side to discoverable works, order kept (pending / paused artists'' works dropped)';

  if kofi.programme_artwork_ids('story', 'a5ffffff-0000-4000-8000-000000000001') <> '{}'::uuid[] then
    raise exception 'FAIL: programme_artwork_ids() leaks a draft story''s works to a visitor';
  end if;
  raise notice 'ok: programme_artwork_ids() called directly returns nothing for a draft';

  if (select exhibition_id from kofi.open_calls_visible where id = 'a2000000-0000-4000-8000-000000000003') is not null
     or (select exhibition_id from kofi.events_visible where id = 'a4000000-0000-4000-8000-000000000003') is not null then
    raise exception 'FAIL: a call / event links a draft exhibition for a visitor';
  end if;
  if (select exhibition_id from kofi.open_calls_visible where id = 'a2000000-0000-4000-8000-000000000002') <> 'a1000000-0000-4000-8000-000000000004' then
    raise exception 'FAIL: the Night Weather call should keep its link to the published exhibition';
  end if;
  if (select artist_id from kofi.stories_visible where id = 'a5000000-0000-4000-8000-000000000002') is not null then
    raise exception 'FAIL: a story links a paused artist for a visitor';
  end if;
  raise notice 'ok: calls / events drop links to draft exhibitions; stories drop links to artists the visitor cannot see';

  perform kofi_test.expect_error($q$select exhibition_id from kofi.open_calls$q$, '42501');
  perform kofi_test.expect_error($q$select exhibition_id from kofi.events$q$, '42501');
  perform kofi_test.expect_error($q$select artist_id from kofi.stories$q$, '42501');
  if kofi.programme_exhibition_link('open_call', 'a2000000-0000-4000-8000-000000000003') is not null
     or kofi.programme_exhibition_link('event', 'a4000000-0000-4000-8000-000000000003') is not null
     or kofi.story_artist_link('a5000000-0000-4000-8000-000000000002') is not null then
    raise exception 'FAIL: a link helper called directly leaks a draft exhibition / paused artist id to a visitor';
  end if;
  raise notice 'ok: visitor cannot read exhibition_id (calls, events) or stories.artist_id from the base tables, nor through the link helpers';

  perform kofi_test.expect_error($q$select artwork_ids from kofi.exhibitions$q$, '42501');
  perform kofi_test.expect_error($q$select artwork_ids from kofi.stories$q$, '42501');
  raise notice 'ok: visitor cannot read raw artwork_ids from the base tables (views only)';

  perform kofi_test.expect_error($q$insert into kofi.exhibitions (title, starts_on, summary) values ('x', '2027-01-01', 'x')$q$, '42501');
  perform kofi_test.expect_error($q$select 1 from kofi.applications$q$, '42501');
  perform kofi_test.expect_error($q$select 1 from kofi.applications_visible$q$, '42501');
  perform kofi_test.expect_error($q$select 1 from kofi.buyer_inquiries$q$, '42501');
  perform kofi_test.expect_error($q$select 1 from kofi.buyer_inquiries_visible$q$, '42501');
  perform kofi_test.expect_error($q$select kofi.submit_application('a2000000-0000-4000-8000-000000000002', '{}', 'x')$q$, '42501');
  perform kofi_test.expect_error($q$select kofi.set_buyer_inquiry_status('a6000000-0000-4000-8000-000000000001', 'closed')$q$, '42501');
  raise notice 'ok: visitor cannot write programme rows, read applications / collector inquiries, or call the artist/admin RPCs';
end $$;
rollback;

-- --------------------------------------- links: admin sees, artist can't ---
begin;
update kofi.exhibitions set published = false where id = 'a1000000-0000-4000-8000-000000000005';  -- Soft Ground → draft
update kofi.artists set status = 'paused' where id = '20000000-0000-4000-8000-000000000003';      -- June paused
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$
begin
  if (select exhibition_id from kofi.open_calls_visible where id = 'a2000000-0000-4000-8000-000000000003') is distinct from 'a1000000-0000-4000-8000-000000000005'
     or (select exhibition_id from kofi.events_visible where id = 'a4000000-0000-4000-8000-000000000003') is distinct from 'a1000000-0000-4000-8000-000000000005'
     or (select artist_id from kofi.stories_visible where id = 'a5000000-0000-4000-8000-000000000002') is distinct from '20000000-0000-4000-8000-000000000003' then
    raise exception 'FAIL: admin should see the links to the draft exhibition and the paused artist';
  end if;
  raise notice 'ok: admin sees call / event links to a draft exhibition and a story''s link to a paused artist';
end $$;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
begin
  perform kofi_test.expect_error($q$select exhibition_id from kofi.open_calls$q$, '42501');
  perform kofi_test.expect_error($q$select artist_id from kofi.stories$q$, '42501');
  if (select exhibition_id from kofi.events_visible where id = 'a4000000-0000-4000-8000-000000000003') is not null
     or (select artist_id from kofi.stories_visible where id = 'a5000000-0000-4000-8000-000000000002') is not null then
    raise exception 'FAIL: an artist sees a link to a draft exhibition or another paused artist';
  end if;
  if (select artist_id from kofi.stories_visible where id = 'a5000000-0000-4000-8000-000000000001') is distinct from '20000000-0000-4000-8000-000000000001' then
    raise exception 'FAIL: a visible artist link should be kept';
  end if;
  raise notice 'ok: a signed-in artist gets the same gated links (base columns denied, draft / paused targets null, visible ones kept)';
end $$;
rollback;

-- ----------------------------------------------- admin: drafts + writes -----
begin;
insert into kofi.exhibitions (id, title, starts_on, summary, published)
values ('a1ffffff-0000-4000-8000-000000000001', 'Draft show', '2027-05-01', 'Not announced yet.', false);
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$
declare
  v_id uuid;
  v_created timestamptz;
begin
  if (select count(*) from kofi.exhibitions_visible) <> 6
     or not exists (select 1 from kofi.exhibitions_visible where id = 'a1ffffff-0000-4000-8000-000000000001') then
    raise exception 'FAIL: admin should see the 5 published exhibitions and the draft';
  end if;
  if cardinality((select artwork_ids from kofi.exhibitions_visible where id = 'a1000000-0000-4000-8000-000000000004')) <> 5 then
    raise exception 'FAIL: admin should see all 5 Night Weather works';
  end if;
  raise notice 'ok: admin sees drafts and every attached work';

  insert into kofi.exhibitions (title, starts_on, ends_on, summary, image, artwork_ids, published)
  values ('Test show', '2027-02-01', '2027-03-01', 'A test.', '{"src":"storage:kofi-programme/exhibitions/x.jpg","alt":"A room"}',
          array['30000000-0000-4000-8000-000000000013']::uuid[], true)
  returning id, created_at into v_id, v_created;
  update kofi.exhibitions set title = 'Test show (revised)', published = false where id = v_id;
  perform kofi_test.expect_error(format($q$update kofi.exhibitions set created_at = now() - interval '1 year' where id = %L$q$, v_id), '42501');
  delete from kofi.exhibitions where id = v_id;
  if (select count(*) from kofi.audit_events where entity_type = 'exhibition' and entity_id = v_id::text
        and action in ('programme.save', 'programme.delete') and actor_id = '10000000-0000-4000-8000-000000000008') <> 3 then
    raise exception 'FAIL: expected programme.save ×2 + programme.delete audited for the admin';
  end if;
  raise notice 'ok: admin creates, edits and deletes an exhibition; each write audited server-side; created_at not writable';

  perform kofi_test.expect_error($q$insert into kofi.exhibitions (title, starts_on, ends_on, summary) values ('x', '2027-03-01', '2027-02-01', 'x')$q$, '23514', null, '%exhibitions_dates_order%');
  perform kofi_test.expect_error($q$insert into kofi.exhibitions (title, starts_on, summary, external_url) values ('x', '2027-03-01', 'x', 'javascript:alert(1)')$q$, '23514', null, '%exhibitions_external_url_scheme%');
  perform kofi_test.expect_error($q$insert into kofi.exhibitions (title, starts_on, summary, image) values ('x', '2027-03-01', 'x', '{"src":"https://evil.example/x.jpg","alt":"x"}')$q$, '23514', null, '%exhibitions_image_src%');
  perform kofi_test.expect_error($q$insert into kofi.exhibitions (title, starts_on, summary, image) values ('x', '2027-03-01', 'x', '{"src":"/art/hero.jpg","alt":" "}')$q$, '23514', null, '%exhibitions_image_alt%');
  perform kofi_test.expect_error($q$insert into kofi.stories (title, dek, kind, body, author, published_on, image) values ('x', 'x', 'essay', 'x', 'x', '2027-01-01', '{"alt":"no source"}')$q$, '23514', null, '%stories_image_src%');
  perform kofi_test.expect_error($q$insert into kofi.open_calls (title, summary, eligibility, opens_on, fee, image) values ('x', 'x', 'x', '2027-01-01', 'x', '{"src":"/art/../secret.jpg","alt":"x"}')$q$, '23514', null, '%open_calls_image_src%');
  perform kofi_test.expect_error($q$insert into kofi.open_calls (title, summary, eligibility, opens_on, fee, max_works) values ('x', 'x', 'x', '2027-01-01', 'x', 11)$q$, '23514', null, '%open_calls_max_works_range%');
  perform kofi_test.expect_error(format($q$insert into kofi.exhibitions (title, starts_on, summary) values (%L, '2027-01-01', 'x')$q$, repeat('t', 161)), '23514', null, '%exhibitions_title_length%');
  perform kofi_test.expect_error($q$insert into kofi.exhibitions (title, starts_on, summary) values ('  ', '2027-01-01', 'x')$q$, '23514', null, '%exhibitions_title_required%');
  perform kofi_test.expect_error($q$insert into kofi.open_calls (title, summary, eligibility, opens_on, deadline, fee) values ('x', 'x', 'x', '2027-01-02', '2027-01-01', 'x')$q$, '23514', null, '%open_calls_dates_order%');
  perform kofi_test.expect_error($q$insert into kofi.events (title, kind, starts_at, ends_at, summary) values ('x', 'talk', '2027-01-02T10:00Z', '2027-01-02T09:00Z', 'x')$q$, '23514', null, '%events_times_order%');
  perform kofi_test.expect_error($q$insert into kofi.events (title, kind, starts_at, summary, venue) values ('x', 'talk', '2027-01-02T10:00Z', 'x', '{"name":"Kofi"}')$q$, '23514', null, '%events_venue_shape%');
  perform kofi_test.expect_error($q$insert into kofi.stories (title, dek, kind, body, author, published_on, artwork_ids) values ('x', 'x', 'essay', 'x', 'x', '2027-01-01', array['3fffffff-0000-4000-8000-000000000000']::uuid[])$q$,
    '22023', 'artworkIds', 'One of the attached works no longer exists.');
  perform kofi_test.expect_error($q$insert into kofi.open_calls (title, summary, eligibility, opens_on, fee, exhibition_id) values ('x', 'x', 'x', '2027-01-01', 'x', 'a1ffffff-0000-4000-8000-00000000dead')$q$, '23503', null, '%open_calls_exhibition_id_fkey%');
  insert into kofi.stories (title, dek, kind, body, author, published_on, artwork_ids)
  values ('x', 'x', 'essay', 'x', 'x', '2027-01-01',
          array['30000000-0000-4000-8000-000000000012', '30000000-0000-4000-8000-000000000011', '30000000-0000-4000-8000-000000000012']::uuid[])
  returning id into v_id;
  if (select artwork_ids from kofi.stories_visible where id = v_id)
       <> array['30000000-0000-4000-8000-000000000012', '30000000-0000-4000-8000-000000000011']::uuid[] then
    raise exception 'FAIL: duplicate artwork ids should be dropped, order kept';
  end if;
  raise notice 'ok: unknown attached works / exhibitions are refused; duplicate works dropped, order kept';
  raise notice 'ok: CHECK constraints reject bad date order, non-http(s) urls, foreign / missing / traversing image sources, blank alt text, max_works 11, venue without city';

  perform kofi_test.expect_error($q$delete from kofi.open_calls where id = 'a2000000-0000-4000-8000-000000000004'$q$, '22023', 'call',
    'This call has applications. Unpublish it instead.');
  update kofi.open_calls set published = false where id = 'a2000000-0000-4000-8000-000000000004';
  raise notice 'ok: a call with applications cannot be deleted (Unpublish it instead), only unpublished';
end $$;
rollback;

-- ----------------------------------- owners see the gallery rule, too ------
begin;
insert into kofi.exhibitions (id, title, starts_on, summary, artwork_ids, published)
values ('a1ffffff-0000-4000-8000-000000000002', 'Mara draft test', '2027-05-01', 'x',
        array['30000000-0000-4000-8000-000000000013', '30000000-0000-4000-8000-000000000011']::uuid[], true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
begin
  if (select artwork_ids from kofi.exhibitions_visible where id = 'a1ffffff-0000-4000-8000-000000000002')
       <> array['30000000-0000-4000-8000-000000000011']::uuid[] then
    raise exception 'FAIL: programme pages should not show an owner''s own Kofi-only work (same rule as the gallery)';
  end if;
  raise notice 'ok: an artist''s own Kofi-only work is not shown on a programme page (gallery rule, as in mock mode)';
end $$;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated"}';
do $$
begin
  if not exists (select 1 from kofi.exhibitions_visible where id = 'a1000000-0000-4000-8000-000000000004'
                 and artwork_ids @> array['30000000-0000-4000-8000-000000000011']::uuid[]) then
    raise exception 'FAIL: a verified curator should see the public works of Night Weather';
  end if;
  raise notice 'ok: a verified curator sees the exhibition works';
end $$;
rollback;

-- ------------------------------------------- artists/curators cannot write --
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare
  n integer;
begin
  perform kofi_test.expect_error($q$insert into kofi.exhibitions (title, starts_on, summary, published) values ('Mara''s show', '2027-01-01', 'x', true)$q$, '42501');
  perform kofi_test.expect_error($q$insert into kofi.open_calls (title, summary, eligibility, opens_on, fee) values ('x', 'x', 'x', '2027-01-01', 'x')$q$, '42501');
  perform kofi_test.expect_error($q$insert into kofi.events (title, kind, starts_at, summary) values ('x', 'talk', now(), 'x')$q$, '42501');
  perform kofi_test.expect_error($q$insert into kofi.stories (title, dek, kind, body, author, published_on) values ('x', 'x', 'essay', 'x', 'x', '2027-01-01')$q$, '42501');
  update kofi.exhibitions set title = 'Hijacked' where id = 'a1000000-0000-4000-8000-000000000004';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: an artist updated an exhibition'; end if;
  delete from kofi.stories where id = 'a5000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: an artist deleted a story'; end if;
  perform kofi_test.expect_error($q$insert into kofi.applications (call_id, artist_id, artwork_ids, statement) values ('a2000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', array['30000000-0000-4000-8000-000000000011']::uuid[], 'A statement that is long enough.')$q$, '42501');
  perform kofi_test.expect_error($q$update kofi.applications set status = 'accepted' where id = 'a3000000-0000-4000-8000-000000000001'$q$, '42501');
  perform kofi_test.expect_error($q$select kofi.set_application_status('a3000000-0000-4000-8000-000000000003', 'accepted')$q$, '42501', null, 'Kofi staff only.');
  raise notice 'ok: an artist cannot insert/update/delete programme rows, write applications directly, or decide applications';
end $$;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated"}';
do $$
begin
  perform kofi_test.expect_error($q$insert into kofi.exhibitions (title, starts_on, summary) values ('x', '2027-01-01', 'x')$q$, '42501');
  if exists (select 1 from kofi.applications_visible) or exists (select 1 from kofi.applications) then
    raise exception 'FAIL: a curator can see applications';
  end if;
  if exists (select 1 from kofi.buyer_inquiries_visible) then
    raise exception 'FAIL: a curator can see collector inquiries';
  end if;
  perform kofi_test.expect_error($q$select kofi.submit_application('a2000000-0000-4000-8000-000000000002', array['30000000-0000-4000-8000-000000000011']::uuid[], 'A statement that is long enough.')$q$, '42501');
  raise notice 'ok: a curator cannot write programme rows, sees no applications or collector inquiries, cannot apply';
end $$;
rollback;

-- ===================================================== submit_application ===
begin;
-- Night Weather award: open around "today", whatever the real date is.
update kofi.open_calls set opens_on = kofi_test.kofi_today() - 10, deadline = kofi_test.kofi_today() + 30
where id = 'a2000000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare
  v_id uuid;
  r record;
  v_ok text := 'Two night paintings: they belong together and were made in the same rainy week.';
begin
  v_id := kofi.submit_application('a2000000-0000-4000-8000-000000000002',
    array['30000000-0000-4000-8000-000000000011', '30000000-0000-4000-8000-000000000012']::uuid[], '   ' || v_ok || E'\n');
  select * into r from kofi.applications_visible where id = v_id;
  if r.status <> 'submitted' or r.artist_id <> '20000000-0000-4000-8000-000000000001' or r.statement <> v_ok
     or r.call_title <> 'Night Weather Studio Award' or r.artist_working_name <> 'Mara Oyelaran' or r.staff_note is not null
     or r.artwork_ids <> array['30000000-0000-4000-8000-000000000011', '30000000-0000-4000-8000-000000000012']::uuid[] then
    raise exception 'FAIL: submitted application reads back wrong: %', row_to_json(r);
  end if;
  raise notice 'ok: submit_application() happy path — Mara applies with 2 works, statement trimmed, readable with call title';

  perform kofi_test.expect_error($q$select kofi.submit_application('a2000000-0000-4000-8000-000000000002', array['30000000-0000-4000-8000-000000000011']::uuid[], 'Another statement that is long enough.')$q$,
    '22023', 'call', 'You have already applied to this call.');
  raise notice 'ok: rejects a second live application to the same call';

  perform kofi.withdraw_application(v_id);
  v_id := kofi.submit_application('a2000000-0000-4000-8000-000000000002',
    array['30000000-0000-4000-8000-000000000011']::uuid[], v_ok);
  raise notice 'ok: after withdrawing, the artist may apply again';
end $$;
reset role;
do $$
begin
  if (select count(*) from kofi.audit_events where action = 'application.submit' and actor_id = '10000000-0000-4000-8000-000000000001') <> 2
     or (select count(*) from kofi.audit_events where action = 'application.withdraw' and actor_id = '10000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'FAIL: application.submit / application.withdraw not audited';
  end if;
  raise notice 'ok: application.submit and application.withdraw audited with the artist as actor';
end $$;
rollback;

-- Every rejection, in validateApplication() order, with the same message + field.
begin;
update kofi.open_calls set opens_on = kofi_test.kofi_today() - 10, deadline = kofi_test.kofi_today() + 30
where id in ('a2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001');
update kofi.open_calls set opens_on = '2099-11-05', deadline = '2099-12-01' where id = 'a2000000-0000-4000-8000-000000000003';
update kofi.open_calls set opens_on = kofi_test.kofi_today() - 60, deadline = kofi_test.kofi_today() - 1 where id = 'a2000000-0000-4000-8000-000000000004';
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare
  ok constant text := 'A statement that is clearly long enough to pass.';
  m1 constant text := '30000000-0000-4000-8000-000000000011';
  m2 constant text := '30000000-0000-4000-8000-000000000012';
  m3 constant text := '30000000-0000-4000-8000-000000000013';
  nw constant text := 'a2000000-0000-4000-8000-000000000002';
  sql text := 'select kofi.submit_application(%L, %L::uuid[], %L)';
  msg text;
begin
  perform kofi_test.expect_error(format(sql, 'a2ffffff-0000-4000-8000-00000000dead', array[m1], ok), 'P0002', null, 'Open call not found.');
  perform kofi_test.expect_error(format(sql, 'a2000000-0000-4000-8000-000000000004', array[m1], ok), '22023', 'call', 'This call has closed.');
  perform kofi_test.expect_error(format(sql, 'a2000000-0000-4000-8000-000000000003', array[m1], ok), '22023', 'call', 'This call opens on Nov 5, 2099.');
  perform kofi_test.expect_error(format(sql, 'a2000000-0000-4000-8000-000000000001', array[m1], ok), '22023', 'call',
    'Applications for this call are taken on the partner' || chr(8217) || 's form.');
  raise notice 'ok: rejects closed, upcoming ("This call opens on Nov 5, 2099.") and external-form calls';

  perform kofi_test.expect_error(format(sql, nw, array[m1, m1], ok), '22023', 'artworkIds', 'Each work can only be attached once.');
  perform kofi_test.expect_error(format(sql, nw, array[]::text[], ok), '22023', 'artworkIds', 'Attach at least one work.');
  perform kofi_test.expect_error(format(sql, nw, array[m1, '30000000-0000-4000-8000-000000000031'], ok), '22023', 'artworkIds', 'You can only attach your own works.');
  perform kofi_test.expect_error(format(sql, nw, array['3fffffff-0000-4000-8000-000000000000'], ok), '22023', 'artworkIds', 'You can only attach your own works.');
  perform kofi_test.expect_error(format(sql, nw, array[m1, m2, m3, m1], ok), '22023', 'artworkIds', 'Each work can only be attached once.');
  perform kofi_test.expect_error(format(sql, nw, array[m1], 'Too short.'), '22023', 'statement', 'Write at least a sentence or two about why these works fit the call.');
  perform kofi_test.expect_error(format(sql, nw, array[m1], '   ' || repeat(' ', 30) || 'short   '), '22023', 'statement', 'Write at least a sentence or two%');
  perform kofi_test.expect_error(format(sql, nw, array[m1], repeat('x', 2001)), '22023', 'statement', 'Keep the statement under 2000 characters.');
  raise notice 'ok: rejects duplicate works, no works, another artist''s work, unknown work, short and long statements';
end $$;
reset role;
update kofi.artworks set visibility = 'private' where id = '30000000-0000-4000-8000-000000000012';
update kofi.open_calls set max_works = 1 where id = 'a2000000-0000-4000-8000-000000000003';
set local role authenticated;
do $$
declare
  msg text;
begin
  msg := kofi_test.expect_error($q$select kofi.submit_application('a2000000-0000-4000-8000-000000000002', array['30000000-0000-4000-8000-000000000011', '30000000-0000-4000-8000-000000000012']::uuid[], 'A statement that is clearly long enough to pass.')$q$,
    '22023', 'artworkIds', chr(8220) || '%' || chr(8221) || ' is set to Only me. Change it to Kofi team only or wider to attach it.');
  raise notice 'ok: rejects a private (Only me) work: %', msg;
end $$;
reset role;
update kofi.open_calls set max_works = 1, opens_on = kofi_test.kofi_today(), deadline = kofi_test.kofi_today() where id = 'a2000000-0000-4000-8000-000000000002';
update kofi.artworks set visibility = 'public' where id = '30000000-0000-4000-8000-000000000012';
set local role authenticated;
do $$
begin
  perform kofi_test.expect_error($q$select kofi.submit_application('a2000000-0000-4000-8000-000000000002', array['30000000-0000-4000-8000-000000000011', '30000000-0000-4000-8000-000000000012']::uuid[], 'A statement that is clearly long enough to pass.')$q$,
    '22023', 'artworkIds', 'This call accepts up to 1 work.');
  -- Deadline is inclusive: opens and closes today, still open.
  perform kofi.submit_application('a2000000-0000-4000-8000-000000000002', array['30000000-0000-4000-8000-000000000011']::uuid[], 'A statement that is clearly long enough to pass.');
  raise notice 'ok: rejects too many works ("This call accepts up to 1 work."); a call whose deadline is today is still open';
end $$;
reset role;
update kofi.open_calls set published = false where id = 'a2000000-0000-4000-8000-000000000003';
update kofi.open_calls set max_works = 3, opens_on = kofi_test.kofi_today() - 1, deadline = null where id = 'a2000000-0000-4000-8000-000000000003';
set local role authenticated;
do $$
begin
  perform kofi_test.expect_error($q$select kofi.submit_application('a2000000-0000-4000-8000-000000000003', array['30000000-0000-4000-8000-000000000011']::uuid[], 'A statement that is clearly long enough to pass.')$q$,
    'P0002', null, 'Open call not found.');
  raise notice 'ok: an unpublished (draft) call does not exist for an artist (NotFound, as in mock mode)';
end $$;
reset role;
update kofi.open_calls set published = true where id = 'a2000000-0000-4000-8000-000000000003';
update kofi.artists set status = 'paused' where id = '20000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$
begin
  perform kofi_test.expect_error($q$select kofi.submit_application('a2000000-0000-4000-8000-000000000003', array['30000000-0000-4000-8000-000000000011']::uuid[], 'A statement that is clearly long enough to pass.')$q$,
    '22023', 'artist', 'Your profile is paused. Contact Kofi to reopen it before applying.');
  raise notice 'ok: rejects a paused artist';
end $$;
reset role;
update kofi.artists set status = 'approved', consent_version = null, consent_accepted_at = null where id = '20000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$
begin
  perform kofi_test.expect_error($q$select kofi.submit_application('a2000000-0000-4000-8000-000000000003', array['30000000-0000-4000-8000-000000000011']::uuid[], 'A statement that is clearly long enough to pass.')$q$,
    '22023', 'artist', 'Accept the data consent in your studio before applying.');
  raise notice 'ok: rejects an artist without data consent';
end $$;
-- DeShawn already has a live application to Night Weather.
reset role;
update kofi.open_calls set opens_on = kofi_test.kofi_today() - 10, deadline = kofi_test.kofi_today() + 30, max_works = 3
where id = 'a2000000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}';
do $$
begin
  perform kofi_test.expect_error($q$select kofi.submit_application('a2000000-0000-4000-8000-000000000002', array['30000000-0000-4000-8000-000000000041']::uuid[], 'A statement that is clearly long enough to pass.')$q$,
    '22023', 'call', 'You have already applied to this call.');
  raise notice 'ok: rejects a duplicate application (DeShawn already applied)';
end $$;
-- Priya (pending review, consent accepted) may apply with her own public work.
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated"}';
do $$
begin
  perform kofi.submit_application('a2000000-0000-4000-8000-000000000002', array['30000000-0000-4000-8000-000000000051']::uuid[], 'A statement that is clearly long enough to pass.');
  raise notice 'ok: a pending (not paused) artist with consent may apply';
end $$;
rollback;

-- ================================================ who sees which application
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}';
do $$
declare
  r record;
begin
  select * into r from kofi.applications_visible where id = 'a3000000-0000-4000-8000-000000000002';
  if r.id is null or r.status <> 'declined' or r.decision_note is null or r.staff_note is not null or r.call_title <> 'Late Summer Open 2026' then
    raise exception 'FAIL: June should see her declined application with the decision note, without the staff note: %', row_to_json(r);
  end if;
  if (select count(*) from kofi.applications_visible) <> 1 or exists (select 1 from kofi.applications where artist_id <> '20000000-0000-4000-8000-000000000003') then
    raise exception 'FAIL: June sees someone else''s application';
  end if;
  perform kofi_test.expect_error($q$select staff_note from kofi.applications$q$, '42501');
  if exists (select 1 from kofi.application_labels('a3000000-0000-4000-8000-000000000001')) then
    raise exception 'FAIL: application_labels() answers June about Mara''s application';
  end if;
  if (select staff_note from kofi.application_labels('a3000000-0000-4000-8000-000000000002')) is not null then
    raise exception 'FAIL: application_labels() returns the staff note to the artist';
  end if;
  raise notice 'ok: artist sees only her own application, with the decision note and without the Kofi staff note (view, base table and helper)';
end $$;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
begin
  if (select count(*) from kofi.applications_visible) <> 1
     or not exists (select 1 from kofi.applications_visible where id = 'a3000000-0000-4000-8000-000000000001' and status = 'accepted') then
    raise exception 'FAIL: Mara should see exactly her accepted application';
  end if;
  raise notice 'ok: another artist (Mara) sees only her own application';
end $$;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$
begin
  if (select count(*) from kofi.applications_visible) <> 3
     or (select staff_note from kofi.applications_visible where id = 'a3000000-0000-4000-8000-000000000002') <> 'Strong; space-limited.' then
    raise exception 'FAIL: admin should see all 3 applications and June''s staff note';
  end if;
  raise notice 'ok: admin sees every application, including the Kofi staff note';
end $$;
rollback;

-- ================================================================ withdraw ===
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}';
do $$
begin
  perform kofi.withdraw_application('a3000000-0000-4000-8000-000000000003');
  if (select status from kofi.applications_visible where id = 'a3000000-0000-4000-8000-000000000003') <> 'withdrawn' then
    raise exception 'FAIL: DeShawn''s application should be withdrawn';
  end if;
  perform kofi_test.expect_error($q$select kofi.withdraw_application('a3000000-0000-4000-8000-000000000003')$q$, '22023', 'status',
    'This application has been decided and can no longer be withdrawn.');
  perform kofi_test.expect_error($q$select kofi.withdraw_application('a3000000-0000-4000-8000-000000000001')$q$, '42501', null, 'You can only withdraw your own applications.');
  perform kofi_test.expect_error($q$select kofi.withdraw_application('a3ffffff-0000-4000-8000-000000000000')$q$, 'P0002', null, 'Application not found.');
  raise notice 'ok: artist withdraws a submitted application once; cannot withdraw it twice or touch another artist''s';
end $$;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
begin
  perform kofi_test.expect_error($q$select kofi.withdraw_application('a3000000-0000-4000-8000-000000000001')$q$, '22023', 'status');
  raise notice 'ok: a decided (accepted) application cannot be withdrawn';
end $$;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$
begin
  perform kofi_test.expect_error($q$select kofi.withdraw_application('a3000000-0000-4000-8000-000000000002')$q$, '42501', null, 'Sign in as an artist to apply.');
  raise notice 'ok: only the artist withdraws (admin gets Forbidden)';
end $$;
reset role;
update kofi.applications set status = 'shortlisted' where id = 'a3000000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}';
do $$
begin
  perform kofi.withdraw_application('a3000000-0000-4000-8000-000000000002');
  raise notice 'ok: a shortlisted application can still be withdrawn';
end $$;
rollback;

-- ======================================================= status matrix ======
-- Every (from, to) pair for an admin must match canMoveApplication(from, to, 'admin').
begin;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$
declare
  f kofi.application_status;
  t kofi.application_status;
  allowed boolean;
  moved boolean;
  pairs integer := 0;
begin
  foreach f in array enum_range(null::kofi.application_status) loop
    foreach t in array enum_range(null::kofi.application_status) loop
      execute 'reset role';
      update kofi.applications set status = f, decided_at = null where id = 'a3000000-0000-4000-8000-000000000003';
      execute 'set local role authenticated';
      allowed := f <> t and f <> 'withdrawn' and t in ('shortlisted', 'accepted', 'declined');
      begin
        perform kofi.set_application_status('a3000000-0000-4000-8000-000000000003', t, null, null);
        moved := true;
      exception when invalid_parameter_value then
        moved := false;
      end;
      if moved <> allowed then
        raise exception 'FAIL: admin % → %: expected %, got %', f, t, case when allowed then 'allowed' else 'refused' end, case when moved then 'allowed' else 'refused' end;
      end if;
      if moved and (select (decided_at is not null) <> (t in ('accepted', 'declined')) from kofi.applications_visible where id = 'a3000000-0000-4000-8000-000000000003') then
        raise exception 'FAIL: decided_at should be set exactly for accepted/declined (% → %)', f, t;
      end if;
      pairs := pairs + 1;
    end loop;
  end loop;
  raise notice 'ok: set_application_status() follows canMoveApplication for all % admin (from, to) pairs; decided_at set on accept/decline', pairs;
end $$;
reset role;
set local role authenticated;
do $$
declare
  r record;
begin
  perform kofi.set_application_status('a3000000-0000-4000-8000-000000000001', 'declined', 'Space ran out, sorry.', 'Re-hang cut.');
  select * into r from kofi.applications_visible where id = 'a3000000-0000-4000-8000-000000000001';
  if r.status <> 'declined' or r.decision_note <> 'Space ran out, sorry.' or r.staff_note <> 'Re-hang cut.' then
    raise exception 'FAIL: decision correction did not store the notes: %', row_to_json(r);
  end if;
  perform kofi.set_application_status('a3000000-0000-4000-8000-000000000001', 'accepted');
  select * into r from kofi.applications_visible where id = 'a3000000-0000-4000-8000-000000000001';
  if r.decision_note <> 'Space ran out, sorry.' or r.staff_note <> 'Re-hang cut.' then
    raise exception 'FAIL: notes passed as null should be kept';
  end if;
  perform kofi.set_application_status('a3000000-0000-4000-8000-000000000001', 'declined', null, '');
  if (select staff_note from kofi.applications_visible where id = 'a3000000-0000-4000-8000-000000000001') is not null then
    raise exception 'FAIL: an empty staff note should clear it';
  end if;
  perform kofi_test.expect_error($q$select kofi.set_application_status('a3ffffff-0000-4000-8000-000000000000', 'accepted')$q$, 'P0002');
  perform kofi_test.expect_error($q$select kofi.set_application_status('a3000000-0000-4000-8000-000000000001', 'shortlisted', repeat('n', 2001))$q$, '22023', 'decisionNote', 'Keep notes under 2000 characters.');
  perform kofi_test.expect_error($q$select kofi.set_application_status('a3000000-0000-4000-8000-000000000001', 'declined')$q$, '22023', 'status', 'This application cannot be moved from declined to declined.');
  raise notice 'ok: admin corrects a decision with notes; omitted notes kept, empty clears; long notes and no-op moves refused; unknown id is NotFound';
end $$;
reset role;
do $$
begin
  if (select count(*) from kofi.audit_events where action = 'application.status' and actor_id = '10000000-0000-4000-8000-000000000008') < 10 then
    raise exception 'FAIL: application.status changes not audited';
  end if;
  raise notice 'ok: application.status audited for every move';
end $$;
rollback;

-- ================================================== collector inquiries ======
begin;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare
  v_id uuid;
  i integer;
  sql text := $q$select kofi.submit_buyer_inquiry(%L, %L, %L, %L, %L, %L, %L)$q$;
  m1 constant text := '30000000-0000-4000-8000-000000000011';
  good constant text := 'Is this still available? I would like to see it in person.';
begin
  v_id := kofi.submit_buyer_inquiry(m1::uuid, '  Ada Visitor ', 'ada@example.net', null, 'purchase', good, true);
  if v_id is null then raise exception 'FAIL: no id returned'; end if;
  perform kofi.submit_buyer_inquiry(null, 'Ada Visitor', 'ada@example.net', 'Ada & Co', 'placement', 'Looking for three works for an office.', true);
  raise notice 'ok: a visitor sends a collector inquiry about a public work (and one with no work); only an id comes back';

  perform kofi_test.expect_error(format(sql, '30000000-0000-4000-8000-000000000013', 'Ada', 'ada@example.net', null, 'purchase', good, true), 'P0002', null, 'Artwork not found.');
  perform kofi_test.expect_error(format(sql, '30000000-0000-4000-8000-000000000033', 'Ada', 'ada@example.net', null, 'purchase', good, true), 'P0002');
  perform kofi_test.expect_error(format(sql, '30000000-0000-4000-8000-000000000051', 'Ada', 'ada@example.net', null, 'purchase', good, true), 'P0002');
  perform kofi_test.expect_error(format(sql, '3fffffff-0000-4000-8000-000000000000', 'Ada', 'ada@example.net', null, 'purchase', good, true), 'P0002');
  raise notice 'ok: inquiries about a Kofi-only work, a private draft, a pending artist''s work or an unknown id are refused (NotFound)';

  perform kofi_test.expect_error(format(sql, m1, 'A', 'ada@example.net', null, 'purchase', good, true), '22023', 'name', 'Tell us your name.');
  perform kofi_test.expect_error(format(sql, m1, 'Ada', 'ada@example', null, 'purchase', good, true), '22023', 'email', 'Enter an email address we can reply to.');
  perform kofi_test.expect_error(format(sql, m1, 'Ada', 'ada@example.net', repeat('o', 161), 'purchase', good, true), '22023', 'organization', 'Keep the organisation name under 160 characters.');
  perform kofi_test.expect_error(format(sql, m1, 'Ada', 'ada@example.net', null, 'bribe', good, true), '22023', 'intent', 'Choose what you are asking about.');
  perform kofi_test.expect_error(format(sql, m1, 'Ada', 'ada@example.net', null, 'purchase', 'Hi', true), '22023', 'message', 'Add a line or two so Kofi knows how to help.');
  perform kofi_test.expect_error(format(sql, m1, 'Ada', 'ada@example.net', null, 'purchase', repeat('m', 2001), true), '22023', 'message', 'Keep the message under 2000 characters.');
  perform kofi_test.expect_error(format(sql, m1, 'Ada', 'ada@example.net', null, 'purchase', good, false), '22023', 'consent', 'Tick the box so Kofi can reply to you.');
  raise notice 'ok: validateBuyerInquiry() rules re-checked server-side with the same messages and fields';

  for i in 3..5 loop
    perform kofi.submit_buyer_inquiry(m1::uuid, 'Ada Visitor', case when i % 2 = 0 then 'ADA@example.net' else 'ada@example.net' end, null, 'purchase', good, true);
  end loop;
  perform kofi_test.expect_error(format(sql, m1, 'Ada', ' Ada@Example.NET ', null, 'purchase', good, true), '22023', 'email',
    'Kofi already has your messages ' || chr(8212) || ' we' || chr(8217) || 'll reply soon.');
  perform kofi.submit_buyer_inquiry(m1::uuid, 'Bo Visitor', 'bo@example.net', null, 'purchase', good, true);
  raise notice 'ok: the 6th inquiry from one address (any letter case) within 24 h is refused; other addresses are unaffected';

  perform kofi_test.expect_error($q$select count(*) from kofi.buyer_inquiries$q$, '42501');
  perform kofi_test.expect_error($q$select count(*) from kofi.buyer_inquiries_visible$q$, '42501');
  perform kofi_test.expect_error($q$insert into kofi.buyer_inquiries (name, email, intent, message) values ('Ada', 'ada@example.net', 'purchase', 'Direct insert attempt.')$q$, '42501');
  raise notice 'ok: a visitor cannot read collector inquiries or insert them directly';
end $$;
reset role;
do $$
declare
  r record;
begin
  select * into r from kofi.buyer_inquiries where name = 'Ada Visitor' and artwork_id is not null order by created_at limit 1;
  if r.artist_id <> '20000000-0000-4000-8000-000000000001' or r.status <> 'new' or r.consented_at is null then
    raise exception 'FAIL: inquiry should derive artist_id from the work, start as new and record consent: %', row_to_json(r);
  end if;
  if (select count(*) from kofi.audit_events where action = 'buyer_inquiry.submit' and actor_id = 'anonymous' and actor_role = 'public') <> 6 then
    raise exception 'FAIL: expected 6 buyer_inquiry.submit audit rows attributed to an anonymous visitor';
  end if;
  if exists (select 1 from kofi.audit_events where action = 'buyer_inquiry.submit' and meta::text like '%@%') then
    raise exception 'FAIL: the audit log stores the collector''s email';
  end if;
  raise notice 'ok: artist derived server-side; consent recorded; submissions audited as anonymous, without the email';
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
begin
  if exists (select 1 from kofi.buyer_inquiries) or exists (select 1 from kofi.buyer_inquiries_visible)
     or exists (select 1 from kofi.buyer_inquiry_labels('a6000000-0000-4000-8000-000000000001')) then
    raise exception 'FAIL: an artist can read collector inquiries (even about her own work)';
  end if;
  perform kofi.submit_buyer_inquiry('30000000-0000-4000-8000-000000000012', 'Mara Oyelaran', 'mara.personal@example.net', null, 'other', 'Testing the form from my account.', true);
  perform kofi_test.expect_error($q$select kofi.set_buyer_inquiry_status('a6000000-0000-4000-8000-000000000001', 'closed')$q$, '42501', null, 'Kofi staff only.');
  raise notice 'ok: a signed-in artist may submit but not read or triage collector inquiries';
end $$;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$
declare
  r record;
begin
  select * into r from kofi.buyer_inquiries_visible where id = 'a6000000-0000-4000-8000-000000000001';
  if r.artwork_title is null or r.artist_working_name <> 'Mara Oyelaran' or r.email <> 'dana.whitcomb@example.com' then
    raise exception 'FAIL: admin inbox row is missing labels: %', row_to_json(r);
  end if;
  perform kofi.set_buyer_inquiry_status('a6000000-0000-4000-8000-000000000001', 'in progress', 'Called back Tuesday.');
  perform kofi.set_buyer_inquiry_status('a6000000-0000-4000-8000-000000000001', 'closed');
  select * into r from kofi.buyer_inquiries_visible where id = 'a6000000-0000-4000-8000-000000000001';
  if r.status <> 'closed' or r.staff_note <> 'Called back Tuesday.' then
    raise exception 'FAIL: set_buyer_inquiry_status() result wrong: %', row_to_json(r);
  end if;
  perform kofi_test.expect_error($q$select kofi.set_buyer_inquiry_status('a6ffffff-0000-4000-8000-000000000000', 'closed')$q$, 'P0002');
  perform kofi_test.expect_error($q$update kofi.buyer_inquiries set status = 'closed'$q$, '42501');
  perform kofi_test.expect_error($q$select kofi.set_buyer_inquiry_status('a6000000-0000-4000-8000-000000000001', 'closed', repeat('n', 2001))$q$, '22023', 'staffNote', 'Keep notes under 2000 characters.');
  if (select count(*) from kofi.buyer_inquiries_visible) <> 9 then
    raise exception 'FAIL: admin should see 2 seeded + 7 new inquiries, saw %', (select count(*) from kofi.buyer_inquiries_visible);
  end if;
  raise notice 'ok: admin lists collector inquiries with work/artist labels and moves them new → in progress → closed (RPC only)';
end $$;
rollback;

-- =============================================================== storage ====
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
insert into storage.objects (bucket_id, name) values ('kofi-programme', 'exhibitions/a1000000-0000-4000-8000-000000000004.jpg');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
begin
  perform kofi_test.expect_error($q$insert into storage.objects (bucket_id, name) values ('kofi-programme', 'exhibitions/mara.jpg')$q$, '42501');
  update storage.objects set name = 'exhibitions/hijack.jpg' where bucket_id = 'kofi-programme';
  delete from storage.objects where bucket_id = 'kofi-programme';
  if exists (select 1 from storage.objects where bucket_id = 'kofi-programme') then
    raise exception 'FAIL: a non-admin can list kofi-programme objects through the API';
  end if;
  raise notice 'ok: only Kofi admins upload / replace / delete / list programme images; artists cannot';
end $$;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
begin
  perform kofi_test.expect_error($q$insert into storage.objects (bucket_id, name) values ('kofi-programme', 'x.jpg')$q$, '42501');
  if exists (select 1 from storage.objects where bucket_id = 'kofi-programme') then
    raise exception 'FAIL: a visitor can list kofi-programme objects through the API';
  end if;
  raise notice 'ok: visitors cannot upload to or enumerate the programme bucket (public URLs only)';
end $$;
reset role;
do $$
begin
  if (select count(*) from storage.objects where bucket_id = 'kofi-programme' and name = 'exhibitions/a1000000-0000-4000-8000-000000000004.jpg') <> 1 then
    raise exception 'FAIL: the admin upload or a non-admin change went wrong';
  end if;
  if not exists (select 1 from storage.buckets where id = 'kofi-programme' and public and allowed_mime_types @> array['image/jpeg'])
     or exists (select 1 from storage.buckets where id in ('artwork-images', 'vault') and public) then
    raise exception 'FAIL: kofi-programme should be the only public Kofi bucket';
  end if;
  raise notice 'ok: kofi-programme is public (images only); artwork-images and vault stay private';
end $$;
rollback;

-- ======================================================== demo reset ========
begin;
delete from kofi.applications where id = 'a3000000-0000-4000-8000-000000000003';
update kofi.exhibitions set title = 'Changed' where id = 'a1000000-0000-4000-8000-000000000004';
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$ begin perform kofi.kofi_demo_reset(); end $$;
reset role;
do $$
begin
  if (select count(*) from kofi.applications) <> 3 or (select title from kofi.exhibitions where id = 'a1000000-0000-4000-8000-000000000004') <> 'Night Weather'
     or (select count(*) from kofi.exhibitions) <> 5 or (select count(*) from kofi.buyer_inquiries) <> 2 then
    raise exception 'FAIL: kofi_demo_reset() did not restore the programme';
  end if;
  raise notice 'ok: kofi_demo_reset() restores the programme tables too';
end $$;
rollback;

-- ============================================== isolation of new objects ====
do $$
declare
  n integer;
begin
  select count(*) into n from pg_class c
  where c.relname in ('exhibitions', 'open_calls', 'events', 'stories', 'applications', 'buyer_inquiries', 'applied_migrations',
                      'exhibitions_visible', 'stories_visible', 'applications_visible', 'buyer_inquiries_visible')
    and c.relnamespace <> 'kofi'::regnamespace and c.relnamespace::regnamespace::text not like 'pg_%';
  if n <> 0 then
    raise exception 'FAIL: % programme relation(s) exist outside schema kofi', n;
  end if;
  select count(*) into n from pg_type t
  where t.typname in ('application_status', 'buyer_inquiry_status', 'event_kind', 'story_kind', 'buyer_intent')
    and t.typnamespace <> 'kofi'::regnamespace;
  if n <> 0 then
    raise exception 'FAIL: % programme enum(s) outside schema kofi', n;
  end if;
  select count(*) into n from pg_proc p
  where p.proname in ('submit_application', 'withdraw_application', 'set_application_status', 'submit_buyer_inquiry',
                      'set_buyer_inquiry_status', 'programme_artwork_ids', 'application_labels', 'buyer_inquiry_labels', 'programme_audit',
                      'artwork_discoverable', 'programme_check_artworks', 'programme_exhibition_link', 'story_artist_link',
                      'open_calls_guard_delete', 'programme_keep_created', 'programme_image_src_ok', 'programme_image_alt_ok',
                      'venue_ok', 'http_url_ok')
    and p.pronamespace <> 'kofi'::regnamespace;
  if n <> 0 then
    raise exception 'FAIL: % programme function(s) outside schema kofi', n;
  end if;
  raise notice 'ok: every programme table, view, enum and function is in schema kofi';

  if (select fp from kofi_test.baseline) is distinct from kofi_test.public_fingerprint() then
    raise exception 'FAIL: schema public changed (objects, grants, policies, triggers or the other product''s rows)';
  end if;
  raise notice 'ok: public fingerprint still identical after 0008 + programme seed + every programme test';

  if exists (select 1 from pg_policies where schemaname = 'storage' and policyname not like 'kofi %') then
    raise exception 'FAIL: a storage policy not named "kofi …" exists';
  end if;
  if (select count(*) from pg_policies where schemaname = 'storage' and policyname like 'kofi programme %') <> 4 then
    raise exception 'FAIL: expected the 4 "kofi programme …" storage policies';
  end if;
  if (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'kofi'
        and tablename in ('exhibitions', 'open_calls', 'events', 'stories', 'applications', 'buyer_inquiries')) <> 6 then
    raise exception 'FAIL: the 6 programme tables should be in supabase_realtime';
  end if;
  raise notice 'ok: storage additions are the namespaced kofi-programme bucket + 4 "kofi programme …" policies; 6 programme tables in realtime';

  if has_table_privilege('anon', 'kofi.applied_migrations', 'select') or has_table_privilege('authenticated', 'kofi.applied_migrations', 'select')
     or has_function_privilege('authenticated', 'kofi.programme_audit()', 'execute')
     or has_function_privilege('anon', 'kofi.open_calls_guard_delete()', 'execute')
     or has_function_privilege('anon', 'kofi.submit_application(uuid, uuid[], text)', 'execute')
     or has_function_privilege('anon', 'kofi.set_application_status(uuid, kofi.application_status, text, text)', 'execute')
     or not has_function_privilege('anon', 'kofi.submit_buyer_inquiry(uuid, text, text, text, text, text, boolean)', 'execute')
     or has_table_privilege('anon', 'kofi.buyer_inquiries', 'select')
     or has_table_privilege('authenticated', 'kofi.applications', 'insert')
     or has_table_privilege('authenticated', 'kofi.applications', 'update')
     or has_table_privilege('authenticated', 'kofi.buyer_inquiries', 'insert')
     or has_column_privilege('authenticated', 'kofi.applications', 'staff_note', 'select')
     or has_column_privilege('anon', 'kofi.exhibitions', 'artwork_ids', 'select')
     or has_column_privilege('anon', 'kofi.open_calls', 'exhibition_id', 'select')
     or has_column_privilege('authenticated', 'kofi.events', 'exhibition_id', 'select')
     or has_column_privilege('authenticated', 'kofi.stories', 'artist_id', 'select')
     or not has_column_privilege('authenticated', 'kofi.open_calls', 'exhibition_id', 'update') then
    raise exception 'FAIL: a programme privilege is wider than designed';
  end if;
  raise notice 'ok: least-privilege grants — no anon access to inquiries, no direct application writes, staff_note, artwork_ids and link columns gated, trigger functions not callable';

  if not exists (select 1 from kofi.applied_migrations where name = '0008_programme') then
    raise exception 'FAIL: 0008_programme not recorded in kofi.applied_migrations';
  end if;
  raise notice 'ok: 0008_programme recorded in kofi.applied_migrations';
end $$;

-- Harness helpers are test-only.
drop function kofi_test.expect_error(text, text, text, text);
drop function kofi_test.kofi_today();
revoke usage on schema kofi_test from anon, authenticated;

\echo 'programme_test.sql: all assertions passed'
