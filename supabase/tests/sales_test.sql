-- =============================================================================
-- Kofi Collections — partners, auctions, payouts, reports (0009_sales.sql)
--
-- Same conventions as programme_test.sql: each block impersonates a demo user
-- the way PostgREST does (set local role …; set local request.jwt.claims = …),
-- runs in its own transaction and rolls back. RAISE EXCEPTION on failure,
-- NOTICE 'ok: …' on success. Never depends on today's date (sale / payment
-- days are computed from kofi_today()).
--
-- Demo UUIDs (src/data/supabase/demo.ts):
--   users   mara …01  june …03  deshawn …04  priya …05  lena …06 (verified curator, inst_cma)
--           owen …07 (PENDING curator, inst_pit)  quincy …08 (admin)
--   artists mara 20…01  june 20…03  deshawn 20…04  priya 20…05 (pending)
--   works   aw_mara_1 30…11  aw_mara_2 30…12  aw_june_1 30…31  aw_deshawn_1 30…41  aw_priya_1 30…51
--   inst    inst_cma 40…01 (Lena)  inst_pit 40…03 (Owen)
--   calls   a2…02 Night Weather award (Kofi-run)  a2…04 Summer Open  a2…05 CMA benefit auction (organiser inst_cma)
--   apps    a3…01 Mara/Summer  a3…03 DeShawn/Night Weather  a3…04 Mara/CMA accepted  a3…05 DeShawn/CMA accepted
--           a3…06 Priya/CMA declined
--   lots    a7…01 #1 aw_mara_1 sold 820000 (Paddle 14)  a7…02 #2 aw_mara_2 live  a7…03 #3 aw_deshawn_1 sold 160000
--   payouts a8…01 Mara 574000 due  a8…03 DeShawn 112000 paid 2026-10-19
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
grant usage on schema kofi_test to anon, authenticated;
grant execute on function kofi_test.expect_error(text, text, text, text) to anon, authenticated;

create or replace function kofi_test.kofi_today() returns date
language sql stable as $$ select (now() at time zone 'America/New_York')::date $$;
grant execute on function kofi_test.kofi_today() to anon, authenticated;

-- ================================================================ seed =======
do $$
declare
  r record;
begin
  if (select count(*) from kofi.lots) <> 3 or (select count(*) from kofi.payouts) <> 2 then
    raise exception 'FAIL: expected the 3 seeded lots and 2 payouts';
  end if;
  select * into r from kofi.open_calls where id = 'a2000000-0000-4000-8000-000000000005';
  if r.kind <> 'auction' or r.organizer_institution_id <> '40000000-0000-4000-8000-000000000001' or not r.published
     or r.terms <> '{"artistSharePct":70,"kofiSharePct":20,"partnerSharePct":10,"buyerPremiumPct":10,"resaleRoyaltyPct":5,"currency":"USD","paymentNote":"Artists are paid within 30 days of the auction."}'::jsonb then
    raise exception 'FAIL: the CMA benefit auction is not seeded as designed: %', row_to_json(r);
  end if;
  if (select kind from kofi.open_calls where id = 'a2000000-0000-4000-8000-000000000002') <> 'award'
     or exists (select 1 from kofi.open_calls where id <> 'a2000000-0000-4000-8000-000000000005' and (organizer_institution_id is not null or terms is not null)) then
    raise exception 'FAIL: Night Weather should be an award call; only the CMA auction has an organiser / terms';
  end if;
  if (select sale from kofi.lots where id = 'a7000000-0000-4000-8000-000000000001') ->> 'soldAt' <> '2026-10-18T16:00:00.000Z' then
    raise exception 'FAIL: seeded sale time should be noon Kofi time as toISOString()';
  end if;
  raise notice 'ok: seed — CMA auction (organiser inst_cma, 70/20/10 terms), 3 lots, 2 payouts; Night Weather is an award call';
end $$;

-- ========================================================= pure helpers ======
do $$
declare
  t jsonb := '{"artistSharePct":70,"kofiSharePct":20,"partnerSharePct":10,"buyerPremiumPct":10,"resaleRoyaltyPct":5,"currency":"USD"}';
  r record;
begin
  if not kofi.call_terms_ok(t) or not kofi.call_terms_ok(null) then
    raise exception 'FAIL: valid terms / no terms should pass';
  end if;
  for r in select * from (values
      (t || '{"artistSharePct":70.5}', 'artistSharePct', 'Use a whole number from 0 to 100.'),
      (t || '{"kofiSharePct":"20"}', 'kofiSharePct', 'Use a whole number from 0 to 100.'),
      (t || '{"partnerSharePct":-1}', 'partnerSharePct', 'Use a whole number from 0 to 100.'),
      (t - 'resaleRoyaltyPct', 'resaleRoyaltyPct', 'Use a whole number from 0 to 100.'),
      (t || '{"buyerPremiumPct":101}', 'buyerPremiumPct', 'Use a whole number from 0 to 100.'),
      (t || '{"kofiSharePct":10}', 'artistSharePct', 'Artist, Kofi and partner shares must add up to 100%.'),
      (t || '{"buyerPremiumPct":31}', 'buyerPremiumPct', 'A buyer''s premium above 30% is not allowed.'),
      (t || '{"resaleRoyaltyPct":26}', 'resaleRoyaltyPct', 'A resale royalty above 25% is not allowed.'),
      (t || '{"currency":"usd"}', 'currency', 'Currency must be a 3-letter code (USD, CAD).'),
      (t - 'currency', 'currency', 'Currency must be a 3-letter code (USD, CAD).'),
      (t || jsonb_build_object('paymentNote', repeat('n', 601)), 'paymentNote', 'Keep the payment note under 600 characters.')
    ) as v (terms, field, message)
  loop
    if not exists (select 1 from kofi.call_terms_problem(r.terms) p where p.field = r.field and p.message = r.message) or kofi.call_terms_ok(r.terms) then
      raise exception 'FAIL: call_terms_problem(%) should be % / %, got %', r.terms, r.field, r.message, (select row_to_json(p) from kofi.call_terms_problem(r.terms) p);
    end if;
  end loop;
  if kofi.call_terms_ok(t || jsonb_build_object('paymentNote', repeat('n', 600))) is not true then
    raise exception 'FAIL: a 600-character payment note is allowed';
  end if;
  raise notice 'ok: call_terms_problem() = validateTerms() (whole numbers 0-100, sum 100, premium <= 30, royalty <= 25, ISO currency, note <= 600) with the same fields and messages';

  if kofi.js_iso(kofi.kofi_noon('2026-10-18')) <> '2026-10-18T16:00:00.000Z'
     or kofi.js_iso(kofi.kofi_noon('2026-12-01')) <> '2026-12-01T17:00:00.000Z'
     or kofi.kofi_day('2026-10-12T02:15:00Z') <> '2026-10-11' then
    raise exception 'FAIL: Kofi-day helpers (noon EDT/EST, day boundary) are wrong';
  end if;
  if kofi.iso_date_ok('2026-02-30') or kofi.iso_date_ok('2026-1-01') or not kofi.iso_date_ok('2028-02-29') then
    raise exception 'FAIL: iso_date_ok() should match isIsoDate()';
  end if;
  -- splitSale(): round half-up for positive cents (round(numeric) = Math.round here).
  if round(12345::numeric * 70 / 100) <> 8642 or round(12345::numeric * 10 / 100) <> 1235 or round(5::numeric * 10 / 100) <> 1 or round(4::numeric * 10 / 100) <> 0 then
    raise exception 'FAIL: round() does not round .5 up';
  end if;
  raise notice 'ok: noon Kofi time is written like toISOString(); Kofi day boundaries; isIsoDate(); .5 cents round up';
end $$;

-- ================================================ partner: open calls ========
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated"}';
do $$
declare
  r record;
  v_id uuid;
  t jsonb := '{"artistSharePct":60,"kofiSharePct":25,"partnerSharePct":15,"buyerPremiumPct":12,"resaleRoyaltyPct":5,"currency":"USD"}';
begin
  insert into kofi.open_calls (title, summary, eligibility, opens_on, fee, kind, terms, published, sample, organizer_institution_id)
  values ('CMA spring auction', 'A draft from the museum.', 'Artists with an approved Kofi profile', '2027-03-01', 'No entry fee', 'auction', t,
          true, true, '40000000-0000-4000-8000-000000000003')
  returning id into v_id;
  select * into r from kofi.open_calls_visible where id = v_id;
  if r.id is null or r.published or r.sample or r.organizer_institution_id <> '40000000-0000-4000-8000-000000000001' or r.kind <> 'auction' or r.terms <> t then
    raise exception 'FAIL: a partner''s new call should be a draft (published/sample false) organised by inst_cma: %', row_to_json(r);
  end if;
  raise notice 'ok: Lena inserts a call — forced to a draft (published = false, sample = false) with her own institution as organiser, whatever she sent';

  update kofi.open_calls set title = 'CMA spring benefit auction', terms = t || '{"buyerPremiumPct":15}' where id = v_id;
  if (select title from kofi.open_calls where id = v_id) <> 'CMA spring benefit auction' then
    raise exception 'FAIL: Lena should edit her own draft';
  end if;
  perform kofi_test.expect_error(format($q$update kofi.open_calls set published = true where id = %L$q$, v_id), '42501', null, 'Only Kofi can publish a call.');
  perform kofi_test.expect_error(format($q$update kofi.open_calls set organizer_institution_id = '40000000-0000-4000-8000-000000000002' where id = %L$q$, v_id), '42501', null, 'You can only edit calls your institution runs.');
  perform kofi_test.expect_error($q$update kofi.open_calls set title = 'x' where id = 'a2000000-0000-4000-8000-000000000005'$q$, '42501', null, 'Kofi has published this call. Ask Kofi to make changes.');
  update kofi.open_calls set title = 'Hijacked' where id = 'a2000000-0000-4000-8000-000000000002';
  if (select title from kofi.open_calls where id = 'a2000000-0000-4000-8000-000000000002') = 'Hijacked' then
    raise exception 'FAIL: Lena edited a Kofi-run call';
  end if;
  delete from kofi.open_calls where id = v_id;
  if not exists (select 1 from kofi.open_calls where id = v_id) then
    raise exception 'FAIL: deleting calls is Kofi-only';
  end if;
  raise notice 'ok: Lena edits her draft (title, terms); cannot publish it, re-assign it, edit the published CMA call, touch a Kofi-run call or delete';

  perform kofi_test.expect_error($q$insert into kofi.open_calls (title, summary, eligibility, opens_on, fee, kind) values ('x', 'x', 'x', '2027-01-01', 'x', 'auction')$q$,
    '22023', 'terms', 'An auction call must publish its compensation terms.');
  perform kofi_test.expect_error(format($q$insert into kofi.open_calls (title, summary, eligibility, opens_on, fee, kind, terms) values ('x', 'x', 'x', '2027-01-01', 'x', 'auction', %L)$q$, t || '{"kofiSharePct":5}'),
    '22023', 'artistSharePct', 'Artist, Kofi and partner shares must add up to 100%.');
  perform kofi_test.expect_error(format($q$insert into kofi.open_calls (title, summary, eligibility, opens_on, fee, kind, terms) values ('x', 'x', 'x', '2027-01-01', 'x', 'exhibition', %L)$q$, t || '{"buyerPremiumPct":31}'),
    '22023', 'buyerPremiumPct', 'A buyer''s premium above 30% is not allowed.');
  raise notice 'ok: an auction call needs terms; terms are validated server-side with validateTerms() messages and fields';
end $$;
reset role;
do $$
begin
  if not exists (select 1 from kofi.audit_events where action = 'programme.save' and entity_type = 'open_call' and actor_id = '10000000-0000-4000-8000-000000000006' and actor_role = 'curator') then
    raise exception 'FAIL: the partner''s call writes should be audited with actor role curator';
  end if;
  raise notice 'ok: partner call writes audited as programme.save, actor role curator';
end $$;
-- What other people see of Lena's draft.
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
begin
  if exists (select 1 from kofi.open_calls_visible where title like 'CMA spring%') then
    raise exception 'FAIL: a visitor sees a partner''s draft call';
  end if;
  if not exists (select 1 from kofi.open_calls_visible where id = 'a2000000-0000-4000-8000-000000000005' and kind = 'auction' and terms ->> 'artistSharePct' = '70') then
    raise exception 'FAIL: a visitor should read the published auction call''s kind and terms';
  end if;
  raise notice 'ok: visitors never see a partner''s draft; the published auction''s kind and terms are public';
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000007","role":"authenticated"}';
do $$
begin
  if exists (select 1 from kofi.open_calls_visible where title like 'CMA spring%') then
    raise exception 'FAIL: Owen (pending) sees Lena''s draft';
  end if;
  perform kofi_test.expect_error($q$insert into kofi.open_calls (title, summary, eligibility, opens_on, fee) values ('x', 'x', 'x', '2027-01-01', 'x')$q$, '42501');
  raise notice 'ok: Owen (pending curator) neither sees partner drafts nor creates calls';
end $$;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$
declare
  v_id uuid := (select id from kofi.open_calls where title = 'CMA spring benefit auction');
begin
  update kofi.open_calls set published = true where id = v_id;
  if not (select published from kofi.open_calls where id = v_id) then
    raise exception 'FAIL: Kofi should publish the partner''s draft';
  end if;
  perform kofi_test.expect_error(format($q$update kofi.open_calls set terms = null where id = %L$q$, v_id), '22023', 'terms', 'An auction call must publish its compensation terms.');
  perform kofi_test.expect_error($q$update kofi.open_calls set terms = terms || '{"artistSharePct":75,"kofiSharePct":15}' where id = 'a2000000-0000-4000-8000-000000000005'$q$,
    '22023', 'terms', 'Terms are locked once a lot has sold.');
  perform kofi_test.expect_error($q$update kofi.open_calls set kind = 'exhibition' where id = 'a2000000-0000-4000-8000-000000000005'$q$,
    '22023', 'kind', 'This call has lots, so it stays an auction.');
  update kofi.open_calls set title = 'Night Weather Benefit Auction (CMA)' where id = 'a2000000-0000-4000-8000-000000000005';
  raise notice 'ok: Kofi publishes the partner''s auction (terms required); terms are locked once a lot sold; a call with lots stays an auction; other edits allowed';
end $$;
reset role;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'open_calls_auction_terms' and conrelid = 'kofi.open_calls'::regclass)
     or not exists (select 1 from pg_constraint where conname = 'open_calls_terms_shape' and conrelid = 'kofi.open_calls'::regclass) then
    raise exception 'FAIL: the open_calls terms CHECK constraints are missing';
  end if;
  alter table kofi.open_calls disable trigger open_calls_sales_guard;
  perform kofi_test.expect_error($q$update kofi.open_calls set terms = null where id = 'a2000000-0000-4000-8000-000000000005'$q$, '23514', null, '%open_calls_auction_terms%');
  perform kofi_test.expect_error($q$update kofi.open_calls set terms = '{"artistSharePct":1}' where id = 'a2000000-0000-4000-8000-000000000005'$q$, '23514', null, '%open_calls_terms_shape%');
  alter table kofi.open_calls enable trigger open_calls_sales_guard;
  raise notice 'ok: CHECKs back the trigger — a published auction needs terms; terms must pass call_terms_ok()';
end $$;
rollback;

-- ======================================== partner: applications to its calls ==
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated"}';
do $$
declare
  r record;
begin
  if (select count(*) from kofi.applications_visible) <> 3
     or exists (select 1 from kofi.applications_visible where call_id <> 'a2000000-0000-4000-8000-000000000005')
     or exists (select 1 from kofi.applications where call_id <> 'a2000000-0000-4000-8000-000000000005') then
    raise exception 'FAIL: Lena should see exactly the 3 applications to the CMA auction';
  end if;
  select * into r from kofi.applications_visible where id = 'a3000000-0000-4000-8000-000000000004';
  if r.staff_note is distinct from 'Reserves agreed by phone: $6,000 and $1,000.' or r.artist_working_name <> 'Mara Oyelaran' then
    raise exception 'FAIL: the organiser should read the reviewers'' note and the artist name: %', row_to_json(r);
  end if;
  perform kofi_test.expect_error($q$select staff_note from kofi.applications$q$, '42501');
  if exists (select 1 from kofi.application_labels('a3000000-0000-4000-8000-000000000003')) then
    raise exception 'FAIL: application_labels() answers Lena about a Night Weather application';
  end if;
  raise notice 'ok: Lena sees only the CMA applications, with the reviewers'' note (view), never a Kofi-run call''s';

  perform kofi_test.expect_error($q$select kofi.set_application_status('a3000000-0000-4000-8000-000000000003', 'shortlisted')$q$, '42501', null, 'You can only manage calls your institution runs.');
  perform kofi.set_application_status('a3000000-0000-4000-8000-000000000006', 'shortlisted', null, 'Ask again once approved.');
  if (select status from kofi.applications_visible where id = 'a3000000-0000-4000-8000-000000000006') <> 'shortlisted'
     or (select staff_note from kofi.applications_visible where id = 'a3000000-0000-4000-8000-000000000006') <> 'Ask again once approved.' then
    raise exception 'FAIL: Lena should move Priya''s application and set the reviewers'' note';
  end if;
  perform kofi_test.expect_error($q$select kofi.set_application_status('a3000000-0000-4000-8000-000000000004', 'declined')$q$, '22023', 'status',
    'Works from this selection are lots in the auction. Withdraw or delete the lots first.');
  raise notice 'ok: Lena decides applications to her call only; a selection with live lots cannot be moved';

  -- Reviewer view of the attached works: Priya (pending artist) is shown because she applied.
  if (select count(*) from kofi.call_application_works('a2000000-0000-4000-8000-000000000005')) <> 4
     or not exists (select 1 from kofi.call_application_works('a2000000-0000-4000-8000-000000000005') where id = '30000000-0000-4000-8000-000000000051' and artist_working_name = 'Priya Venkataraman')
     or exists (select 1 from kofi.call_application_works() where can_edit) then
    raise exception 'FAIL: Lena should see the 4 works attached to CMA applications (incl. Priya''s), read-only';
  end if;
  if exists (select 1 from kofi.artworks_visible where id = '30000000-0000-4000-8000-000000000051') then
    raise exception 'FAIL: the reviewer rule must not leak a pending artist''s work into discovery';
  end if;
  if not kofi.storage_image_readable('20000000-0000-4000-8000-000000000005/priya1.jpg') then
    raise exception 'FAIL: Lena should be able to load the photo of a work attached to her call';
  end if;
  if kofi.storage_image_readable('20000000-0000-4000-8000-000000000005/priya2.jpg') then
    raise exception 'FAIL: Lena can load a pending artist''s photo that is not attached to her call';
  end if;
  raise notice 'ok: attached works are shown to the reviewer (applying is consent) with their photos — nothing else of a pending artist';
end $$;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
begin
  if (select staff_note from kofi.applications_visible where id = 'a3000000-0000-4000-8000-000000000004') is not null
     or (select staff_note from kofi.application_labels('a3000000-0000-4000-8000-000000000004')) is not null then
    raise exception 'FAIL: the artist must never read the reviewers'' note';
  end if;
  if exists (select 1 from kofi.call_application_works()) then
    raise exception 'FAIL: an artist gets reviewer works';
  end if;
  raise notice 'ok: Mara sees her CMA application without the reviewers'' note; call_application_works() is empty for her';
end $$;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000007","role":"authenticated"}';
do $$
begin
  if exists (select 1 from kofi.applications_visible) or exists (select 1 from kofi.call_application_works()) then
    raise exception 'FAIL: Owen (pending) sees applications';
  end if;
  perform kofi_test.expect_error($q$select kofi.set_application_status('a3000000-0000-4000-8000-000000000006', 'accepted')$q$, '42501', null, 'Your institution has not been verified yet.');
  if kofi.storage_image_readable('20000000-0000-4000-8000-000000000005/priya1.jpg') then
    raise exception 'FAIL: Owen can load Priya''s photo';
  end if;
  raise notice 'ok: Owen (pending) sees no applications and cannot decide them (Your institution has not been verified yet.)';
end $$;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}';
do $$
begin
  perform kofi_test.expect_error($q$select kofi.set_application_status('a3000000-0000-4000-8000-000000000006', 'accepted')$q$, '42501', null, 'You do not have access to this.');
  raise notice 'ok: an artist cannot decide applications (You do not have access to this.)';
end $$;
rollback;

-- =========================================================== lots: writes ====
begin;
-- A fourth accepted application (June) so the partner can make a new lot.
insert into kofi.applications (id, call_id, artist_id, artwork_ids, statement, status, decided_at)
values ('a3ffffff-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000003',
        array['30000000-0000-4000-8000-000000000031']::uuid[], 'A wall textile for the benefit auction.', 'accepted', now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated"}';
do $$
declare
  v_id uuid;
  base jsonb := '{"callId":"a2000000-0000-4000-8000-000000000005","applicationId":"a3ffffff-0000-4000-8000-000000000001","artworkId":"30000000-0000-4000-8000-000000000031","lotNumber":4,"reserve":50000,"startingBid":40000}';
  sql text := 'select kofi.save_lot(%L::jsonb)';
  r record;
begin
  v_id := kofi.save_lot(base);
  select * into r from kofi.lots_visible where id = v_id;
  if r.status <> 'planned' or r.lot_number <> 4 or r.reserve <> 50000 or r.starting_bid <> 40000 or r.artist_id <> '20000000-0000-4000-8000-000000000003'
     or r.sale is not null or r.payout is not null or r.call_title <> 'Night Weather Benefit Auction' or r.call_kind <> 'auction' or r.artwork_title <> 'Warp / Weft / Wait' then
    raise exception 'FAIL: new lot reads back wrong: %', row_to_json(r);
  end if;
  raise notice 'ok: Lena (organiser) creates lot 4 from June''s selected work: planned, artist from the application, labels in lots_visible';

  perform kofi_test.expect_error(format(sql, base || '{"lotNumber":1}'), '22023', 'artworkId', 'This work is already a lot in this auction.');
  perform kofi_test.expect_error(format(sql, base || '{"artworkId":"30000000-0000-4000-8000-000000000012","applicationId":"a3000000-0000-4000-8000-000000000004","lotNumber":9}'), '22023', 'artworkId', 'This work is already a lot in this auction.');
  perform kofi_test.expect_error(format(sql, jsonb_build_object('id', v_id) || base || '{"lotNumber":1}'), '22023', 'lotNumber', 'Lot 1 is already used in this auction.');
  perform kofi_test.expect_error(format(sql, jsonb_build_object('id', v_id) || base || '{"lotNumber":0}'), '22023', 'lotNumber', 'Lot number must be between 1 and 9999.');
  perform kofi_test.expect_error(format(sql, jsonb_build_object('id', v_id) || base || '{"lotNumber":4.5}'), '22023', 'lotNumber', 'Lot number must be between 1 and 9999.');
  perform kofi_test.expect_error(format(sql, jsonb_build_object('id', v_id) || base || '{"reserve":1.5}'), '22023', 'reserve', 'Enter a whole amount of money, or leave it empty.');
  perform kofi_test.expect_error(format(sql, jsonb_build_object('id', v_id) || base || '{"startingBid":-1}'), '22023', 'startingBid', 'Enter a whole amount of money, or leave it empty.');
  perform kofi_test.expect_error(format(sql, jsonb_build_object('id', v_id) || base || '{"startingBid":60000}'), '22023', 'startingBid', 'The starting bid cannot be above the reserve.');
  perform kofi_test.expect_error(format(sql, base || '{"applicationId":"a3000000-0000-4000-8000-000000000006","artworkId":"30000000-0000-4000-8000-000000000051"}'), '22023', 'applicationId', 'Only selected (accepted) applications can become lots.');
  perform kofi_test.expect_error(format(sql, base || '{"applicationId":"a3000000-0000-4000-8000-000000000001"}'), '22023', 'applicationId', 'That application is for a different call.');
  perform kofi_test.expect_error(format(sql, base || '{"artworkId":"30000000-0000-4000-8000-000000000032"}'), '22023', 'artworkId', 'That work is not on the application.');
  perform kofi_test.expect_error(format(sql, base || '{"applicationId":"a3ffffff-0000-4000-8000-00000000dead"}'), '22023', 'applicationId', 'Choose a selected application.');
  perform kofi_test.expect_error(format(sql, base || '{"artworkId":"3fffffff-0000-4000-8000-000000000000"}'), '22023', 'artworkId', 'That work no longer exists.');
  perform kofi_test.expect_error(format(sql, base || '{"id":"a7ffffff-0000-4000-8000-000000000000"}'), 'P0002', null, 'Lot not found.');
  perform kofi_test.expect_error(format(sql, base || '{"id":"a7000000-0000-4000-8000-000000000001","artworkId":"30000000-0000-4000-8000-000000000011","applicationId":"a3000000-0000-4000-8000-000000000004","lotNumber":1}'), '22023', 'status', 'This lot is sold. Void the sale before editing it.');
  perform kofi_test.expect_error(format(sql, base || '{"callId":"a2000000-0000-4000-8000-000000000002"}'), '42501', null, 'You can only manage calls your institution runs.');
  raise notice 'ok: save_lot() re-runs validateLot() + the mock''s checks with identical messages and fields (duplicate work / number, range, money, starting bid, not selected, wrong call, not on application, unknown, sold, not her call)';

  perform kofi.save_lot(jsonb_build_object('id', v_id) || base || '{"lotNumber":5,"startingBid":null}');
  if (select lot_number from kofi.lots where id = v_id) <> 5 or (select starting_bid from kofi.lots where id = v_id) is not null then
    raise exception 'FAIL: editing a lot should renumber it and clear an empty starting bid';
  end if;
  perform kofi.set_lot_status(v_id, 'live');
  perform kofi_test.expect_error(format($q$select kofi.set_lot_status(%L, 'sold')$q$, v_id), '22023', 'status', 'Record the sale to mark a lot sold.');
  perform kofi_test.expect_error(format($q$select kofi.set_lot_status(%L, 'live')$q$, v_id), '22023', 'status', 'This lot cannot move from live to live.');
  perform kofi_test.expect_error(format($q$select kofi.set_lot_status(%L, 'gone')$q$, v_id), '22023', 'status', 'Unknown status.');
  raise notice 'ok: lots are edited (renumber, clear starting bid) and moved; sold only through record_sale';

  -- --------------------------------------------------- record_sale ---------
  perform kofi_test.expect_error(format($q$select kofi.record_sale(%L, 0, %L, null)$q$, v_id, kofi_test.kofi_today()), '22023', 'hammerPrice', 'Enter the hammer price.');
  perform kofi_test.expect_error(format($q$select kofi.record_sale(%L, 820000.5, %L, null)$q$, v_id, kofi_test.kofi_today()), '22023', 'hammerPrice', 'Enter the hammer price.');
  perform kofi_test.expect_error(format($q$select kofi.record_sale(%L, 49999, %L, null)$q$, v_id, kofi_test.kofi_today()), '22023', 'hammerPrice', 'The hammer price is below the artist' || chr(8217) || 's reserve.');
  perform kofi_test.expect_error(format($q$select kofi.record_sale(%L, 820000, %L, null)$q$, v_id, kofi_test.kofi_today() + 1), '22023', 'soldOn', 'The sale date cannot be in the future.');
  perform kofi_test.expect_error(format($q$select kofi.record_sale(%L, 820000, '18/10/2026', null)$q$, v_id), '22023', 'soldOn', 'Enter the date of the sale.');
  perform kofi_test.expect_error(format($q$select kofi.record_sale(%L, 820000, '2026-02-30', null)$q$, v_id), '22023', 'soldOn', 'Enter the date of the sale.');
  perform kofi_test.expect_error(format($q$select kofi.record_sale(%L, 820000, %L, %L)$q$, v_id, kofi_test.kofi_today(), repeat('p', 161)), '22023', 'buyerRef', 'Keep the buyer reference under 160 characters.');
  raise notice 'ok: record_sale() re-runs validateSale() (hammer, reserve, future / malformed / impossible date, buyer reference)';

  perform kofi.record_sale(v_id, 820000, (kofi_test.kofi_today() - 1)::text, '  Paddle 7  ');
  select * into r from kofi.lots_visible where id = v_id;
  if r.status <> 'sold' or r.sale <> jsonb_build_object(
       'hammerPrice', 820000, 'currency', 'USD', 'buyerPremium', 82000, 'artistAmount', 574000, 'kofiAmount', 164000, 'partnerAmount', 82000,
       'terms', '{"artistSharePct":70,"kofiSharePct":20,"partnerSharePct":10,"buyerPremiumPct":10,"resaleRoyaltyPct":5,"currency":"USD","paymentNote":"Artists are paid within 30 days of the auction."}'::jsonb,
       'soldAt', kofi.js_iso(kofi.kofi_noon(kofi_test.kofi_today() - 1)), 'buyerRef', 'Paddle 7') then
    raise exception 'FAIL: 820000 at 70/20/10 should freeze 574000 / 164000 / 82000 + premium 82000: %', r.sale;
  end if;
  if r.payout is not null then
    raise exception 'FAIL: the organiser must not see the payout';
  end if;
  perform kofi_test.expect_error(format($q$select kofi.record_sale(%L, 820000, %L, null)$q$, v_id, kofi_test.kofi_today()), '22023', 'status', 'This lot is already sold. Void the sale first to record it again.');
  raise notice 'ok: record_sale() freezes splitSale(): 820000 at 70/20/10 → artist 574000, Kofi 164000, partner 82000, premium 82000, sold at noon Kofi time, buyer reference trimmed';

  -- Void the sale: lot reopens as unsold, the payout is kept as void.
  perform kofi.set_lot_status(v_id, 'unsold');
  if (select sale from kofi.lots_visible where id = v_id) is not null or (select status from kofi.lots_visible where id = v_id) <> 'unsold' then
    raise exception 'FAIL: voiding a sale should clear it and leave the lot unsold';
  end if;
  -- Re-sell at an odd amount: rounding is half-up on the artist, then the partner; the remainder is Kofi's.
  perform kofi.save_lot(jsonb_build_object('id', v_id) || base || '{"lotNumber":5,"reserve":null,"startingBid":null}');
  perform kofi.record_sale(v_id, 12345, kofi_test.kofi_today()::text, null);
  select * into r from kofi.lots_visible where id = v_id;
  if (r.sale ->> 'artistAmount')::int <> 8642 or (r.sale ->> 'partnerAmount')::int <> 1235 or (r.sale ->> 'kofiAmount')::int <> 2468
     or (r.sale ->> 'buyerPremium')::int <> 1235 or r.sale ? 'buyerRef' then
    raise exception 'FAIL: 12345 at 70/20/10 should be 8642 / 2468 / 1235 (+1235 premium), no buyer ref: %', r.sale;
  end if;
  raise notice 'ok: void + re-sale: 12345 cents → artist 8642, partner 1235, Kofi 2468 (the remainder), premium 1235 — Math.round half-up';
  -- The report joins only the live payout to the lot's current sale (the voided one is not a payment).
  perform set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}', true);
  if (select count(*) from jsonb_array_elements(kofi.kofi_report((kofi_test.kofi_today() - 30)::text, kofi_test.kofi_today()::text) -> 'payments') e
      where (e ->> 'lotNumber')::int = 5) <> 1
     or not (kofi.kofi_report((kofi_test.kofi_today() - 30)::text, kofi_test.kofi_today()::text) -> 'payments') @> '[{"lotNumber":5,"status":"due","artistAmount":8642,"hammerPrice":12345}]'::jsonb then
    raise exception 'FAIL: the report should show only the re-sale''s due payout for lot 5, never the voided one';
  end if;
  perform set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated"}', true);
  raise notice 'ok: the report never joins a void payout to the lot''s new sale';

  perform kofi_test.expect_error(format($q$select kofi.delete_lot(%L)$q$, v_id), '22023', 'status', 'This lot has a sale on record, so it cannot be deleted. Withdraw it instead.');
  perform kofi.set_lot_status(v_id, 'unsold');
  perform kofi_test.expect_error(format($q$select kofi.delete_lot(%L)$q$, v_id), '22023', 'status', 'This lot has a sale on record, so it cannot be deleted. Withdraw it instead.');
  perform kofi.set_lot_status(v_id, 'withdrawn');
  perform kofi_test.expect_error(format($q$select kofi.record_sale(%L, 50000, %L, null)$q$, v_id, kofi_test.kofi_today()), '22023', 'status', 'A withdrawn lot cannot be sold.');
  declare
    v_six uuid := kofi.save_lot(base || '{"lotNumber":6}');
  begin
    perform kofi_test.expect_error(format($q$select kofi.set_lot_status(%L, 'planned')$q$, v_id), '22023', 'artworkId', 'This work is already a lot in this auction.');
    perform kofi.delete_lot(v_six);
    if exists (select 1 from kofi.lots where id = v_six) then
      raise exception 'FAIL: a never-sold lot should be deleted';
    end if;
    perform kofi.set_lot_status(v_id, 'planned');
  end;
  raise notice 'ok: a lot with a sale on record (even voided) cannot be deleted, only withdrawn; withdrawn lots free the work; reinstating re-checks validateLot(); a never-sold lot is deleted';
end $$;
reset role;
do $$
declare
  v_lot text := (select id::text from kofi.lots where lot_number = 5 and call_id = 'a2000000-0000-4000-8000-000000000005');
begin
  if (select count(*) from kofi.payouts where lot_id::text = v_lot) <> 2
     or (select count(*) from kofi.payouts where lot_id::text = v_lot and status = 'void' and amount = 574000) <> 1
     or (select count(*) from kofi.payouts where lot_id::text = v_lot and status = 'void' and amount = 8642) <> 1
     or exists (select 1 from kofi.payouts where lot_id::text = v_lot and artist_id <> '20000000-0000-4000-8000-000000000003') then
    raise exception 'FAIL: each sale should create a due payout for June that the void turns into void (2 kept for the record)';
  end if;
  if (select count(*) from kofi.audit_events where entity_type = 'lot' and action = 'lot.save' and actor_id = '10000000-0000-4000-8000-000000000006' and actor_role = 'curator') < 7
     or (select count(*) from kofi.audit_events where action = 'lot.sale' and entity_id = v_lot and meta ? 'hammer') <> 2
     or (select count(*) from kofi.audit_events where action = 'lot.sale' and entity_id = v_lot and meta @> '{"voided":true}') <> 2
     or (select count(*) from kofi.audit_events where action = 'payout.status' and meta @> '{"status":"void"}' and actor_role = 'curator') <> 2
     or (select count(*) from kofi.audit_events where action = 'lot.delete' and actor_id = '10000000-0000-4000-8000-000000000006') <> 1 then
    raise exception 'FAIL: lot.save / lot.sale / payout.status / lot.delete not audited as expected';
  end if;
  if not exists (select 1 from kofi.audit_events where action = 'lot.sale' and entity_id = v_lot and meta = '{"hammer":820000,"currency":"USD","lotNumber":5}'::jsonb)
     or exists (select 1 from kofi.audit_events where action like 'lot.%' and meta::text like '%Paddle%') then
    raise exception 'FAIL: lot.sale meta should be {hammer, currency, lotNumber} and never the buyer reference';
  end if;
  raise notice 'ok: every lot write audited (actor role curator); lot.sale meta = hammer / currency / lotNumber, never the buyer reference';
end $$;
rollback;

-- ======================================================= lots: status matrix ==
-- Every (from, to) pair except from = sold (covered above) must match canMoveLot().
begin;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$
declare
  f kofi.lot_status;
  t kofi.lot_status;
  allowed boolean;
  moved boolean;
  pairs integer := 0;
begin
  foreach f in array array['planned', 'live', 'unsold', 'withdrawn']::kofi.lot_status[] loop
    foreach t in array enum_range(null::kofi.lot_status) loop
      execute 'reset role';
      update kofi.lots set status = f where id = 'a7000000-0000-4000-8000-000000000002';
      execute 'set local role authenticated';
      allowed := f <> t and t <> 'sold' and (case when f = 'withdrawn' then t = 'planned' else t in ('live', 'unsold', 'withdrawn', 'planned') end);
      begin
        perform kofi.set_lot_status('a7000000-0000-4000-8000-000000000002', t::text);
        moved := true;
      exception when invalid_parameter_value then
        moved := false;
      end;
      if moved <> allowed then
        raise exception 'FAIL: lot % → %: expected %, got %', f, t, case when allowed then 'allowed' else 'refused' end, case when moved then 'allowed' else 'refused' end;
      end if;
      pairs := pairs + 1;
    end loop;
  end loop;
  raise notice 'ok: set_lot_status() follows canMoveLot() for all % (from, to) pairs from planned / live / unsold / withdrawn', pairs;
  perform kofi_test.expect_error($q$select kofi.set_lot_status('a7000000-0000-4000-8000-000000000003', 'unsold')$q$, '22023', 'status', 'Payout already paid.');
  perform kofi_test.expect_error($q$select kofi.set_lot_status('a7000000-0000-4000-8000-000000000001', 'live')$q$, '22023', 'status', 'This lot cannot move from sold to live.');
  perform kofi_test.expect_error($q$select kofi.set_lot_status('a7ffffff-0000-4000-8000-000000000000', 'live')$q$, 'P0002', null, 'Lot not found.');
  raise notice 'ok: a sold lot whose payout is paid cannot be voided (Payout already paid.); sold only moves to unsold';
end $$;
rollback;

-- ============================================================== payouts ======
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$
declare
  p constant uuid := 'a8000000-0000-4000-8000-000000000001';
  sql text := 'select kofi.set_payout_status(%L, %L, %L, %L, %L, %L)';
  r record;
begin
  perform kofi_test.expect_error(format(sql, p, 'paid', null, null, null, null), '22023', 'method', 'Say how the artist was paid.');
  perform kofi_test.expect_error(format(sql, p, 'paid', '   ', null, null, null), '22023', 'method', 'Say how the artist was paid.');
  perform kofi_test.expect_error(format(sql, p, 'paid', repeat('m', 81), null, null, null), '22023', 'method', 'Keep the payment method under 80 characters.');
  perform kofi_test.expect_error(format(sql, p, 'paid', 'Check', repeat('r', 121), null, null), '22023', 'reference', 'Keep the reference under 120 characters.');
  perform kofi_test.expect_error(format(sql, p, 'paid', 'Check', null, repeat('n', 2001), null), '22023', 'note', 'Keep the note under 2000 characters.');
  perform kofi_test.expect_error(format(sql, p, 'paid', 'Check', null, null, kofi_test.kofi_today() + 1), '22023', 'paidOn', 'The payment date cannot be in the future.');
  perform kofi_test.expect_error(format(sql, p, 'paid', 'Check', null, null, '2026-13-01'), '22023', 'paidOn', 'Payment date must be a valid date.');
  perform kofi_test.expect_error(format(sql, p, 'bogus', null, null, null, null), '22023', 'status', 'Unknown status.');
  perform kofi_test.expect_error(format(sql, p, 'due', null, null, null, null), '22023', 'status', 'This payout cannot move from due to due.');
  perform kofi_test.expect_error(format(sql, 'a8000000-0000-4000-8000-000000000003', 'void', null, null, null, null), '22023', 'status', 'This payout cannot move from paid to void.');
  perform kofi_test.expect_error(format(sql, 'a8ffffff-0000-4000-8000-000000000000', 'paid', 'x', null, null, null), 'P0002', null, 'Payout not found.');
  raise notice 'ok: set_payout_status() rules — method required (<= 80), reference <= 120, note <= 2000, paid day valid and not in the future, canMovePayout(); a paid payout cannot be voided';

  perform kofi.set_payout_status(p, 'paid', ' Check #1042 ', ' KC-2026-0032 ', ' Posted Monday. ', (kofi_test.kofi_today() - 1)::text);
  select * into r from kofi.payouts_visible where id = p;
  if r.status <> 'paid' or r.method <> 'Check #1042' or r.reference <> 'KC-2026-0032' or r.note <> 'Posted Monday.'
     or r.paid_at <> kofi.kofi_noon(kofi_test.kofi_today() - 1) or r.artist_working_name <> 'Mara Oyelaran' or r.lot_number <> 1
     or r.artwork_title is null or r.call_title <> 'Night Weather Benefit Auction' then
    raise exception 'FAIL: paid payout reads back wrong: %', row_to_json(r);
  end if;
  perform kofi.set_payout_status(p, 'due');
  select * into r from kofi.payouts_visible where id = p;
  if r.status <> 'due' or r.method is not null or r.reference is not null or r.paid_at is not null or r.note <> 'Posted Monday.' then
    raise exception 'FAIL: paid → due (correction) should clear method / reference / paid day and keep the note: %', row_to_json(r);
  end if;
  perform kofi.set_payout_status(p, 'paid', 'Bank transfer', null, '', null);
  if (select kofi.kofi_day(paid_at) from kofi.payouts where id = p) <> kofi_test.kofi_today() or (select note from kofi.payouts where id = p) is not null then
    raise exception 'FAIL: the payment day should default to today (noon Kofi time) and an empty note should clear it';
  end if;
  raise notice 'ok: Kofi marks a payout paid (method, reference, note, day → noon Kofi time), corrects it back to due, pays it again with today''s date';

  -- void → due only while the lot is sold and has no other live payout.
  perform kofi.set_payout_status('a8000000-0000-4000-8000-000000000001', 'due');
  perform kofi.set_lot_status('a7000000-0000-4000-8000-000000000001', 'unsold');
  if (select status from kofi.payouts where id = p) <> 'void' then
    raise exception 'FAIL: voiding the sale should void its due payout';
  end if;
  perform kofi_test.expect_error(format(sql, p, 'due', null, null, null, null), '22023', 'status', 'This sale was voided. Record the sale again instead.');
  raise notice 'ok: voiding a sale voids its payout; a void payout cannot come back while the sale is void';
end $$;
reset role;
do $$
begin
  if (select count(*) from kofi.audit_events where action = 'payout.status' and actor_id = '10000000-0000-4000-8000-000000000008') <> 5
     or not exists (select 1 from kofi.audit_events where action = 'payout.status' and meta @> '{"status":"paid","method":"Check #1042"}') then
    raise exception 'FAIL: payout.status changes should be audited (with the method when paid)';
  end if;
  raise notice 'ok: payout.status audited for every move, with the method when paid';
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated"}';
do $$
begin
  perform kofi_test.expect_error($q$select kofi.set_payout_status('a8000000-0000-4000-8000-000000000003', 'due')$q$, '42501', null, 'Kofi staff only.');
  raise notice 'ok: the organiser cannot change payouts (Kofi staff only.)';
end $$;
rollback;

-- ======================================================= who sees which lot ===
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare
  r record;
begin
  if (select count(*) from kofi.lots_visible) <> 2 or exists (select 1 from kofi.lots_visible where artist_id <> '20000000-0000-4000-8000-000000000001') then
    raise exception 'FAIL: Mara should see exactly her two lots';
  end if;
  select * into r from kofi.lots_visible where id = 'a7000000-0000-4000-8000-000000000001';
  if r.sale is null or r.sale ? 'buyerRef' or (r.sale ->> 'artistAmount')::int <> 574000 or r.payout ->> 'status' <> 'due' or (r.payout ->> 'amount')::int <> 574000 then
    raise exception 'FAIL: Mara should see her sale without the buyer reference, and her due payout: %', row_to_json(r);
  end if;
  if exists (select 1 from kofi.lot_extras('a7000000-0000-4000-8000-000000000001') where sale ? 'buyerRef')
     or exists (select 1 from kofi.lot_extras('a7000000-0000-4000-8000-000000000003')) then
    raise exception 'FAIL: lot_extras() leaks the buyer reference or another artist''s lot to Mara';
  end if;
  perform kofi_test.expect_error($q$select sale from kofi.lots$q$, '42501');
  if (select count(*) from kofi.payouts_visible) <> 1 or (select count(*) from kofi.payouts) <> 1 or (select artist_id from kofi.payouts) <> '20000000-0000-4000-8000-000000000001' then
    raise exception 'FAIL: Mara should see only her own payout';
  end if;
  perform kofi_test.expect_error($q$update kofi.payouts set status = 'paid'$q$, '42501');
  perform kofi_test.expect_error($q$insert into kofi.lots (call_id, application_id, artwork_id, artist_id, lot_number) values ('a2000000-0000-4000-8000-000000000005', 'a3000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000013', '20000000-0000-4000-8000-000000000001', 99)$q$, '42501');
  perform kofi_test.expect_error($q$select kofi.save_lot('{"callId":"a2000000-0000-4000-8000-000000000005"}')$q$, '42501', null, 'You do not have access to this.');
  perform kofi_test.expect_error($q$select kofi.kofi_report('2026-10-01', '2026-10-31')$q$, '42501', null, 'Kofi staff only.');
  raise notice 'ok: Mara sees her own lots (sale without buyer reference, her payout) and payout only; no raw sale column, no writes, no lot RPCs, no report';
end $$;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}';
do $$
begin
  if (select count(*) from kofi.lots_visible) <> 1
     or (select payout ->> 'status' from kofi.lots_visible where id = 'a7000000-0000-4000-8000-000000000003') <> 'paid'
     or (select (payout ->> 'paid_at')::timestamptz from kofi.lots_visible) <> '2026-10-19T16:00:00Z' then
    raise exception 'FAIL: DeShawn should see his one lot with the paid payout';
  end if;
  raise notice 'ok: DeShawn sees his sold lot with the paid payout (Oct 19)';
end $$;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated"}';
do $$
begin
  if (select count(*) from kofi.lots_visible) <> 3 or exists (select 1 from kofi.lots_visible where payout is not null)
     or (select sale ->> 'buyerRef' from kofi.lots_visible where id = 'a7000000-0000-4000-8000-000000000001') <> 'Paddle 14' then
    raise exception 'FAIL: the organiser should see the 3 lots with the buyer reference and no payout';
  end if;
  if exists (select 1 from kofi.payouts) or exists (select 1 from kofi.payouts_visible) or exists (select 1 from kofi.payout_labels('a8000000-0000-4000-8000-000000000001')) then
    raise exception 'FAIL: the organiser sees payouts';
  end if;
  perform kofi_test.expect_error($q$select kofi.kofi_report('2026-10-01', '2026-10-31')$q$, '42501', null, 'Kofi staff only.');
  raise notice 'ok: Lena (organiser) sees the 3 lots of her auction with buyer references, and no payouts at all; no report';
end $$;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000007","role":"authenticated"}';
do $$
begin
  if exists (select 1 from kofi.lots_visible) or exists (select 1 from kofi.lots) or exists (select 1 from kofi.payouts_visible) then
    raise exception 'FAIL: Owen (pending) sees lots or payouts';
  end if;
  perform kofi_test.expect_error($q$select kofi.save_lot('{"callId":"a2000000-0000-4000-8000-000000000005"}')$q$, '42501', null, 'Your institution has not been verified yet.');
  perform kofi_test.expect_error($q$select kofi.record_sale('a7000000-0000-4000-8000-000000000002', 100000, '2026-10-18', null)$q$, '42501', null, 'Your institution has not been verified yet.');
  perform kofi_test.expect_error($q$select kofi.set_lot_status('a7000000-0000-4000-8000-000000000002', 'unsold')$q$, '42501', null, 'Your institution has not been verified yet.');
  perform kofi_test.expect_error($q$select kofi.delete_lot('a7000000-0000-4000-8000-000000000002')$q$, '42501', null, 'Your institution has not been verified yet.');
  perform kofi_test.expect_error($q$select kofi.set_payout_status('a8000000-0000-4000-8000-000000000001', 'paid', 'x')$q$, '42501', null, 'Kofi staff only.');
  perform kofi_test.expect_error($q$select kofi.kofi_report('2026-10-01', '2026-10-31')$q$, '42501', null, 'Kofi staff only.');
  raise notice 'ok: Owen (pending curator) is forbidden everywhere: no lots, payouts, lot RPCs, payout RPC or report';
end $$;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$
begin
  if (select count(*) from kofi.lots_visible where payout is not null) <> 2 or (select count(*) from kofi.payouts_visible) <> 2
     or (select sale ->> 'buyerRef' from kofi.lots_visible where id = 'a7000000-0000-4000-8000-000000000003') <> 'Paddle 3' then
    raise exception 'FAIL: Kofi should see every lot with buyer references and payouts';
  end if;
  raise notice 'ok: Kofi sees all lots (buyer references, payouts) and all payouts';
end $$;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
begin
  perform kofi_test.expect_error($q$select 1 from kofi.lots_visible$q$, '42501');
  perform kofi_test.expect_error($q$select 1 from kofi.lots$q$, '42501');
  perform kofi_test.expect_error($q$select 1 from kofi.payouts_visible$q$, '42501');
  perform kofi_test.expect_error($q$select kofi.save_lot('{}')$q$, '42501');
  perform kofi_test.expect_error($q$select kofi.kofi_report('2026-10-01', '2026-10-31')$q$, '42501');
  perform kofi_test.expect_error($q$select * from kofi.call_application_works()$q$, '42501');
  raise notice 'ok: visitors have no access to lots, payouts or the sales RPCs';
end $$;
rollback;

-- =============================================================== report ======
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$
declare
  rep jsonb;
  sql text := 'select kofi.kofi_report(%L, %L)';
begin
  rep := kofi.kofi_report('2026-10-01', '2026-10-31');
  if jsonb_array_length(rep -> 'payments') <> 2 then
    raise exception 'FAIL: October 2026 should have 2 payments, got %', rep -> 'payments';
  end if;
  if not (rep -> 'payments') @> '[{"payoutId":"a8000000-0000-4000-8000-000000000003","artistId":"20000000-0000-4000-8000-000000000004","lotNumber":3,"hammerPrice":160000,"artistAmount":112000,"kofiAmount":32000,"partnerAmount":16000,"buyerPremium":16000,"currency":"USD","status":"paid","soldOn":"2026-10-18","paidOn":"2026-10-19","method":"Bank transfer","reference":"KC-2026-0031","callTitle":"Night Weather Benefit Auction"}]'::jsonb
     or not (rep -> 'payments') @> '[{"payoutId":"a8000000-0000-4000-8000-000000000001","artistId":"20000000-0000-4000-8000-000000000001","artistWorkingName":"Mara Oyelaran","lotNumber":1,"hammerPrice":820000,"artistAmount":574000,"kofiAmount":164000,"partnerAmount":82000,"buyerPremium":82000,"status":"due","soldOn":"2026-10-18"}]'::jsonb
     or exists (select 1 from jsonb_array_elements(rep -> 'payments') e where e ->> 'payoutId' = 'a8000000-0000-4000-8000-000000000001' and (e ? 'paidOn' or e ? 'method')) then
    raise exception 'FAIL: October payments rows are wrong: %', rep -> 'payments';
  end if;
  raise notice 'ok: kofi_report(Oct 2026) → 2 payments: DeShawn lot 3 paid Oct 19 (Bank transfer, KC-2026-0031), Mara lot 1 due 574000 (no paid fields)';

  if jsonb_array_length(rep -> 'participation') <> 1
     or rep -> 'participation' -> 0 <> '{"artistId":"20000000-0000-4000-8000-000000000004","artistWorkingName":"DeShawn Ferris","callId":"a2000000-0000-4000-8000-000000000002","callTitle":"Night Weather Studio Award","callKind":"award","organizer":"Kofi Collections","applicationId":"a3000000-0000-4000-8000-000000000003","status":"submitted","worksAttached":2,"submittedOn":"2026-10-11"}'::jsonb then
    raise exception 'FAIL: October participation should be DeShawn''s Night Weather application (submitted Oct 11 Kofi time): %', rep -> 'participation';
  end if;
  raise notice 'ok: participation counts the Kofi day (02:15Z on Oct 12 is Oct 11 in Pittsburgh); organiser falls back to the partner text';

  if jsonb_array_length(rep -> 'placements') <> 13
     or (select count(*) from jsonb_array_elements(rep -> 'placements') e where e ->> 'kind' = 'exhibition') <> 5
     or (select count(*) from jsonb_array_elements(rep -> 'placements') e where e ->> 'kind' = 'selection' and e ->> 'on' = '2026-10-05') <> 3
     or (select count(*) from jsonb_array_elements(rep -> 'placements') e where e ->> 'kind' = 'lot' and e ->> 'on' = '2026-10-08') <> 3
     or (select count(*) from jsonb_array_elements(rep -> 'placements') e where e ->> 'kind' = 'sale' and e ->> 'on' = '2026-10-18' and e ? 'amount' and e ->> 'currency' = 'USD') <> 2
     or rep -> 'placements' -> 0 ->> 'on' <> '2026-10-18' then
    raise exception 'FAIL: October placements should be 5 exhibition + 3 selection + 3 lot + 2 sale, newest first: %', rep -> 'placements';
  end if;
  raise notice 'ok: placements — Night Weather (5 works), CMA selections (3), lots (3), sales (2 with hammer + currency), newest first';

  rep := kofi.kofi_report('2026-09-01', '2026-09-30');
  if jsonb_array_length(rep -> 'payments') <> 0 or jsonb_array_length(rep -> 'participation') <> 5
     or not (rep -> 'participation') @> '[{"applicationId":"a3000000-0000-4000-8000-000000000004","organizer":"Carnegie Museum of Art","callKind":"auction","decidedOn":"2026-10-05"}]'::jsonb then
    raise exception 'FAIL: September should have the 5 applications (CMA ones organised by Carnegie Museum of Art) and no payments: %', rep;
  end if;
  raise notice 'ok: September — 5 applications, the CMA ones attributed to Carnegie Museum of Art (organiser institution), no payments';

  perform kofi_test.expect_error(format(sql, '2026-10-31', '2026-10-01'), '22023', 'range', 'The start date must be before the end date.');
  perform kofi_test.expect_error(format(sql, kofi_test.kofi_today() + 1, kofi_test.kofi_today() + 2), '22023', 'range', 'The start date is in the future.');
  perform kofi_test.expect_error(format(sql, '2026-10', '2026-10-31'), '22023', 'range', 'Pick a start and end date.');
  perform kofi_test.expect_error(format(sql, null, '2026-10-31'), '22023', 'range', 'Pick a start and end date.');
  raise notice 'ok: validateRange() server-side (order, future start, format)';
end $$;
reset role;
do $$
begin
  if (select count(*) from kofi.audit_events where action = 'report.export' and entity_type = 'report' and actor_id = '10000000-0000-4000-8000-000000000008') <> 2
     or not exists (select 1 from kofi.audit_events where action = 'report.export' and entity_id = '2026-10-01_2026-10-31' and meta = '{"from":"2026-10-01","to":"2026-10-31"}'::jsonb) then
    raise exception 'FAIL: report.export should be audited once per report with {from, to}';
  end if;
  raise notice 'ok: report.export audited with {from, to}; refused ranges are not audited';
end $$;
rollback;

-- ============================================================== storage ======
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated"}';
do $$
begin
  insert into storage.objects (bucket_id, name) values ('kofi-programme', 'open-calls/cma-spring.jpg');
  perform kofi_test.expect_error($q$insert into storage.objects (bucket_id, name) values ('kofi-programme', 'exhibitions/cma.jpg')$q$, '42501');
  delete from storage.objects where bucket_id = 'kofi-programme';
  raise notice 'ok: a partner may add a call image under kofi-programme/open-calls/ only, and cannot delete';
end $$;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000007","role":"authenticated"}';
do $$
begin
  perform kofi_test.expect_error($q$insert into storage.objects (bucket_id, name) values ('kofi-programme', 'open-calls/owen.jpg')$q$, '42501');
  raise notice 'ok: a pending curator cannot upload programme images';
end $$;
reset role;
do $$
begin
  if (select count(*) from storage.objects where bucket_id = 'kofi-programme' and name = 'open-calls/cma-spring.jpg') <> 1 then
    raise exception 'FAIL: the partner upload should be there and survive her delete attempt';
  end if;
end $$;
rollback;

-- ======================================================== demo reset ========
begin;
delete from kofi.payouts where id = 'a8000000-0000-4000-8000-000000000001';
update kofi.lots set status = 'withdrawn' where id = 'a7000000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$ begin perform kofi.kofi_demo_reset(); end $$;
reset role;
do $$
begin
  if (select count(*) from kofi.payouts) <> 2 or (select status from kofi.lots where id = 'a7000000-0000-4000-8000-000000000002') <> 'live'
     or (select count(*) from kofi.applications) <> 6 or (select count(*) from kofi.open_calls) <> 5 then
    raise exception 'FAIL: kofi_demo_reset() did not restore lots / payouts';
  end if;
  raise notice 'ok: kofi_demo_reset() restores lots and payouts too';
end $$;
rollback;

-- ============================================== isolation of new objects ====
do $$
declare
  n integer;
begin
  select count(*) into n from pg_class c
  where c.relname in ('lots', 'payouts', 'lots_visible', 'payouts_visible')
    and c.relnamespace <> 'kofi'::regnamespace and c.relnamespace::regnamespace::text not like 'pg_%';
  if n <> 0 then
    raise exception 'FAIL: % sales relation(s) exist outside schema kofi', n;
  end if;
  select count(*) into n from pg_type t where t.typname in ('call_kind', 'lot_status', 'payout_status') and t.typnamespace <> 'kofi'::regnamespace;
  if n <> 0 then
    raise exception 'FAIL: % sales enum(s) outside schema kofi', n;
  end if;
  select count(*) into n from pg_proc p
  where p.proname in ('call_terms_problem', 'call_terms_ok', 'kofi_day', 'kofi_today', 'kofi_noon', 'js_iso', 'iso_date_ok', 'json_int', 'try_uuid',
                      'my_verified_institution_id', 'is_call_organizer', 'require_organiser', 'organiser_sees_artwork', 'open_calls_sales_guard',
                      'lot_extras', 'payout_labels', 'call_application_works', 'require_call_manager', 'require_lot',
                      'save_lot', 'set_lot_status', 'record_sale', 'delete_lot', 'set_payout_status', 'kofi_report')
    and p.pronamespace not in ('kofi'::regnamespace, 'kofi_test'::regnamespace);
  if n <> 0 then
    raise exception 'FAIL: % sales function(s) outside schema kofi', n;
  end if;
  raise notice 'ok: every 0009 table, view, enum and function is in schema kofi';

  if (select fp from kofi_test.baseline) is distinct from kofi_test.public_fingerprint() then
    raise exception 'FAIL: schema public changed (objects, grants, policies, triggers or the other product''s rows)';
  end if;
  raise notice 'ok: public fingerprint still identical after 0009 + sales seed + every sales test';

  if exists (select 1 from pg_policies where schemaname = 'storage' and policyname not like 'kofi %')
     or (select count(*) from pg_policies where schemaname = 'storage' and policyname like 'kofi programme %') <> 5
     or not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'kofi programme partner insert') then
    raise exception 'FAIL: storage policies should be the 4 admin "kofi programme …" policies + "kofi programme partner insert"';
  end if;
  if (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'kofi' and tablename in ('lots', 'payouts')) <> 2 then
    raise exception 'FAIL: lots and payouts should be in supabase_realtime';
  end if;
  raise notice 'ok: storage addition is one namespaced "kofi programme partner insert" policy; lots + payouts in realtime';

  if has_table_privilege('anon', 'kofi.lots', 'select') or has_table_privilege('anon', 'kofi.payouts', 'select')
     or has_table_privilege('anon', 'kofi.lots_visible', 'select') or has_table_privilege('anon', 'kofi.payouts_visible', 'select')
     or has_column_privilege('authenticated', 'kofi.lots', 'sale', 'select')
     or not has_column_privilege('authenticated', 'kofi.lots', 'reserve', 'select')
     or has_table_privilege('authenticated', 'kofi.lots', 'insert') or has_table_privilege('authenticated', 'kofi.lots', 'update') or has_table_privilege('authenticated', 'kofi.lots', 'delete')
     or has_table_privilege('authenticated', 'kofi.payouts', 'insert') or has_table_privilege('authenticated', 'kofi.payouts', 'update') or has_table_privilege('authenticated', 'kofi.payouts', 'delete')
     or has_function_privilege('anon', 'kofi.save_lot(jsonb)', 'execute')
     or has_function_privilege('anon', 'kofi.record_sale(uuid, numeric, text, text)', 'execute')
     or has_function_privilege('anon', 'kofi.set_payout_status(uuid, text, text, text, text, text)', 'execute')
     or has_function_privilege('anon', 'kofi.kofi_report(text, text)', 'execute')
     or has_function_privilege('anon', 'kofi.call_application_works(uuid)', 'execute')
     or has_function_privilege('authenticated', 'kofi.require_lot(uuid)', 'execute')
     or has_function_privilege('authenticated', 'kofi.require_call_manager(uuid)', 'execute')
     or has_function_privilege('authenticated', 'kofi.open_calls_sales_guard()', 'execute')
     or not has_function_privilege('authenticated', 'kofi.set_lot_status(uuid, text)', 'execute')
     or not has_column_privilege('anon', 'kofi.open_calls', 'terms', 'select')
     or has_column_privilege('anon', 'kofi.open_calls', 'terms', 'update')
     or not has_column_privilege('authenticated', 'kofi.open_calls', 'organizer_institution_id', 'insert') then
    raise exception 'FAIL: a sales privilege is wider (or narrower) than designed';
  end if;
  raise notice 'ok: least-privilege grants — no anon access to lots / payouts / sales RPCs, lots.sale not selectable, no direct lot / payout writes, internal guards not callable';

  if not exists (select 1 from kofi.applied_migrations where name = '0009_sales') then
    raise exception 'FAIL: 0009_sales not recorded in kofi.applied_migrations';
  end if;
  raise notice 'ok: 0009_sales recorded in kofi.applied_migrations';
end $$;

drop function kofi_test.expect_error(text, text, text, text);
drop function kofi_test.kofi_today();
revoke usage on schema kofi_test from anon, authenticated;

\echo 'sales_test.sql: all assertions passed'
