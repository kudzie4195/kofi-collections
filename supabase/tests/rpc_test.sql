-- =============================================================================
-- Kofi Collections — RPC + audit-trigger assertions (companion to rls_test.sql)
-- Same conventions: each block impersonates a demo user, runs in its own
-- transaction and rolls back; RAISE EXCEPTION on failure, NOTICE 'ok: …' on success.
-- =============================================================================

\set ON_ERROR_STOP on
\set QUIET on

-- ------------------------------------------------------------- whoami -------
begin;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
begin
  if (select role from public.whoami()) <> 'public' or (select user_id from public.whoami()) is not null then
    raise exception 'FAIL: whoami() for a visitor should be role public with no user';
  end if;
  raise notice 'ok: whoami() — visitor';
  begin
    perform public.save_artwork('{}'::jsonb, '[]'::jsonb);
    raise exception 'FAIL: visitor could call save_artwork';
  exception when insufficient_privilege then
    raise notice 'ok: mutating RPCs are not executable by anon (%)', sqlerrm;
  end;
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated"}';
do $$
declare w record;
begin
  select * into w from public.whoami();
  if w.role <> 'curator' or w.curator_id <> '50000000-0000-4000-8000-000000000001' or not w.curator_verified or w.display_name <> 'Lena Marchetti' then
    raise exception 'FAIL: whoami() for Lena is wrong: %', row_to_json(w);
  end if;
  raise notice 'ok: whoami() — Lena is a verified curator';
  if public.describe_access('shortlist', '60000000-0000-4000-8000-000000000001') <> 'owner'
     or public.describe_access('shortlist', gen_random_uuid()) <> 'not_found'
     or public.describe_access('artwork', '30000000-0000-4000-8000-000000000011') <> 'other' then
    raise exception 'FAIL: describe_access() answers are wrong for Lena';
  end if;
  raise notice 'ok: describe_access() distinguishes owner / other / not_found';
end $$;
rollback;

-- -------------------------------------------------------- save_artwork ------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare
  v_id uuid;
  v_hint text;
  v_art jsonb := '{"title":"Night Bus","year":2026,"medium":"painting","materials":["oil on panel"],
                   "dimensions":{"height":40,"width":30,"unit":"cm"},"description":"Test work.","status":"available",
                   "rightsNote":"© Mara Oyelaran.","price":{"amount":1200,"currency":"USD"},
                   "priceVisibility":"institutions","visibility":"public","tags":["night"]}';
begin
  begin
    perform public.save_artwork(v_art, '[]'::jsonb);
    raise exception 'FAIL: published a work with no images';
  exception when invalid_parameter_value then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint <> 'images' then raise exception 'FAIL: expected hint images, got %', v_hint; end if;
    raise notice 'ok: save_artwork() refuses to publish without images (%; field %)', sqlerrm, v_hint;
  end;
  v_id := public.save_artwork(v_art, '[{"src":"data:image/jpeg;base64,AAAA","alt":"Night bus","isPrimary":true,"metadataStripped":true}]');
  if not exists (select 1 from public.artworks_visible where id = v_id and price_amount = 1200 and jsonb_array_length(images) = 1) then
    raise exception 'FAIL: new artwork not readable by its owner with price and image';
  end if;
  raise notice 'ok: save_artwork() creates a work with its image (%)', v_id;

  perform public.save_artwork(
    v_art || jsonb_build_object('id', v_id, 'title', 'Night Bus (revised)', 'visibility', 'private'),
    '[{"src":"data:image/jpeg;base64,BBBB","alt":"second"},{"src":"data:image/jpeg;base64,CCCC","alt":"third"}]');
  if (select title from public.artworks where id = v_id) <> 'Night Bus (revised)'
     or (select count(*) from public.artwork_images where artwork_id = v_id) <> 2 then
    raise exception 'FAIL: save_artwork() update did not replace fields/images';
  end if;
  raise notice 'ok: save_artwork() updates fields and replaces the image list';

  begin
    perform public.save_artwork(v_art || '{"id":"30000000-0000-4000-8000-000000000011","dimensions":{"height":0,"width":30,"unit":"cm"}}',
      '[{"id":"31000000-0000-4000-8000-000000000011","src":"data:image/svg+xml,x"}]');
    raise exception 'FAIL: zero height accepted';
  exception when check_violation then
    raise notice 'ok: server rejects zero dimensions (constraint %)', (regexp_match(sqlerrm, '"([a-z_]+)"$'))[1];
  end;
  begin
    perform public.save_artwork(v_art, '[{"src":"storage:artwork-images/20000000-0000-4000-8000-000000000003/x.jpg"}]');
    raise exception 'FAIL: Mara linked June''s storage object';
  exception when insufficient_privilege then
    raise notice 'ok: save_artwork() cannot reference another artist''s storage folder';
  end;
end $$;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}';
do $$
begin
  begin
    perform public.save_artwork('{"id":"30000000-0000-4000-8000-000000000011","title":"x"}', '[]');
    raise exception 'FAIL: June saved over Mara''s work';
  exception when insufficient_privilege then
    raise notice 'ok: June cannot save over Mara''s work (%)', sqlerrm;
  end;
  begin
    perform public.save_artwork('{"id":"3fffffff-0000-4000-8000-000000000000","title":"x"}', '[]');
    raise exception 'FAIL: unknown id accepted';
  exception when no_data_found then
    raise notice 'ok: unknown artwork id is NotFound (%)', sqlerrm;
  end;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.audit_events where actor_id = '10000000-0000-4000-8000-000000000001' and action in ('artwork.create', 'artwork.visibility')) <> 2 then
    raise exception 'FAIL: expected one artwork.create and one artwork.visibility event for Mara';
  end if;
  raise notice 'ok: artwork create / visibility change audited by trigger';
end $$;
rollback;

-- --------------------------------------------- consent / submit / export ----
begin;
update public.artists set consent_version = null, consent_accepted_at = null, status = 'draft'
where id = '20000000-0000-4000-8000-000000000003';
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}';
do $$
declare v_hint text; v_export jsonb;
begin
  begin
    perform public.submit_for_review();
    raise exception 'FAIL: submitted without consent';
  exception when invalid_parameter_value then
    get stacked diagnostics v_hint = pg_exception_hint;
    raise notice 'ok: submit_for_review() requires consent (%; field %)', sqlerrm, v_hint;
  end;
  perform public.accept_consent('2026-10-v1');
  perform public.submit_for_review();
  if (select status from public.artists_visible where id = '20000000-0000-4000-8000-000000000003') <> 'pending' then
    raise exception 'FAIL: June should be pending after submitting';
  end if;
  raise notice 'ok: accept_consent() then submit_for_review() → pending';
  v_export := public.export_my_data();
  if jsonb_array_length(v_export -> 'artworks') <> 3 or v_export #>> '{artist,contact_email}' <> 'june@example.com' then
    raise exception 'FAIL: export_my_data() content wrong';
  end if;
  raise notice 'ok: export_my_data() returns the artist''s full record and 3 works';
end $$;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare v_export jsonb;
begin
  v_export := public.export_my_data();
  if jsonb_array_length(v_export -> 'documents') <> 2 or exists (select 1 from jsonb_array_elements(v_export -> 'documents') d where d ? 'file_ref') then
    raise exception 'FAIL: export documents should be 2 rows without file_ref';
  end if;
  raise notice 'ok: export_my_data() includes document metadata without file refs';
  if (v_export -> 'artist') ? 'kofi_notes' then
    raise exception 'FAIL: export leaks Kofi internal notes to the artist';
  end if;
  raise notice 'ok: export_my_data() leaves out Kofi''s internal notes';
end $$;
reset role;
do $$
begin
  if not exists (select 1 from public.consents where artist_id = '20000000-0000-4000-8000-000000000003' and version = '2026-10-v1'
                 and user_id = '10000000-0000-4000-8000-000000000003' and accepted_at > now() - interval '1 minute') then
    raise exception 'FAIL: consent row not appended';
  end if;
  if not exists (select 1 from public.audit_events where action = 'artist.consent' and consent_version = '2026-10-v1' and entity_id = '20000000-0000-4000-8000-000000000003') then
    raise exception 'FAIL: artist.consent not audited with consent version';
  end if;
  if not exists (select 1 from public.audit_events where action = 'artist.status' and meta ->> 'status' = 'pending' and actor_role = 'artist') then
    raise exception 'FAIL: submit_for_review not audited';
  end if;
  if (select count(*) from public.audit_events where action = 'artist.export') <> 2 then
    raise exception 'FAIL: expected two artist.export events';
  end if;
  raise notice 'ok: consent appended, consent/status/export audited';
end $$;
rollback;

-- ------------------------------------------------------- curator flow -------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000007","role":"authenticated"}';
do $$
declare v_hint text; v_id uuid;
begin
  begin
    perform public.request_verification('Owen Blackwood', 'Coordinator', 'not-an-email', 'Identifying artists for a terminal commission call.', '{"name":"Pittsburgh International Airport Arts Program"}');
    raise exception 'FAIL: bad work email accepted';
  exception when invalid_parameter_value then
    get stacked diagnostics v_hint = pg_exception_hint;
    raise notice 'ok: request_verification() validates the work email (field %)', v_hint;
  end;
  v_id := public.request_verification('Owen Blackwood', 'Public Art Coordinator', 'o.blackwood@example.org',
    'Identifying artists for a terminal commission call, round two.', '{"name":"pittsburgh international airport arts program","country":"United States"}');
  if v_id <> '50000000-0000-4000-8000-000000000002' or (select count(*) from public.institutions) <> 3 then
    raise exception 'FAIL: re-request should reuse Owen''s curator row and the existing institution (case-insensitive)';
  end if;
  raise notice 'ok: request_verification() updates the existing request and reuses the institution';
end $$;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
begin
  begin
    perform public.request_verification('Mara', 't', 'm@example.org', 'I would like to be a curator too please.', '{"name":"X"}');
    raise exception 'FAIL: an artist requested curator verification';
  exception when insufficient_privilege then
    raise notice 'ok: only curator accounts can request verification';
  end;
end $$;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$
begin
  perform public.set_curator_status('50000000-0000-4000-8000-000000000002', 'verified', 'Checked staff directory.');
  if (select status from public.curators where id = '50000000-0000-4000-8000-000000000002') <> 'verified' then
    raise exception 'FAIL: admin could not verify Owen';
  end if;
  perform public.set_kofi_notes('20000000-0000-4000-8000-000000000001', 'Updated note.');
  perform public.mark_artwork_reviewed('30000000-0000-4000-8000-000000000013');
  begin
    perform public.mark_artwork_reviewed(gen_random_uuid());
    raise exception 'FAIL: unknown artwork reviewed';
  exception when no_data_found then
    raise notice 'ok: mark_artwork_reviewed() unknown id is NotFound';
  end;
  raise notice 'ok: admin verifies Owen, edits notes, marks work reviewed';
end $$;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000007","role":"authenticated"}';
do $$
begin
  if (select price_amount from public.artworks_visible where id = '30000000-0000-4000-8000-000000000011') is distinct from 9800 then
    raise exception 'FAIL: newly verified Owen should now see 9800';
  end if;
  raise notice 'ok: once verified, Owen sees the institutions-only price (verification read from the record)';
end $$;
reset role;
do $$
begin
  if not exists (select 1 from public.audit_events where action = 'curator.request' and actor_id = '10000000-0000-4000-8000-000000000007')
     or not exists (select 1 from public.audit_events where action = 'curator.status' and meta ->> 'status' = 'verified' and actor_role = 'admin')
     or not exists (select 1 from public.audit_events where action = 'artist.update' and meta ->> 'field' = 'kofiNotes')
     or not exists (select 1 from public.audit_events where action = 'artwork.update' and meta ->> 'reviewed' = 'true') then
    raise exception 'FAIL: curator request/status, notes or review not audited';
  end if;
  raise notice 'ok: curator.request, curator.status, kofi notes and review audited';
end $$;
rollback;

-- -------------------------------------------- cascades + audit noise --------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare n integer;
begin
  delete from public.artworks where id = '30000000-0000-4000-8000-000000000011';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: Mara could not delete her own artwork'; end if;
  raise notice 'ok: Mara deletes aw_mara_1';
end $$;
reset role;
do $$
begin
  if exists (select 1 from public.shortlist_items where artwork_id = '30000000-0000-4000-8000-000000000011') then
    raise exception 'FAIL: shortlist item survived the artwork deletion';
  end if;
  if exists (select 1 from public.documents where artwork_id is not null) then
    raise exception 'FAIL: documents should be detached (artwork_id null), not deleted';
  end if;
  if (select count(*) from public.documents) <> 2 then
    raise exception 'FAIL: vault documents must be retained after artwork deletion';
  end if;
  if exists (select 1 from public.audit_events where action = 'shortlist.remove') then
    raise exception 'FAIL: cascade removal was logged as a curator shortlist.remove';
  end if;
  if not exists (select 1 from public.audit_events where action = 'artwork.delete' and actor_role = 'artist') then
    raise exception 'FAIL: artwork.delete not audited';
  end if;
  raise notice 'ok: deleting a work removes shortlist items, detaches documents, audits only artwork.delete';
end $$;
rollback;

-- -------------------------------------------------------- demo reset --------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
begin
  begin
    perform public.kofi_demo_reset();
    raise exception 'FAIL: an artist reset the demo';
  exception when insufficient_privilege then
    raise notice 'ok: kofi_demo_reset() refuses non-admins (%)', sqlerrm;
  end;
  update public.artists set bio = 'Changed before the reset, should be restored afterwards.' where id = '20000000-0000-4000-8000-000000000001';
end $$;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$
declare before_count bigint;
begin
  select count(*) into before_count from public.audit_events;
  perform public.kofi_demo_reset();
  if (select bio from public.artists_visible where id = '20000000-0000-4000-8000-000000000001') like 'Changed before%' then
    raise exception 'FAIL: reset did not restore Mara''s bio';
  end if;
  if (select count(*) from public.audit_events) <> before_count then
    raise exception 'FAIL: reset wrote per-row audit noise';
  end if;
  raise notice 'ok: admin kofi_demo_reset() restores seed content without audit noise; audit log kept';
end $$;
rollback;

\echo 'rpc_test.sql: all assertions passed'
