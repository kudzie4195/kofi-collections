-- =============================================================================
-- Kofi Collections — RLS / visibility assertions
--
-- Run against a database that has the migrations + supabase/seed_auth.sql + seed_content.sql applied:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql
-- (supabase/tests/run-local.sh does the whole thing against a throwaway local
-- Postgres, with supabase/tests/shim.sql standing in for the Supabase platform.)
--
-- Each block impersonates a demo user exactly the way PostgREST does:
--   set local role anon|authenticated;
--   set local request.jwt.claims = '{"sub": "<auth.users.id>", "role": "authenticated"}';
-- Every block runs in its own transaction and rolls back, so blocks are
-- independent. A failed assertion RAISEs EXCEPTION (psql stops, exit code 3);
-- a passing one RAISEs NOTICE 'ok: …'.
--
-- Demo UUIDs (see the supabase/seed_content.sql header for the full table):
--   mara  user 10000000-…-000000000001  artist 20000000-…-000000000001
--   june  user 10000000-…-000000000003  artist 20000000-…-000000000003
--   priya user 10000000-…-000000000005  artist 20000000-…-000000000005
--   lena  user 10000000-…-000000000006  curator 50000000-…-000000000001 (verified)
--   owen  user 10000000-…-000000000007  curator 50000000-…-000000000002 (pending)
--   quincy user 10000000-…-000000000008 (admin)
--   aw_mara_1 30000000-…-000000000011 (public, price 9800 USD, price_visibility institutions)
--   aw_mara_2 30000000-…-000000000012 (public)
--   aw_mara_3 30000000-…-000000000013 (kofi-only draft)
--   aw_june_3 30000000-…-000000000033 (private draft)
--   inq_1 70000000-…-000000000001 (forwarded, Lena → Mara)   inq_2 …-000000000002 (pending, Lena → Tobias)
--   doc_1 80000000-…-000000000001 (Mara's vault)
-- =============================================================================

\set ON_ERROR_STOP on
\set QUIET on

-- ------------------------------------------------------------------ visitor --
begin;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
begin
  if exists (select 1 from kofi.artworks_visible where id = '30000000-0000-4000-8000-000000000013') then
    raise exception 'FAIL: visitor can see aw_mara_3 (kofi-only) through artworks_visible';
  end if;
  if exists (select 1 from kofi.artworks where id = '30000000-0000-4000-8000-000000000013') then
    raise exception 'FAIL: visitor can see aw_mara_3 in the base table';
  end if;
  raise notice 'ok: visitor cannot see aw_mara_3 (view or base table)';

  if exists (select 1 from kofi.artworks_visible where id = '30000000-0000-4000-8000-000000000033')
     or exists (select 1 from kofi.artworks where id = '30000000-0000-4000-8000-000000000033') then
    raise exception 'FAIL: visitor can see aw_june_3 (private draft)';
  end if;
  raise notice 'ok: visitor cannot see aw_june_3';

  if not exists (
    select 1 from kofi.artworks_visible
    where id = '30000000-0000-4000-8000-000000000011' and price_withheld and price_amount is null and price_currency is null
  ) then
    raise exception 'FAIL: visitor should get aw_mara_1 with price_withheld = true and no price';
  end if;
  raise notice 'ok: visitor sees aw_mara_1 with price_withheld = true, price NULL';

  if not exists (select 1 from kofi.artworks_visible where id = '30000000-0000-4000-8000-000000000012' and price_amount = 1400 and not price_withheld) then
    raise exception 'FAIL: visitor should see the public price (1400) on aw_mara_2';
  end if;
  raise notice 'ok: visitor sees public price 1400 on aw_mara_2';

  if exists (select 1 from kofi.artists_visible where id = '20000000-0000-4000-8000-000000000005')
     or exists (select 1 from kofi.artworks_visible where artist_id = '20000000-0000-4000-8000-000000000005') then
    raise exception 'FAIL: visitor can see pending artist Priya or her work';
  end if;
  raise notice 'ok: visitor cannot see pending artist Priya or her work';

  if exists (
    select 1 from kofi.artists_visible
    where contact_email is not null or legal_name is not null or kofi_notes is not null
       or region_city is not null or consent_version is not null
  ) then
    raise exception 'FAIL: artists_visible leaks private artist fields to a visitor';
  end if;
  raise notice 'ok: artists_visible returns no contact/legal name/notes/full region to a visitor';

  if (select region_label from kofi.artists_visible where id = '20000000-0000-4000-8000-000000000004') <> 'United States' then
    raise exception 'FAIL: DeShawn (precision=country) should be labelled "United States"';
  end if;
  if (select region_label from kofi.artists_visible where id = '20000000-0000-4000-8000-000000000001') <> 'Pittsburgh, Pennsylvania' then
    raise exception 'FAIL: Mara (precision=city) should be labelled "Pittsburgh, Pennsylvania"';
  end if;
  if (select artist_region_label from kofi.artworks_visible where id = '30000000-0000-4000-8000-000000000021') <> 'Pennsylvania, United States' then
    raise exception 'FAIL: Tobias (precision=region) should be labelled "Pennsylvania, United States"';
  end if;
  raise notice 'ok: region labels are reduced to the artist''s chosen precision';

  if (select count(*) from kofi.artworks_visible) <> 9 then
    raise exception 'FAIL: visitor should see exactly 9 published artworks, saw %', (select count(*) from kofi.artworks_visible);
  end if;
  raise notice 'ok: visitor sees exactly the 9 public works of approved artists (Mara 2, Tobias 3, June 2, DeShawn 2)';
end $$;

-- Field-level: the sensitive columns are not selectable at all.
do $$
declare v numeric;
begin
  begin
    select price_amount into v from kofi.artworks where id = '30000000-0000-4000-8000-000000000011';
    raise exception 'FAIL: visitor could select artworks.price_amount directly';
  exception when insufficient_privilege then
    raise notice 'ok: visitor cannot select artworks.price_amount from the base table (%)', sqlerrm;
  end;
end $$;
do $$
declare v text;
begin
  begin
    select contact_email into v from kofi.artists limit 1;
    raise exception 'FAIL: visitor could select artists.contact_email directly';
  exception when insufficient_privilege then
    raise notice 'ok: visitor cannot select artists.contact_email from the base table';
  end;
  begin
    select kofi_notes into v from kofi.artists limit 1;
    raise exception 'FAIL: visitor could select artists.kofi_notes directly';
  exception when insufficient_privilege then
    raise notice 'ok: visitor cannot select artists.kofi_notes from the base table';
  end;
end $$;
do $$
begin
  if exists (select 1 from kofi.artwork_price('30000000-0000-4000-8000-000000000011') where price_amount is not null) then
    raise exception 'FAIL: artwork_price() rpc leaks the institutions-only price to a visitor';
  end if;
  if exists (select 1 from kofi.artist_extras('20000000-0000-4000-8000-000000000001') where contact_email is not null) then
    raise exception 'FAIL: artist_extras() rpc leaks contact to a visitor';
  end if;
  raise notice 'ok: the definer helpers behind the views redact when called directly';
end $$;
do $$
begin
  begin
    insert into kofi.audit_events (actor_id, actor_role, actor_name, action, entity_type, entity_id)
    values ('x', 'admin', 'forged', 'artist.status', 'artist', 'x');
    raise exception 'FAIL: visitor inserted an audit event';
  exception when insufficient_privilege then
    raise notice 'ok: visitor cannot insert audit events';
  end;
end $$;
rollback;

-- -------------------------------------------- Lena (verified curator) --------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated"}';
do $$
begin
  if (select price_amount from kofi.artworks_visible where id = '30000000-0000-4000-8000-000000000011') is distinct from 9800 then
    raise exception 'FAIL: Lena (verified) should see price 9800 on aw_mara_1, saw %',
      (select price_amount from kofi.artworks_visible where id = '30000000-0000-4000-8000-000000000011');
  end if;
  if (select price_withheld from kofi.artworks_visible where id = '30000000-0000-4000-8000-000000000011') then
    raise exception 'FAIL: price_withheld should be false for Lena';
  end if;
  raise notice 'ok: Lena (verified curator) sees 9800 USD on aw_mara_1';

  if exists (select 1 from kofi.artworks_visible where id in ('30000000-0000-4000-8000-000000000013', '30000000-0000-4000-8000-000000000033')) then
    raise exception 'FAIL: Lena can see a kofi-only or private draft';
  end if;
  raise notice 'ok: Lena cannot see aw_mara_3 or aw_june_3';

  if exists (select 1 from kofi.artists_visible where contact_email is not null) then
    raise exception 'FAIL: Lena can see an artist''s contact email';
  end if;
  raise notice 'ok: Lena never receives artist contact fields';

  if (select count(*) from kofi.shortlists) <> 1 or (select count(*) from kofi.shortlist_items) <> 2 then
    raise exception 'FAIL: Lena should see her one shortlist with two items';
  end if;
  if (select count(*) from kofi.inquiries_visible) <> 2
     or exists (select 1 from kofi.inquiries_visible where curator_name is null or institution_name is null) then
    raise exception 'FAIL: Lena should see her two inquiries with labels';
  end if;
  raise notice 'ok: Lena sees her shortlist (2 items) and her 2 inquiries with labels';
end $$;

-- Shortlisting: only work she may see, never drafts.
do $$
begin
  begin
    insert into kofi.shortlist_items (shortlist_id, artwork_id) values ('60000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000013');
    raise exception 'FAIL: Lena shortlisted kofi-only aw_mara_3';
  exception when insufficient_privilege then
    raise notice 'ok: Lena cannot shortlist aw_mara_3 (%)', sqlerrm;
  end;
  insert into kofi.shortlist_items (shortlist_id, artwork_id) values ('60000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000012');
  if (select count(*) from kofi.shortlist_items) <> 3 then
    raise exception 'FAIL: Lena could not shortlist public aw_mara_2';
  end if;
  raise notice 'ok: Lena can shortlist public aw_mara_2';
end $$;

-- Inquiry: verified curator can ask about public work of an approved public artist.
do $$
declare v_id uuid; n integer;
begin
  insert into kofi.inquiries (curator_id, artist_id, artwork_id, message)
  values ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000012',
          'Would Mara consider lending Small Weather No. 4 for our spring show?')
  returning id into v_id;
  raise notice 'ok: Lena can create an inquiry for aw_mara_2 (%)', v_id;
  begin
    insert into kofi.inquiries (curator_id, artist_id, artwork_id, message)
    values ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000013',
            'Asking about the bridge study that is not published yet.');
    raise exception 'FAIL: Lena created an inquiry about kofi-only aw_mara_3';
  exception when insufficient_privilege then
    raise notice 'ok: Lena cannot ask about aw_mara_3';
  end;
  begin
    insert into kofi.inquiries (curator_id, artist_id, message)
    values ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000005', 'Hello Priya, is your work available for a show?');
    raise exception 'FAIL: Lena created an inquiry for pending artist Priya';
  exception when insufficient_privilege then
    raise notice 'ok: Lena cannot send an inquiry to a pending artist';
  end;
  update kofi.inquiries set status = 'accepted' where id = '70000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: curator changed an inquiry status';
  end if;
  raise notice 'ok: curator cannot change inquiry status directly (0 rows affected)';
  begin
    perform kofi.set_inquiry_status('70000000-0000-4000-8000-000000000001', 'accepted');
    raise exception 'FAIL: curator changed an inquiry status through the RPC';
  exception when insufficient_privilege then
    raise notice 'ok: curator cannot change inquiry status through the RPC (%)', sqlerrm;
  end;
  begin
    perform kofi.open_document('80000000-0000-4000-8000-000000000001');
    raise exception 'FAIL: Lena opened Mara''s vault document';
  exception when insufficient_privilege then
    raise notice 'ok: Lena cannot open Mara''s vault document (%)', sqlerrm;
  end;
  if exists (select 1 from kofi.documents) then
    raise exception 'FAIL: Lena can list vault documents';
  end if;
  raise notice 'ok: Lena cannot list any vault documents';
  if exists (select 1 from kofi.audit_events) then
    raise exception 'FAIL: Lena can read the audit log';
  end if;
  raise notice 'ok: Lena cannot read the audit log';
end $$;
rollback;

-- ------------------------------------------- Owen (pending curator) ----------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000007","role":"authenticated"}';
do $$
begin
  if not (select price_withheld from kofi.artworks_visible where id = '30000000-0000-4000-8000-000000000011')
     or (select price_amount from kofi.artworks_visible where id = '30000000-0000-4000-8000-000000000011') is not null then
    raise exception 'FAIL: Owen (pending) should see aw_mara_1 price withheld';
  end if;
  raise notice 'ok: Owen (pending curator) sees aw_mara_1 price withheld';
  begin
    insert into kofi.inquiries (curator_id, artist_id, message)
    values ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Hello Mara, we are scouting for the terminal commission.');
    raise exception 'FAIL: unverified curator created an inquiry';
  exception when insufficient_privilege then
    raise notice 'ok: Owen (pending) cannot create an inquiry';
  end;
  begin
    update kofi.curators set status = 'verified' where id = '50000000-0000-4000-8000-000000000002';
    raise exception 'FAIL: Owen verified himself';
  exception when insufficient_privilege then
    raise notice 'ok: Owen cannot verify himself (%)', sqlerrm;
  end;
end $$;
rollback;

-- ----------------------------------------------------- June (artist) ---------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}';
do $$
declare n integer;
begin
  update kofi.artworks set title = 'Hijacked' where id = '30000000-0000-4000-8000-000000000011';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: June updated Mara''s artwork (% rows)', n;
  end if;
  raise notice 'ok: June cannot update Mara''s artwork (0 rows affected)';

  delete from kofi.artworks where id = '30000000-0000-4000-8000-000000000012';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: June deleted Mara''s artwork';
  end if;
  raise notice 'ok: June cannot delete Mara''s artwork (0 rows affected)';

  if not exists (select 1 from kofi.artworks_visible where id = '30000000-0000-4000-8000-000000000033' and can_edit) then
    raise exception 'FAIL: June should see her own private draft aw_june_3 with can_edit';
  end if;
  raise notice 'ok: June sees her own private draft with can_edit = true';

  begin
    insert into kofi.artwork_images (artwork_id, src)
    values ('30000000-0000-4000-8000-000000000031', 'storage:artwork-images/20000000-0000-4000-8000-000000000001/stolen.jpg');
    raise exception 'FAIL: June linked an image from Mara''s storage folder';
  exception when insufficient_privilege then
    raise notice 'ok: June cannot link another artist''s stored image into her work';
  end;
end $$;
rollback;

-- ---------------------------------------------------- Mara (artist) ----------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare v_path text;
begin
  if not exists (select 1 from kofi.artists_visible where id = '20000000-0000-4000-8000-000000000001' and contact_email = 'mara@example.com' and legal_name is not null) then
    raise exception 'FAIL: Mara should see her own contact email and legal name';
  end if;
  if exists (select 1 from kofi.artists_visible where id = '20000000-0000-4000-8000-000000000001' and kofi_notes is not null) then
    raise exception 'FAIL: Mara can read Kofi''s internal notes about her';
  end if;
  raise notice 'ok: Mara sees her own private fields but not Kofi notes';

  if not exists (select 1 from kofi.artworks_visible where id = '30000000-0000-4000-8000-000000000013') then
    raise exception 'FAIL: Mara cannot see her own kofi-only draft';
  end if;
  raise notice 'ok: Mara sees her own kofi-only draft aw_mara_3';

  begin
    update kofi.artists set kofi_notes = 'I wrote this' where id = '20000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: Mara edited kofi_notes';
  exception when insufficient_privilege then
    raise notice 'ok: Mara cannot write kofi_notes (%)', sqlerrm;
  end;
  begin
    update kofi.artworks set reviewed_at = now() where id = '30000000-0000-4000-8000-000000000013';
    raise exception 'FAIL: Mara marked her own work reviewed';
  exception when insufficient_privilege then
    raise notice 'ok: Mara cannot set reviewed_at';
  end;

  -- Owner edit is allowed (and audited server-side — checked after `reset role` below).
  update kofi.artworks set price_visibility = 'private' where id = '30000000-0000-4000-8000-000000000011';
  if (select price_visibility from kofi.artworks where id = '30000000-0000-4000-8000-000000000011') <> 'private' then
    raise exception 'FAIL: Mara could not change price visibility on her own work';
  end if;
  raise notice 'ok: Mara can change price visibility on her own work';
end $$;

do $$
declare v_path text;
begin
  -- inq_1 is forwarded to Mara; inq_2 (pending, Tobias) must be invisible.
  if not exists (select 1 from kofi.inquiries_visible where id = '70000000-0000-4000-8000-000000000001' and curator_name = 'Lena Marchetti') then
    raise exception 'FAIL: Mara should see forwarded inq_1 with the curator''s name';
  end if;
  if exists (select 1 from kofi.inquiries where status = 'pending') then
    raise exception 'FAIL: Mara can see a pending inquiry';
  end if;
  raise notice 'ok: Mara sees forwarded inq_1 (with curator label), no pending inquiries';

  begin
    update kofi.inquiries set status = 'forwarded' where id = '70000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: artist set an inquiry back to forwarded';
  exception when insufficient_privilege then
    raise notice 'ok: artist cannot move an inquiry to forwarded (%)', sqlerrm;
  end;
  perform kofi.set_inquiry_status('70000000-0000-4000-8000-000000000001', 'accepted');
  if (select status from kofi.inquiries where id = '70000000-0000-4000-8000-000000000001') <> 'accepted' then
    raise exception 'FAIL: Mara could not accept forwarded inq_1';
  end if;
  raise notice 'ok: Mara accepts forwarded inq_1 (forwarded → accepted)';
  begin
    perform kofi.set_inquiry_status('70000000-0000-4000-8000-000000000001', 'declined');
    raise exception 'FAIL: Mara re-decided an accepted inquiry';
  exception when invalid_parameter_value then
    raise notice 'ok: an accepted inquiry cannot be re-decided (%)', sqlerrm;
  end;

  v_path := kofi.open_document('80000000-0000-4000-8000-000000000001');
  if v_path <> '20000000-0000-4000-8000-000000000001/80000000-0000-4000-8000-000000000001' then
    raise exception 'FAIL: open_document returned an unexpected path %', v_path;
  end if;
  raise notice 'ok: Mara opens her own vault document (path %)', v_path;

  perform kofi.export_my_data();
  raise notice 'ok: Mara can export her data';

  begin
    perform kofi.log_audit('artist.status', 'artist', '20000000-0000-4000-8000-000000000001', '{"status":"approved"}');
    raise exception 'FAIL: client forged an artist.status audit event';
  exception when insufficient_privilege then
    raise notice 'ok: log_audit() refuses server-only actions';
  end;
end $$;

reset role;
do $$
begin
  if not exists (select 1 from kofi.audit_events where action = 'artwork.visibility' and actor_id = '10000000-0000-4000-8000-000000000001'
                 and entity_id = '30000000-0000-4000-8000-000000000011' and meta ->> 'priceVisibility' = 'private') then
    raise exception 'FAIL: owner visibility change was not audited by the trigger';
  end if;
  if not exists (select 1 from kofi.audit_events where action = 'inquiry.status' and meta ->> 'status' = 'accepted' and actor_role = 'artist') then
    raise exception 'FAIL: inquiry acceptance was not audited';
  end if;
  if not exists (select 1 from kofi.audit_events where action = 'document.open' and meta ->> 'byOwner' = 'true') then
    raise exception 'FAIL: document.open was not audited';
  end if;
  if not exists (select 1 from kofi.audit_events where action = 'artist.export' and actor_name = 'Mara Oyelaran') then
    raise exception 'FAIL: artist.export was not audited';
  end if;
  raise notice 'ok: visibility change, inquiry decision, document open and export were all audited server-side';
end $$;
rollback;

-- -------------------------------------------- Priya (pending artist) ---------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated"}';
do $$
declare n integer;
begin
  begin
    update kofi.artists set status = 'approved' where id = '20000000-0000-4000-8000-000000000005';
    get diagnostics n = row_count;
    raise exception 'FAIL: artist set own status to approved (% rows)', n;
  exception when insufficient_privilege then
    raise notice 'ok: artist cannot set own status to approved (%)', sqlerrm;
  end;
  begin
    perform kofi.set_artist_status('20000000-0000-4000-8000-000000000005', 'approved');
    raise exception 'FAIL: artist approved herself through the RPC';
  exception when insufficient_privilege then
    raise notice 'ok: set_artist_status() is admin-only (%)', sqlerrm;
  end;
  if not exists (select 1 from kofi.artists_visible where id = '20000000-0000-4000-8000-000000000005' and status = 'pending' and can_edit) then
    raise exception 'FAIL: Priya should see her own pending profile';
  end if;
  raise notice 'ok: Priya sees her own pending profile';
  update kofi.artists set bio = 'Printmaker and digital artist. Screen prints that start as code and end as ink, pulled by hand.'
  where id = '20000000-0000-4000-8000-000000000005';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: Priya could not edit her own bio';
  end if;
  raise notice 'ok: Priya can edit her own bio';
end $$;
rollback;

-- -------------------------------------------------- Quincy (admin) -----------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$
declare v_path text;
begin
  if not exists (select 1 from kofi.artworks_visible where id = '30000000-0000-4000-8000-000000000033') then
    raise exception 'FAIL: admin cannot see a private draft';
  end if;
  if (select kofi_notes from kofi.artists_visible where id = '20000000-0000-4000-8000-000000000001') is null then
    raise exception 'FAIL: admin should see Kofi notes';
  end if;
  raise notice 'ok: admin sees private drafts and Kofi notes';

  begin
    update kofi.artworks set title = 'Edited by staff' where id = '30000000-0000-4000-8000-000000000011';
    raise exception 'FAIL: admin edited an artist''s artwork title';
  exception when insufficient_privilege then
    raise notice 'ok: admin can only set reviewed_at on artworks (%)', sqlerrm;
  end;
  update kofi.artworks set reviewed_at = now() where id = '30000000-0000-4000-8000-000000000013';
  raise notice 'ok: admin can mark work reviewed';

  begin
    update kofi.artists set bio = 'Rewritten by staff, which should not be allowed at all.' where id = '20000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: admin rewrote an artist bio';
  exception when insufficient_privilege then
    raise notice 'ok: admin cannot rewrite artist profile fields';
  end;
  perform kofi.set_artist_status('20000000-0000-4000-8000-000000000005', 'approved', 'Two more works documented.');
  if (select status from kofi.artists where id = '20000000-0000-4000-8000-000000000005') <> 'approved' then
    raise exception 'FAIL: admin could not approve Priya';
  end if;
  raise notice 'ok: admin approves Priya via set_artist_status()';

  perform kofi.set_inquiry_status('70000000-0000-4000-8000-000000000002', 'forwarded', 'Verified curator.');
  raise notice 'ok: admin forwards pending inq_2';
  begin
    perform kofi.set_inquiry_status('70000000-0000-4000-8000-000000000002', 'declined');
    raise exception 'FAIL: admin re-decided inq_2';
  exception when invalid_parameter_value then
    raise notice 'ok: admin cannot re-decide a forwarded inquiry (%)', sqlerrm;
  end;
  begin
    perform kofi.set_inquiry_status('70000000-0000-4000-8000-000000000001', 'accepted');
    raise exception 'FAIL: admin accepted on the artist''s behalf';
  exception when insufficient_privilege then
    raise notice 'ok: admin cannot accept on the artist''s behalf (%)', sqlerrm;
  end;

  -- Vault: admin storage read is only allowed right after an audited open.
  if kofi.vault_open_logged('20000000-0000-4000-8000-000000000001/80000000-0000-4000-8000-000000000002') then
    raise exception 'FAIL: vault read allowed before any audited open';
  end if;
  v_path := kofi.open_document('80000000-0000-4000-8000-000000000002');
  if not kofi.vault_open_logged(v_path) then
    raise exception 'FAIL: vault read not allowed after an audited open';
  end if;
  raise notice 'ok: admin vault read is gated on an audited open_document()';

  if (select count(*) from kofi.audit_events) < 4 then
    raise exception 'FAIL: admin should read the audit log';
  end if;
  raise notice 'ok: admin reads the audit log';

  begin
    update kofi.audit_events set actor_name = 'tampered';
    raise exception 'FAIL: admin updated audit_events';
  exception when insufficient_privilege then
    raise notice 'ok: admin (API role) cannot update audit_events';
  end;
end $$;
rollback;

-- ------------------------------------------- append-only, even for owner ----
begin;
do $$
begin
  begin
    update kofi.audit_events set actor_name = 'tampered' where id = '90000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: audit_events update succeeded for the table owner';
  exception when insufficient_privilege then
    raise notice 'ok: audit_events UPDATE raises even for the table owner (%)', sqlerrm;
  end;
  begin
    delete from kofi.audit_events where id = '90000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: audit_events delete succeeded for the table owner';
  exception when insufficient_privilege then
    raise notice 'ok: audit_events DELETE raises even for the table owner';
  end;
  begin
    truncate kofi.audit_events;
    raise exception 'FAIL: audit_events truncate succeeded';
  exception when insufficient_privilege then
    raise notice 'ok: audit_events TRUNCATE raises';
  end;
  begin
    delete from kofi.consents;
    raise exception 'FAIL: consents delete succeeded';
  exception when insufficient_privilege then
    raise notice 'ok: consents is append-only too';
  end;
end $$;
rollback;

-- ----------------------------------------------------------- storage --------
begin;
-- As the owner (postgres), stage one stored image on a public work and one on a draft.
insert into storage.objects (bucket_id, name) values
  ('artwork-images', '20000000-0000-4000-8000-000000000001/aaaaaaaa-0000-4000-8000-000000000001.jpg'),
  ('artwork-images', '20000000-0000-4000-8000-000000000001/aaaaaaaa-0000-4000-8000-000000000002.jpg'),
  ('vault', '20000000-0000-4000-8000-000000000001/80000000-0000-4000-8000-000000000001');
insert into kofi.artwork_images (id, artwork_id, src) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000012', 'storage:artwork-images/20000000-0000-4000-8000-000000000001/aaaaaaaa-0000-4000-8000-000000000001.jpg'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000013', 'storage:artwork-images/20000000-0000-4000-8000-000000000001/aaaaaaaa-0000-4000-8000-000000000002.jpg');
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
begin
  if not exists (select 1 from storage.objects where name = '20000000-0000-4000-8000-000000000001/aaaaaaaa-0000-4000-8000-000000000001.jpg') then
    raise exception 'FAIL: visitor cannot read the stored image of public aw_mara_2';
  end if;
  if exists (select 1 from storage.objects where name = '20000000-0000-4000-8000-000000000001/aaaaaaaa-0000-4000-8000-000000000002.jpg') then
    raise exception 'FAIL: visitor can read the stored image of kofi-only aw_mara_3';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'vault') then
    raise exception 'FAIL: visitor can see a vault object';
  end if;
  raise notice 'ok: storage read follows artwork visibility; vault invisible to visitors';
  begin
    insert into storage.objects (bucket_id, name) values ('artwork-images', '20000000-0000-4000-8000-000000000001/anon.jpg');
    raise exception 'FAIL: visitor uploaded an image';
  exception when insufficient_privilege then
    raise notice 'ok: visitor cannot upload';
  end;
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}';
do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'vault') then
    raise exception 'FAIL: June can see Mara''s vault object';
  end if;
  begin
    insert into storage.objects (bucket_id, name) values ('vault', '20000000-0000-4000-8000-000000000001/planted');
    raise exception 'FAIL: June wrote into Mara''s vault folder';
  exception when insufficient_privilege then
    raise notice 'ok: June cannot read or write Mara''s vault folder';
  end;
  insert into storage.objects (bucket_id, name) values ('artwork-images', '20000000-0000-4000-8000-000000000003/new.jpg');
  raise notice 'ok: June can upload into her own artwork-images folder';
end $$;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'vault') then
    raise exception 'FAIL: admin can read a vault object without an audited open';
  end if;
  perform kofi.open_document('80000000-0000-4000-8000-000000000001');
  if not exists (select 1 from storage.objects where bucket_id = 'vault') then
    raise exception 'FAIL: admin cannot read the vault object after an audited open';
  end if;
  raise notice 'ok: admin reads a vault object only after open_document() logged it';
end $$;
rollback;

\echo 'rls_test.sql: all assertions passed'
