-- =============================================================================
-- Kofi Collections — taxonomy, filters, matching (0011_taxonomy.sql)
--
-- Same conventions as intake_test.sql: each block impersonates a user the way
-- PostgREST does (set local role …; set local request.jwt.claims = …), runs in
-- its own transaction and rolls back. RAISE EXCEPTION on failure, NOTICE
-- 'ok: …' on success. Values handed from one role to the next in a transaction
-- travel in kofi_test.* settings (set_config(…, true)).
--
-- Kofi's workbook P0 tests covered here: ids survive a label change; OR within a
-- category / AND across ("Painting OR Drawing plus Social Impact = Education
-- Access"); 24 in ≈ 60.96 cm; a visitor never gets a withheld price (rows, totals,
-- facets, budget, matching); not for sale but available for exhibition; an
-- institution cannot edit an artwork; 3+ values in a category save.
--
-- Demo UUIDs (src/data/supabase/demo.ts):
--   users   mara …01  tobias …02  june …03  deshawn …04  priya …05 (pending)  lena …06 (verified, CMA)
--           owen …07 (pending curator)  quincy …08 (admin)
--   works   Doubling 30…11 (price 9800 USD, institutions only)  Small Weather 30…12  Bridge Study 30…13 (kofi, not for sale)
--   calls   Night Weather award a2…02 (Kofi)  CMA auction a2…05 (organiser CMA 40…01)
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

-- A save_artwork() payload for a public work with one inline image, overridden by p.
create or replace function kofi_test.work(p jsonb default '{}'::jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'title', 'Test work', 'year', 2026, 'medium', 'painting', 'materials', jsonb_build_array('oil'),
    'dimensions', jsonb_build_object('height', 50, 'width', 40, 'depth', null, 'unit', 'cm'),
    'description', '', 'status', 'available', 'rightsNote', '', 'price', null,
    'priceVisibility', 'public', 'visibility', 'public', 'tags', '[]'::jsonb) || p
$$;
create or replace function kofi_test.image() returns jsonb
language sql immutable as $$
  select '[{"src":"data:image/svg+xml;utf8,%3Csvg%2F%3E","alt":"A test image","isPrimary":true,"metadataStripped":true}]'::jsonb
$$;
-- The ids of the rows a search returned, in order.
create or replace function kofi_test.ids(p jsonb) returns uuid[]
language sql immutable as $$
  select coalesce(array_agg((r ->> 'id')::uuid order by o), '{}') from jsonb_array_elements(p -> 'rows') with ordinality t (r, o)
$$;
grant execute on function kofi_test.work(jsonb), kofi_test.image(), kofi_test.ids(jsonb) to anon, authenticated;

-- ================================================================ seed =======
do $$
begin
  if (select count(*) from kofi.tag_categories) <> 25 or (select count(*) from kofi.tags) <> 174
     or (select count(*) from kofi.tags where app_addition) <> 2
     or (select count(*) from kofi.tags where category = 'social_impact' and artist_selectable and phase = 'mvp') <> 25
     or (select array_agg(id order by artist_position) from kofi.tag_categories where artist_position is not null)
        <> array['medium', 'style', 'subject', 'theme', 'social_impact', 'material', 'palette', 'display_format'] then
    raise exception 'FAIL: kofi.tags should hold the workbook library (25 categories, 172 + 2 tags, 25 Social Impact tags, 8 artist categories in form order)';
  end if;
  if (select definition from kofi.tags where id = 'social_impact.youth_empowerment') <> 'Art centers youth leadership, expression or agency.'
     or (select label from kofi.tag_categories where id = 'social_impact') <> 'Social Impact' then
    raise exception 'FAIL: labels and definitions come from the workbook verbatim';
  end if;
  if (select tag_ids from kofi.artworks where id = '30000000-0000-4000-8000-000000000011')
       <> array['medium.painting', 'style.expressionism', 'style.figurative', 'subject.urban_life', 'theme.memory', 'material.oil', 'palette.warm']
     or (select uses from kofi.artworks where id = '30000000-0000-4000-8000-000000000011') <> '{"auction": true, "exhibition": true, "licensing": false, "commission": false}'
     or (select edition from kofi.artworks where id = '30000000-0000-4000-8000-000000000041') <> '{"type": "limited", "number": 2, "size": 5}'
     or (select looking_for -> 'uses' from kofi.open_calls where id = 'a2000000-0000-4000-8000-000000000005') <> '["auction"]'
     or exists (select 1 from kofi.artworks where tag_ids = '{}' or not (kofi.medium_tag_id(medium) = any (tag_ids))) then
    raise exception 'FAIL: the seed classification (tags, uses, edition, call criteria) did not load, or a work lost its medium mirror';
  end if;
  raise notice 'ok: seed — the workbook library (25 categories, 174 tags), the demo works'' tags / uses / editions by id, the two calls'' criteria; every work mirrors its medium';
end $$;

-- ============================================== pure helpers = the TS rules ==
do $$
begin
  -- orientationOf() cases from src/domain/taxonomy.test.ts
  if kofi.orientation_of(100, 60, null, 'painting') <> 'portrait' or kofi.orientation_of(60, 100, null, 'painting') <> 'landscape'
     or kofi.orientation_of(50, 51, null, 'painting') <> 'square' or kofi.orientation_of(30, 90, null, 'photography') <> 'panoramic'
     or kofi.orientation_of(30, 30, 10, 'painting') <> 'three_dimensional' or kofi.orientation_of(30, 20, null, 'sculpture') <> 'three_dimensional'
     or kofi.orientation_of(100, 105, null, 'painting') <> 'square' or kofi.orientation_of(100, 95, null, 'painting') <> 'square'
     or kofi.orientation_of(100, 200, 0, 'drawing') <> 'panoramic' or kofi.orientation_of(152, 122, 4, 'painting') <> 'portrait'
     or kofi.orientation_of(100, 50, 10, 'painting') <> 'three_dimensional' or kofi.orientation_of(100, 50, 9.99, 'painting') <> 'portrait' then
    raise exception 'FAIL: orientation_of() should equal orientationOf() (≥2 panoramic, >1.05 landscape, <0.95 portrait, else square; 3D medium or depth ≥ shorter edge / 5)';
  end if;
  -- longestEdge(): each side converted and rounded to one decimal
  if kofi.longest_edge(24, 18, null, 'in', 'cm') <> 61.0 or kofi.longest_edge(24, 36, 2, 'in', 'cm') <> 91.4
     or kofi.longest_edge(152, 122, 4, 'cm', 'in') <> 59.8 or kofi.longest_edge(60.96, 10, null, 'cm', 'in') <> 24.0
     or kofi.longest_edge(10, 10, null, 'cm', 'cm') <> 10 then
    raise exception 'FAIL: longest_edge() should equal longestEdge() (24 in → 61 cm, 36 in → 91.4 cm, 152 cm → 59.8 in)';
  end if;
  -- normalizeTagIds() cases from src/domain/taxonomy.test.ts
  if kofi.normalize_tag_ids(array['theme.joy', 'style.abstract', 'style.abstract', 'curatorial.exhibition_ready', 'nope.x', 'acquisition.auction', ' theme.joy '], 'painting')
       <> array['medium.painting', 'style.abstract', 'theme.joy']
     or kofi.normalize_tag_ids('{}', 'mixed media') <> array['medium.mixed_media'] or kofi.normalize_tag_ids('{}', 'digital') <> array['medium.digital_art']
     or kofi.normalize_tag_ids(array['medium.video', 'subject.urban_life'], 'video') <> array['subject.urban_life', 'medium.video'] then
    raise exception 'FAIL: normalize_tag_ids() should dedupe, trim, drop unknown / hidden ids, mirror the medium and keep library order';
  end if;
  perform kofi_test.expect_error($q$select kofi.normalize_tag_ids((select array_agg(id) from kofi.tags where category = 'style' and artist_selectable and phase = 'mvp'), 'drawing')$q$,
    '22023', 'tags.style', 'Pick up to 6 artistic style tags.');
  perform kofi_test.expect_error($q$select kofi.normalize_tag_ids((select array_agg(id) from (select id from kofi.tags where category = 'social_impact' and artist_selectable order by position limit 5) x), 'drawing')$q$,
    '22023', 'tags.social_impact', 'Pick up to 4 social impact tags.');
  if cardinality(kofi.normalize_tag_ids((select array_agg(id) from (select id from kofi.tags where category = 'social_impact' and artist_selectable order by position limit 4) x), 'drawing')) <> 5 then
    raise exception 'FAIL: four Social Impact tags (plus the medium) should save';
  end if;
  raise notice 'ok: orientation_of / longest_edge / normalize_tag_ids give the TypeScript answers; caps refused with "Pick up to 6 artistic style tags." / "Pick up to 4 social impact tags."';
end $$;

-- ===================================================== kofi.tags: RLS ========
begin;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
begin
  if (select count(*) from kofi.tags) <> 174 or (select count(*) from kofi.tag_categories) <> 25 then
    raise exception 'FAIL: a visitor should read the whole library';
  end if;
  perform kofi_test.expect_error($q$insert into kofi.tags (id, category, label, phase) values ('style.neo', 'style', 'Neo', 'mvp')$q$, '42501');
  perform kofi_test.expect_error($q$update kofi.tags set label = 'X' where id = 'style.abstract'$q$, '42501');
  raise notice 'ok: a visitor reads kofi.tags / tag_categories and cannot write them';
end $$;
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated"}';
do $$
begin
  perform kofi_test.expect_error($q$insert into kofi.tags (id, category, label, phase) values ('style.neo', 'style', 'Neo', 'mvp')$q$, '42501', null, '%row-level security%');
  update kofi.tags set label = 'Hijacked' where id = 'style.abstract';
  if (select label from kofi.tags where id = 'style.abstract') <> 'Abstract' then
    raise exception 'FAIL: a curator relabelled a tag';
  end if;
  raise notice 'ok: a curator (and any non-admin) cannot add or relabel tags';
end $$;
rollback;

-- ============== P0: ids survive a label change (relabel, alias, search by id) ===
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare
  v_id uuid;
begin
  v_id := kofi.save_artwork(kofi_test.work('{"title":"Lessons","medium":"drawing","tagIds":["social_impact.education_access","subject.people"]}'), kofi_test.image());
  perform set_config('kofi_test.edu', v_id::text, true);
end $$;
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$
begin
  update kofi.tags set label = 'Learning Access', definition = 'Renamed by Kofi.' where id = 'social_impact.education_access';
  if (select label from kofi.tags where id = 'social_impact.education_access') <> 'Learning Access'
     or not ('Education Access'::text = any ((select aliases from kofi.tags where id = 'social_impact.education_access')::text[])) then
    raise exception 'FAIL: Kofi relabels a tag; the old label stays as an alias';
  end if;
  perform kofi_test.expect_error($q$update kofi.tags set id = 'social_impact.learning' where id = 'social_impact.education_access'$q$, '42501');
  perform kofi_test.expect_error($q$delete from kofi.tags where id = 'social_impact.education_access'$q$, '42501');
  insert into kofi.tags (id, category, label, definition, artist_selectable, phase, position) values ('style.solarpunk', 'style', 'Solarpunk', 'Kofi addition.', true, 'mvp', 999);
  raise notice 'ok: Kofi relabels (old label kept as an alias), adds a tag; ids cannot change and tags are never deleted through the API';
end $$;
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare
  r jsonb;
begin
  r := kofi.search_artworks('{"tags":{"social_impact":["social_impact.education_access"]}}');
  if kofi_test.ids(r) <> array[current_setting('kofi_test.edu')::uuid] or (r ->> 'total')::int <> 1 then
    raise exception 'FAIL: search by the stable id should still find the work after the relabel: %', r - 'rows';
  end if;
  r := kofi.search_artworks('{"query":"education access"}');
  if not (current_setting('kofi_test.edu')::uuid = any (kofi_test.ids(r))) then
    raise exception 'FAIL: the query searches the id''s words (as filters.ts does), not the label';
  end if;
  raise notice 'ok: P0 — after the relabel the work is still found by tag id (and by the id''s words); labels never stored on the work';
end $$;
rollback;

-- ================== P0: Painting OR Drawing plus Social Impact = Education Access
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare
  v_id uuid;
begin
  v_id := kofi.save_artwork(kofi_test.work('{"title":"Lessons","medium":"drawing","tagIds":["social_impact.education_access"]}'), kofi_test.image());
  perform set_config('kofi_test.edu_drawing', v_id::text, true);
  v_id := kofi.save_artwork(kofi_test.work('{"title":"Blackboard","medium":"painting","tagIds":["style.abstract"]}'), kofi_test.image());
  perform set_config('kofi_test.paint_no_edu', v_id::text, true);
end $$;
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$
declare
  v_id uuid;
begin
  v_id := kofi.save_artwork(kofi_test.work('{"title":"Schoolyard","medium":"sculpture","materials":["bronze"],"tagIds":["social_impact.education_access"]}'), kofi_test.image());
  perform set_config('kofi_test.sculpt_edu', v_id::text, true);
end $$;
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare
  r jsonb;
  f jsonb := '{"tags":{"medium":["medium.painting","medium.drawing"],"social_impact":["social_impact.education_access"]}}';
begin
  r := kofi.search_artworks(f);
  if kofi_test.ids(r) <> array[current_setting('kofi_test.edu_drawing')::uuid] or (r ->> 'total')::int <> 1 then
    raise exception 'FAIL: (Painting OR Drawing) AND Education Access should return only the drawing: %', kofi_test.ids(r);
  end if;
  -- facets: medium counts ignore the medium filter (the sculpture is offered), Social Impact counts respect it
  if (r -> 'facets' ->> 'medium.drawing')::int <> 1 or (r -> 'facets' ->> 'medium.sculpture')::int <> 1 or r -> 'facets' ? 'medium.painting'
     or (r -> 'facets' ->> 'social_impact.education_access')::int <> 1 then
    raise exception 'FAIL: facets should follow tagFacets() (own category ignored, AND across): %', r -> 'facets';
  end if;
  r := kofi.search_artworks('{"tags":{"medium":["medium.painting","medium.drawing"]}}');
  if not (current_setting('kofi_test.paint_no_edu')::uuid = any (kofi_test.ids(r)) and current_setting('kofi_test.edu_drawing')::uuid = any (kofi_test.ids(r)))
     or current_setting('kofi_test.sculpt_edu')::uuid = any (kofi_test.ids(r)) then
    raise exception 'FAIL: Painting OR Drawing alone should include both new 2D works and not the sculpture';
  end if;
  r := kofi.search_artworks('{"tags":{"medium":[],"style":["theme.joy"]}}');
  if (r ->> 'total')::int <> (kofi.search_artworks('{}') ->> 'total')::int then
    raise exception 'FAIL: empty buckets and ids under the wrong category are ignored (matchesTags)';
  end if;
  raise notice 'ok: P0 — Painting OR Drawing plus Social Impact = Education Access returns only the drawing; facets ignore their own category and AND the others';
end $$;
rollback;

-- ===================================== P0: 24 in appears in the cm range =====
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare
  v_id uuid;
begin
  v_id := kofi.save_artwork(kofi_test.work('{"title":"Twenty-four","dimensions":{"height":24,"width":18,"unit":"in"}}'), kofi_test.image());
  perform set_config('kofi_test.in24', v_id::text, true);
end $$;
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare
  v uuid := current_setting('kofi_test.in24')::uuid;
begin
  if not (v = any (kofi_test.ids(kofi.search_artworks('{"sizeUnit":"cm","minLongestEdge":60,"maxLongestEdge":62}'))))
     or not (v = any (kofi_test.ids(kofi.search_artworks('{"sizeUnit":"cm","minLongestEdge":60.96,"maxLongestEdge":61}'))))
     or v = any (kofi_test.ids(kofi.search_artworks('{"sizeUnit":"cm","maxLongestEdge":60.9}')))
     or not (v = any (kofi_test.ids(kofi.search_artworks('{"sizeUnit":"in","minLongestEdge":24,"maxLongestEdge":24}'))))
     or not (v = any (kofi_test.ids(kofi.search_artworks('{"maxLongestEdge":61}')))) then
    raise exception 'FAIL: a 24 x 18 in work should match 60–62 cm and 60.96–61 cm (61.0 after rounding), not "up to 60.9 cm", and 24 in exactly';
  end if;
  if (select orientation from kofi.artworks_visible where id = v) <> 'portrait' then
    raise exception 'FAIL: 24 x 18 in is portrait';
  end if;
  raise notice 'ok: P0 — a 24 in work appears in the equivalent centimetre range (longest edge 61.0 cm), and at 24 in';
end $$;
rollback;

-- ======================== P0: a visitor never gets a withheld price ==========
-- Doubling (30…11) is priced 9800 USD, visible to verified institutions only.
begin;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare
  w constant uuid := '30000000-0000-4000-8000-000000000011';
  r jsonb;
  row jsonb;
begin
  r := kofi.search_artworks('{}');
  select x into row from jsonb_array_elements(r -> 'rows') x where (x ->> 'id')::uuid = w;
  if row is null or row -> 'price_amount' <> 'null'::jsonb or row -> 'price_currency' <> 'null'::jsonb or row -> 'price_withheld' <> 'true'::jsonb then
    raise exception 'FAIL: search rows must carry no price for a withheld price (got %)', row;
  end if;
  if strpos(r::text, '9800') > 0 then
    raise exception 'FAIL: the withheld amount appears somewhere in the visitor''s search response';
  end if;
  -- the budget filter cannot be used as an oracle: bounds that bracket the hidden price behave like bounds that do not
  if w = any (kofi_test.ids(kofi.search_artworks('{"budgetMin":9800,"budgetMax":9800,"budgetCurrency":"USD"}')))
     or (kofi.search_artworks('{"budgetMin":9800,"budgetMax":9800}') -> 'facets') <> (kofi.search_artworks('{"budgetMin":9799,"budgetMax":9799}') -> 'facets')
     or (kofi.search_artworks('{"budgetMin":9800,"budgetMax":9800}') -> 'total') <> (kofi.search_artworks('{"budgetMin":9799,"budgetMax":9799}') -> 'total') then
    raise exception 'FAIL: a budget around the withheld price changed the visitor''s rows, total or facets';
  end if;
  r := kofi.search_artworks('{"budgetMax":100,"includeUndisclosedPrice":true}');
  select x into row from jsonb_array_elements(r -> 'rows') x where (x ->> 'id')::uuid = w;
  if row is null or row -> 'price_amount' <> 'null'::jsonb then
    raise exception 'FAIL: "include undisclosed prices" keeps the work, still without its price';
  end if;
  perform kofi_test.expect_error($q$select kofi.match_works('a2000000-0000-4000-8000-000000000005')$q$, '42501');
  perform kofi_test.expect_error($q$select price_amount from kofi.artworks$q$, '42501');
  perform kofi_test.expect_error($q$select location from kofi.artworks$q$, '42501');
  raise notice 'ok: P0 — a visitor never gets the withheld price: not in rows, totals or facets, the budget filter is not an oracle; match_works and the base columns are closed';
end $$;
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated"}';
do $$
declare
  w constant uuid := '30000000-0000-4000-8000-000000000011';
begin
  if not (w = any (kofi_test.ids(kofi.search_artworks('{"budgetMin":9800,"budgetMax":9800,"budgetCurrency":"USD"}'))))
     or (select price_amount from kofi.match_works('a2000000-0000-4000-8000-000000000005') where id = w) <> 9800 then
    raise exception 'FAIL: Lena (verified institution) may see the price, so her budget filter and matching rows include it';
  end if;
  raise notice 'ok: a verified curator, who may see the price, finds the work by budget and sees the price in matching rows';
end $$;
rollback;

-- ===================== P0: not for sale, but available for exhibition ========
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare
  v_id uuid;
begin
  v_id := kofi.save_artwork(kofi_test.work('{"title":"Keeper","status":"not for sale","uses":{"exhibition":true}}'), kofi_test.image());
  if (select status from kofi.artworks where id = v_id) <> 'not for sale'
     or (select uses from kofi.artworks where id = v_id) <> '{"auction": false, "exhibition": true, "licensing": false, "commission": false}' then
    raise exception 'FAIL: status and uses are separate fields';
  end if;
  perform set_config('kofi_test.nfs', v_id::text, true);
end $$;
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare
  r jsonb := kofi.search_artworks('{"statuses":["not for sale"],"uses":["exhibition"]}');
begin
  if not (current_setting('kofi_test.nfs')::uuid = any (kofi_test.ids(r)))
     or current_setting('kofi_test.nfs')::uuid = any (kofi_test.ids(kofi.search_artworks('{"uses":["auction","licensing"]}'))) then
    raise exception 'FAIL: a not-for-sale work available for exhibition should match status + uses, and not other uses';
  end if;
  raise notice 'ok: P0 — a work can be not for sale and available for exhibition; uses filter = at least one of the chosen uses';
end $$;
rollback;

-- ===================== P0: an institution cannot edit an artwork =============
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated"}';
do $$
begin
  update kofi.artworks set title = 'Edited by a museum', tag_ids = '{style.abstract}' where id = '30000000-0000-4000-8000-000000000011';
  if (select title from kofi.artworks where id = '30000000-0000-4000-8000-000000000011') <> 'Doubling (Liberty Avenue, 7:40pm)' then
    raise exception 'FAIL: a partner curator edited an artist''s work';
  end if;
  perform kofi_test.expect_error(format('select kofi.save_artwork(%L, %L)', kofi_test.work('{"id":"30000000-0000-4000-8000-000000000011"}'), kofi_test.image()),
    '42501', null, 'Sign in as an artist to do this.');
end $$;
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}';
do $$
begin
  update kofi.artworks set uses = '{"auction": true, "exhibition": true, "licensing": true, "commission": true}' where id = '30000000-0000-4000-8000-000000000011';
  perform kofi_test.expect_error(format('select kofi.save_artwork(%L, %L)', kofi_test.work('{"id":"30000000-0000-4000-8000-000000000011","tagIds":["style.abstract"]}'), kofi_test.image()),
    '42501', null, 'You can only edit your own work.');
end $$;
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$
begin
  perform kofi_test.expect_error($q$update kofi.artworks set tag_ids = '{style.abstract}' where id = '30000000-0000-4000-8000-000000000011'$q$,
    '42501', null, 'Kofi staff can only mark work as reviewed.');
end $$;
reset role;
do $$
begin
  if (select (title, tag_ids, uses) from kofi.artworks where id = '30000000-0000-4000-8000-000000000011')
     is distinct from ('Doubling (Liberty Avenue, 7:40pm)'::text,
                       array['medium.painting', 'style.expressionism', 'style.figurative', 'subject.urban_life', 'theme.memory', 'material.oil', 'palette.warm'],
                       '{"auction": true, "exhibition": true, "licensing": false, "commission": false}'::jsonb) then
    raise exception 'FAIL: Doubling changed';
  end if;
  raise notice 'ok: P0 — a partner institution, another artist and Kofi staff cannot change an artist''s title, tags or uses';
end $$;
rollback;

-- ======================= save_artwork(): v6 fields (cleanArtworkV6) ==========
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare
  v_id uuid;
  w kofi.artworks_visible%rowtype;
  v jsonb := kofi_test.work('{"title":"Three subjects","tagIds":["subject.people","subject.urban_life","subject.architecture"," style.abstract ","style.abstract","acquisition.auction","nope.x"],
     "uses":{"auction":true},"tags":["  night  walk ","Night walk","rain"],
     "edition":{"type":"limited","number":2,"size":5},"location":{"city":" Erie ","region":"Pennsylvania","country":"United States"}}');
begin
  v_id := kofi.save_artwork(v, kofi_test.image());
  select * into w from kofi.artworks_visible where id = v_id;
  if w.tag_ids <> array['medium.painting', 'style.abstract', 'subject.people', 'subject.urban_life', 'subject.architecture']
     and w.tag_ids <> (select array_agg(id order by position) from kofi.tags where id in ('medium.painting', 'style.abstract', 'subject.people', 'subject.urban_life', 'subject.architecture')) then
    raise exception 'FAIL: tag ids normalised (3 subjects kept, medium mirrored, library order, hidden / unknown dropped): %', w.tag_ids;
  end if;
  if cardinality(array(select x from unnest(w.tag_ids) x where x like 'subject.%')) <> 3 then
    raise exception 'FAIL: P0 — an artist can save 3+ values in a category';
  end if;
  if w.uses <> '{"auction": true, "exhibition": false, "licensing": false, "commission": false}' or w.tags <> array['night walk', 'rain']
     or w.edition <> '{"type": "limited", "number": 2, "size": 5}' or w.location <> '{"city": "Erie", "region": "Pennsylvania", "country": "United States", "precision": "city"}' then
    raise exception 'FAIL: uses default false, keywords cleaned (trim, collapse, case-insensitive repeats), edition and location stored clean: % % % %', w.uses, w.tags, w.edition, w.location;
  end if;
  -- an older client that sends no tagIds / uses / edition / location keeps them
  perform kofi.save_artwork(kofi_test.work(jsonb_build_object('id', v_id, 'title', 'Renamed')), kofi_test.image());
  select * into w from kofi.artworks_visible where id = v_id;
  if cardinality(w.tag_ids) <> 5 or w.uses -> 'auction' <> 'true' or w.edition is null or w.location is null then
    raise exception 'FAIL: keys the client leaves out keep the stored value';
  end if;
  -- a new medium without new tags: the old mirror goes (cleanArtworkV6)
  perform kofi.save_artwork(kofi_test.work(jsonb_build_object('id', v_id, 'medium', 'drawing', 'edition', null, 'location', null)), kofi_test.image());
  select * into w from kofi.artworks_visible where id = v_id;
  if 'medium.painting' = any (w.tag_ids) or not ('medium.drawing' = any (w.tag_ids)) or w.edition is not null or w.location is not null then
    raise exception 'FAIL: medium change drops the old mirror; edition / location null clears them: % % %', w.tag_ids, w.edition, w.location;
  end if;
  -- a unique work keeps no number / size; an open edition no size
  perform kofi.save_artwork(kofi_test.work(jsonb_build_object('id', v_id, 'edition', '{"type":"unique","number":3,"size":9}'::jsonb)), kofi_test.image());
  if (select edition from kofi.artworks where id = v_id) <> '{"type": "unique"}' then
    raise exception 'FAIL: a unique work carries neither number nor size';
  end if;
  perform kofi.save_artwork(kofi_test.work(jsonb_build_object('id', v_id, 'edition', '{"type":"open","number":3,"size":"x"}'::jsonb)), kofi_test.image());
  if (select edition from kofi.artworks where id = v_id) <> '{"type": "open", "number": 3}' then
    raise exception 'FAIL: an open edition has no size';
  end if;
  raise notice 'ok: save_artwork — tag ids normalised (3+ in a category saved), uses / keywords / edition / location cleaned like cleanArtworkV6; missing keys keep the stored value; a new medium drops the old mirror';
end $$;
do $$
declare
  s text := 'select kofi.save_artwork(%L, kofi_test.image())';
begin
  perform kofi_test.expect_error(format(s, kofi_test.work('{"tagIds":"style.abstract"}')), '22023', 'tags', 'Tags must be a list.');
  perform kofi_test.expect_error(format(s, kofi_test.work(jsonb_build_object('tagIds', (select jsonb_agg(id) from kofi.tags where category = 'style' and artist_selectable)))), '22023', 'tags.style', 'Pick up to 6 artistic style tags.');
  perform kofi_test.expect_error(format(s, kofi_test.work('{"uses":{"auction":"yes"}}')), '22023', 'uses', 'Choose what the work is available for.');
  perform kofi_test.expect_error(format(s, kofi_test.work('{"uses":null}')), '22023', 'uses', 'Choose what the work is available for.');
  perform kofi_test.expect_error(format(s, kofi_test.work('{"tags":"rain"}')), '22023', 'tags', 'Keywords must be a list of words.');
  perform kofi_test.expect_error(format(s, kofi_test.work(jsonb_build_object('tags', jsonb_build_array(repeat('x', 41))))), '22023', 'tags', 'Keep each keyword under 40 characters.');
  perform kofi_test.expect_error(format(s, kofi_test.work(jsonb_build_object('tags', (select jsonb_agg('k' || i) from generate_series(1, 21) i)))), '22023', 'tags', 'Up to 20 keywords.');
  perform kofi_test.expect_error(format(s, kofi_test.work('{"edition":{"type":"signed"}}')), '22023', 'edition', 'Choose an edition type.');
  perform kofi_test.expect_error(format(s, kofi_test.work('{"edition":"limited"}')), '22023', 'edition', 'Choose an edition type.');
  perform kofi_test.expect_error(format(s, kofi_test.work('{"edition":{"type":"limited","number":0,"size":5}}')), '22023', 'edition', 'The edition number must be a whole number of 1 or more.');
  perform kofi_test.expect_error(format(s, kofi_test.work('{"edition":{"type":"limited","number":2,"size":2.5}}')), '22023', 'edition', 'The edition size must be a whole number of 1 or more.');
  perform kofi_test.expect_error(format(s, kofi_test.work('{"edition":{"type":"limited","number":2}}')), '22023', 'edition', 'Enter how many are in the edition.');
  perform kofi_test.expect_error(format(s, kofi_test.work('{"edition":{"type":"artist_proof","number":6,"size":5}}')), '22023', 'edition', 'The edition number cannot be higher than the edition size.');
  perform kofi_test.expect_error(format(s, kofi_test.work('{"location":"Erie"}')), '22023', 'location', 'Enter where the work is.');
  perform kofi_test.expect_error(format(s, kofi_test.work('{"location":{"city":"Erie"}}')), '22023', 'location', 'Add the region and country where the work is.');
  perform kofi_test.expect_error(format(s, kofi_test.work('{"location":{"region":5,"country":"US"}}')), '22023', 'location', 'Region must be text.');
  perform kofi_test.expect_error(format(s, kofi_test.work(jsonb_build_object('location', jsonb_build_object('city', repeat('x', 121), 'region', 'PA', 'country', 'US')))), '22023', 'location', 'Keep the city under 120 characters.');
  -- direct table writes get the same rules (the trigger and the CHECKs)
  perform kofi_test.expect_error($q$update kofi.artworks set edition = '{"type":"limited","number":9,"size":5}' where id = '30000000-0000-4000-8000-000000000011'$q$,
    '22023', 'edition', 'The edition number cannot be higher than the edition size.');
  perform kofi_test.expect_error($q$update kofi.artworks set uses = '{"auction": true}' where id = '30000000-0000-4000-8000-000000000011'$q$, '23514', null, '%artworks_uses_shape%');
  update kofi.artworks set tag_ids = '{palette.warm, nope.x}' where id = '30000000-0000-4000-8000-000000000012';
  if (select tag_ids from kofi.artworks where id = '30000000-0000-4000-8000-000000000012') <> array['medium.painting', 'palette.warm'] then
    raise exception 'FAIL: a direct write of tag_ids is normalised too';
  end if;
  raise notice 'ok: save_artwork / direct writes refuse bad tags, uses, keywords, editions and locations with the mock''s messages and fields';
end $$;
rollback;

-- ========================= location label at the artist's precision ==========
-- Tobias (…02) shows his region only ('region' precision); a work in Erie stays "Pennsylvania, United States" for others.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$
declare
  v_id uuid;
begin
  v_id := kofi.save_artwork(kofi_test.work('{"title":"Lent to Erie","location":{"city":"Erie","region":"Pennsylvania","country":"United States","precision":"city"}}'), kofi_test.image());
  perform set_config('kofi_test.erie', v_id::text, true);
  if (select location ->> 'city' from kofi.artworks_visible where id = v_id) <> 'Erie' then
    raise exception 'FAIL: the owner reads the full location';
  end if;
end $$;
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare
  r record;
begin
  select * into r from kofi.artworks_visible where id = current_setting('kofi_test.erie')::uuid;
  if r.location_label <> 'Pennsylvania, United States' or r.location is not null then
    raise exception 'FAIL: a visitor sees the work''s location at Tobias''s precision (no city) and never the stored location: % %', r.location_label, r.location;
  end if;
  if (select location_label from kofi.artworks_visible where id = '30000000-0000-4000-8000-000000000012') <> 'Pittsburgh, Pennsylvania'
     or (select location_label from kofi.artworks_visible where id = '30000000-0000-4000-8000-000000000041') <> 'United States' then
    raise exception 'FAIL: without a work location the label is the artist''s region label';
  end if;
  raise notice 'ok: location_label = the work''s location at the artist''s chosen precision (else the artist''s region); the full location is owner / Kofi only';
end $$;
rollback;

-- ================================= search: discovery rules + filters =========
begin;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare
  r jsonb := kofi.search_artworks('{}', 2, 1);
  n int;
begin
  select count(*) into n from kofi.artworks_visible where visibility <> 'private' and visibility <> 'kofi' and artist_status = 'approved';
  if (r ->> 'total')::int <> n or jsonb_array_length(r -> 'rows') <> 2 then
    raise exception 'FAIL: total counts every match; rows are the requested page (total %, expected %)', r ->> 'total', n;
  end if;
  if kofi_test.ids(r) <> (kofi_test.ids(kofi.search_artworks('{}')))[2:3] then
    raise exception 'FAIL: p_offset / p_limit page through the same order';
  end if;
  if exists (select 1 from jsonb_array_elements(kofi.search_artworks('{}') -> 'rows') x where x ->> 'artist_status' <> 'approved' or x ->> 'visibility' in ('private', 'kofi')) then
    raise exception 'FAIL: a visitor''s search includes a draft, a Kofi-only record or a pending artist''s work';
  end if;
  if kofi_test.ids(kofi.search_artworks('{"query":"  LIBERTY "}')) <> array['30000000-0000-4000-8000-000000000011'::uuid]
     or kofi_test.ids(kofi.search_artworks('{"query":"expressionism"}')) <> array['30000000-0000-4000-8000-000000000011'::uuid]
     or kofi_test.ids(kofi.search_artworks('{"orientations":["panoramic"]}')) <> '{}'
     or not ('30000000-0000-4000-8000-000000000041'::uuid = any (kofi_test.ids(kofi.search_artworks('{"editionTypes":["limited"]}'))))
     or (kofi.search_artworks('{"editionTypes":["limited"]}') ->> 'total')::int <> 1
     or (kofi.search_artworks('{"orientations":["three_dimensional"]}') ->> 'total')::int
        <> (select count(*) from kofi.artworks_visible where visibility = 'public' and artist_status = 'approved' and orientation = 'three_dimensional') then
    raise exception 'FAIL: query (title and tag words, trimmed, any case), orientation and edition filters';
  end if;
  if kofi_test.ids(kofi.search_artworks('{"sort":"oldest"}')) = kofi_test.ids(kofi.search_artworks('{"sort":"newest"}'))
     or (kofi.search_artworks('{"sort":"price-asc"}') -> 'rows' -> 0 ->> 'price_amount')::numeric <> 1400 then
    raise exception 'FAIL: sorting';
  end if;
  raise notice 'ok: search — listArtworks discovery rules (no drafts, no Kofi-only, approved artists only), total + paging, query / orientation / edition / sort';
end $$;
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$
begin
  if not ('30000000-0000-4000-8000-000000000013'::uuid = any (kofi_test.ids(kofi.search_artworks('{}'))))
     or not ('30000000-0000-4000-8000-000000000051'::uuid = any (kofi_test.ids(kofi.search_artworks('{}'))))
     or '30000000-0000-4000-8000-000000000033'::uuid = any (kofi_test.ids(kofi.search_artworks('{}'))) then
    raise exception 'FAIL: Kofi''s search includes Kofi-only records and pending artists, never drafts';
  end if;
  raise notice 'ok: Kofi staff search Kofi-only records and pending artists'' works, never an artist''s draft';
end $$;
rollback;

-- ===================================================== match_works() =========
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated"}';
do $$
begin
  if (select count(*) from kofi.match_works('a2000000-0000-4000-8000-000000000005')) <> (kofi.search_artworks('{}') ->> 'total')::int
     or exists (select 1 from kofi.match_works('a2000000-0000-4000-8000-000000000005') m where m.visibility in ('private', 'kofi') or m.artist_status <> 'approved') then
    raise exception 'FAIL: the organiser''s matching set is exactly what her own Works search shows';
  end if;
  perform kofi_test.expect_error($q$select kofi.match_works('a2000000-0000-4000-8000-000000000002')$q$, '42501', null, 'You can only manage calls your institution runs.');
  perform kofi_test.expect_error($q$select kofi.match_works('a2000000-0000-4000-8000-0000000000ff')$q$, '42501', null, 'You can only manage calls your institution runs.');
  raise notice 'ok: match_works — Lena, CMA''s partner, gets her discovery set for the CMA auction; another call is refused';
end $$;
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000007","role":"authenticated"}';
do $$
begin
  perform kofi_test.expect_error($q$select kofi.match_works('a2000000-0000-4000-8000-000000000005')$q$, '42501', null, 'Your institution has not been verified yet.');
end $$;
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
begin
  perform kofi_test.expect_error($q$select kofi.match_works('a2000000-0000-4000-8000-000000000005')$q$, '42501', null, 'You do not have access to this.');
end $$;
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$
begin
  if (select count(*) from kofi.match_works('a2000000-0000-4000-8000-000000000002')) <> (kofi.search_artworks('{}') ->> 'total')::int then
    raise exception 'FAIL: Kofi matches any call against Kofi''s discovery set';
  end if;
  perform kofi_test.expect_error($q$select kofi.match_works('a2000000-0000-4000-8000-0000000000ff')$q$, 'P0002', null, 'Open call not found.');
  raise notice 'ok: match_works — Kofi any call (unknown call: not found); a pending curator, an artist and a visitor are refused';
end $$;
rollback;

-- ============================================ looking_for: write guard ========
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated"}';
do $$
declare
  v_id uuid;
begin
  insert into kofi.open_calls (title, summary, eligibility, opens_on, fee, kind, looking_for)
  values ('CMA spring show', 'A draft from the museum.', 'Artists in Pennsylvania', '2027-03-01', 'No entry fee', 'exhibition',
          '{"tags":{"theme":[" theme.memory ","theme.memory"],"style":[]},"uses":["exhibition","auction","auction"],"region":"  Pennsylvania ","maxLongestEdgeCm":120,"extra":1}')
  returning id into v_id;
  if (select looking_for from kofi.open_calls_visible where id = v_id)
     <> '{"tags": {"theme": ["theme.memory"]}, "uses": ["auction", "exhibition"], "region": "Pennsylvania", "maxLongestEdgeCm": 120}' then
    raise exception 'FAIL: criteria cleaned like cleanCriteria (trim, de-dupe, empty buckets and unknown keys dropped, uses in USE_KEYS order): %', (select looking_for from kofi.open_calls where id = v_id);
  end if;
  update kofi.open_calls set looking_for = '{"tags":{}}' where id = v_id;
  if (select looking_for from kofi.open_calls where id = v_id) is not null then
    raise exception 'FAIL: empty criteria are stored as none';
  end if;
  perform kofi_test.expect_error(format($q$update kofi.open_calls set looking_for = '{"tags":{"theme":["theme.wonder"]}}' where id = %L$q$, v_id), '22023', 'lookingFor', 'One of the tags is not in Kofi' || chr(8217) || 's library.');
  perform kofi_test.expect_error(format($q$update kofi.open_calls set looking_for = '{"tags":{"style":["theme.memory"]}}' where id = %L$q$, v_id), '22023', 'lookingFor', 'Each tag must belong to its category (style).');
  perform kofi_test.expect_error(format($q$update kofi.open_calls set looking_for = '{"tags":{"theme":"theme.memory"}}' where id = %L$q$, v_id), '22023', 'lookingFor', 'Tags must be a list.');
  perform kofi_test.expect_error(format($q$update kofi.open_calls set looking_for = '{"uses":["sale"]}' where id = %L$q$, v_id), '22023', 'lookingFor.uses', 'Choose what the work must be available for.');
  perform kofi_test.expect_error(format($q$update kofi.open_calls set looking_for = %L where id = %L$q$, jsonb_build_object('region', repeat('x', 81)), v_id), '22023', 'lookingFor.region', 'Keep the region under 80 characters.');
  perform kofi_test.expect_error(format($q$update kofi.open_calls set looking_for = '{"minLongestEdgeCm":200,"maxLongestEdgeCm":100}' where id = %L$q$, v_id), '22023', 'lookingFor.minLongestEdgeCm', 'The smallest size cannot be above the largest.');
  perform kofi_test.expect_error(format($q$update kofi.open_calls set looking_for = '{"maxLongestEdgeCm":"big"}' where id = %L$q$, v_id), '22023', 'lookingFor.maxLongestEdgeCm', 'Enter a size in centimetres.');
  perform kofi_test.expect_error(format($q$update kofi.open_calls set looking_for = '{"maxLongestEdgeCm":0}' where id = %L$q$, v_id), '22023', 'lookingFor.maxLongestEdgeCm', 'Enter a size in centimetres.');
  perform kofi_test.expect_error(format($q$update kofi.open_calls set looking_for = %L where id = %L$q$, jsonb_build_object('note', repeat('x', 401)), v_id), '22023', 'lookingFor.note', 'Keep the note under 400 characters.');
  perform kofi_test.expect_error(format($q$update kofi.open_calls set looking_for = %L where id = %L$q$,
    jsonb_build_object('tags', jsonb_build_object('subject', (select jsonb_agg(id) from (select id from kofi.tags where category = 'subject' and artist_selectable order by position limit 13) x))), v_id),
    '22023', 'lookingFor', 'Up to 12 subject matter tags.');
  perform kofi_test.expect_error($q$update kofi.open_calls set looking_for = '{"uses":["auction"]}' where id = 'a2000000-0000-4000-8000-000000000005'$q$,
    '42501', null, 'Kofi has published this call. Ask Kofi to make changes.');
  update kofi.open_calls set looking_for = '{"uses":["licensing"]}' where id = 'a2000000-0000-4000-8000-000000000002';
  if (select looking_for from kofi.open_calls where id = 'a2000000-0000-4000-8000-000000000002') -> 'uses' <> '["exhibition"]' then
    raise exception 'FAIL: a partner changed what a Kofi-run call is looking for';
  end if;
  raise notice 'ok: looking_for — a partner sets criteria on her own draft (cleaned like cleanCriteria, validateCriteria messages); never on a published call or another call';
end $$;
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000008","role":"authenticated"}';
do $$
begin
  update kofi.open_calls set looking_for = '{"tags":{"social_impact":["social_impact.education_access"]},"note":"Schools welcome."}' where id = 'a2000000-0000-4000-8000-000000000004';
  if (select looking_for ->> 'note' from kofi.open_calls_visible where id = 'a2000000-0000-4000-8000-000000000004') <> 'Schools welcome.' then
    raise exception 'FAIL: Kofi sets criteria on any call';
  end if;
  raise notice 'ok: Kofi sets criteria on any call; the public reads them through open_calls_visible';
end $$;
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
begin
  if (select looking_for ->> 'region' from kofi.open_calls_visible where id = 'a2000000-0000-4000-8000-000000000005') <> 'Pennsylvania' then
    raise exception 'FAIL: a visitor reads what a published call is looking for';
  end if;
  perform kofi_test.expect_error($q$update kofi.open_calls set looking_for = null where id = 'a2000000-0000-4000-8000-000000000005'$q$, '42501');
  raise notice 'ok: a visitor reads a published call''s criteria and cannot change them';
end $$;
rollback;

-- ===================================== reviewer rows carry the v6 columns ====
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated"}';
do $$
declare
  r record;
begin
  select * into r from kofi.call_application_works('a2000000-0000-4000-8000-000000000005') limit 1;
  if r.id is null or r.tag_ids is null or r.uses is null or r.orientation is null or r.location_label is null or r.location is not null then
    raise exception 'FAIL: call_application_works() returns the widened row (tags, uses, orientation, location label; never the stored location)';
  end if;
  raise notice 'ok: call_application_works() (0009) returns the v6 columns for reviewers, without the stored location';
end $$;
rollback;

-- ================================================ isolation of 0011 ==========
do $$
begin
  if exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relname in ('tags', 'tag_categories'))
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('search_artworks', 'match_works', 'normalize_tag_ids')) then
    raise exception 'FAIL: 0011 created something in public';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'kofi.tags'::regclass) or not (select relrowsecurity from pg_class where oid = 'kofi.tag_categories'::regclass)
     or has_function_privilege('anon', 'kofi.match_works(uuid)', 'execute') or not has_function_privilege('anon', 'kofi.search_artworks(jsonb, integer, integer)', 'execute')
     or has_function_privilege('authenticated', 'kofi.artworks_taxonomy()', 'execute') or has_function_privilege('authenticated', 'kofi.tags_guard()', 'execute')
     or has_column_privilege('anon', 'kofi.artworks', 'location', 'select') or not has_column_privilege('anon', 'kofi.artworks', 'tag_ids', 'select') then
    raise exception 'FAIL: 0011 privileges (RLS on tags, match_works not for anon, triggers not callable, artworks.location not selectable)';
  end if;
  if (select count(*) from kofi.applied_migrations where name = '0011_taxonomy') <> 1 then
    raise exception 'FAIL: 0011_taxonomy is recorded once';
  end if;
  raise notice 'ok: 0011 objects live in kofi only; RLS on, internals not callable, artworks.location not selectable; recorded once';
end $$;

\echo taxonomy_test.sql: all assertions passed
