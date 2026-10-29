-- =============================================================================
-- Kofi Collections — 0011 taxonomy: controlled tags, filters, call matching
--
-- Mirrors the v6 section of src/domain/types.ts and the pure rules in
-- src/domain/{taxonomy,filters,matching}.ts as the mock data source applies
-- them. Source of truth for the tag library: Kofi's workbook
-- (docs/source/Kofi_Collections_Artwork_Filter_Taxonomy_v1.0_2026-10-27.xlsx →
-- src/domain/taxonomy.data.ts). Needs 0000-0010.
--
--   tag_categories   the workbook's 25 categories (label, phase) plus the order
--                    the artist form / Works filters use them in.
--   tags             the controlled library: stable id (category.slug), label,
--                    definition, artist_selectable, phase, app_addition, and the
--                    governance columns deprecated_at + aliases. Everyone reads;
--                    Kofi admins add and edit (never delete: deprecate). A label
--                    change keeps the old label as an alias. Seeded from the
--                    library by supabase/scripts/generate-taxonomy.mjs (the block
--                    between the GENERATED markers); re-running never overwrites
--                    a label / definition / deprecation / alias edited since.
--   artworks         + tag_ids text[] (stable ids only; the primary medium is
--                    mirrored; GIN-indexed), uses jsonb (the four permitted uses,
--                    separate from status), edition jsonb, location jsonb (where the
--                    work is). artworks_taxonomy normalises tag_ids on every write
--                    exactly like normalizeTagIds(): unknown / non-selectable /
--                    non-MVP / deprecated ids are dropped, the medium is mirrored,
--                    library order, and more than 6 in a category (4 for Social
--                    Impact) is refused with the same message and field.
--   open_calls       + looking_for jsonb (CallCriteria), validated and normalised
--                    by open_calls_criteria_guard with validateCriteria()'s
--                    messages.
--   views            artworks_visible + tag_ids, uses, edition, orientation
--                    (orientationOf()), location_label (the work's location at the
--                    ARTIST's chosen precision, else the artist's region) and
--                    location (owner / Kofi only). open_calls_visible + looking_for.
--                    call_application_works() (0009) returns the same new columns.
--   RPCs             search_artworks(p_filters, p_limit, p_offset): the Works
--                    filters (ArtworkFilters) evaluated in SQL over the caller's
--                    own artworks_visible rows (discovery rules as listArtworks),
--                    with the total and the tag facet counts (tagFacets()).
--                    match_works(p_call): the works a call's organiser / Kofi may
--                    see, for ranking with domain/matching.ts on the client.
--                    save_artwork(): 0005's RPC, now also writing tag_ids / uses /
--                    edition / location (a key the client leaves out is kept).
--
-- Private prices: every new read path (rows, totals, facets, budget filter,
-- matching) runs as the caller over kofi.artworks_visible, whose price columns
-- are already redacted, so a withheld price is never compared, counted or sent.
--
-- Everything is in schema kofi; nothing outside it is created or changed.
-- Idempotent and safe to re-run. Does not undo 0009 / 0010 (it only appends to
-- their views and replaces call_application_works() with the wider row). Never
-- re-run 0003 or 0009 after 0011; if that happens, run 0011 again.
-- Pasted as supabase/apply/0011_part1..n.sql (scripts/split-0011.mjs), then
-- apply/0011_live_patch.sql. See docs/SUPABASE.md §12.
-- =============================================================================

begin;

-- @part prerequisites, pure helpers (filters, dimensions, uses, keywords, edition, location)
-- --------------------------------------------------------- prerequisites ----
do $$
begin
  if to_regclass('kofi.lots') is null or to_regclass('kofi.applied_migrations') is null
     or to_regprocedure('kofi.ensure_my_artist()') is null or to_regprocedure('kofi.call_application_works(uuid)') is null then
    raise exception '0011_taxonomy needs 0009_sales and 0010_intake first (kofi.lots / kofi.ensure_my_artist / kofi.call_application_works missing).';
  end if;
end $$;

-- --------------------------------------------------------- pure helpers -----
-- The string elements of a JSON array (other elements are ignored); NULL when
-- the value is not an array.
create or replace function kofi.json_texts(p jsonb) returns text[]
language sql immutable set search_path = kofi, public as $$
  select case when jsonb_typeof(p) = 'array'
              then array(select e #>> '{}' from jsonb_array_elements(p) with ordinality t (e, o) where jsonb_typeof(e) = 'string' order by o)
         end
$$;

-- A JSON number as float8 (JavaScript's Number), else NULL.
create or replace function kofi.json_float(p jsonb) returns float8
language sql immutable set search_path = kofi, public as $$
  select case when jsonb_typeof(p) = 'number' then (p #>> '{}')::float8 end
$$;

-- norm() from domain/filters.ts: s.trim().toLowerCase().
create or replace function kofi.js_norm(p text) returns text
language sql immutable set search_path = kofi, public as $$
  select lower(regexp_replace(coalesce(p, ''), '^\s+|\s+$', '', 'g'))
$$;

-- round(n, 1) from domain/units.ts: Math.round(n * 10) / 10 (half up, in float8).
create or replace function kofi.js_round1(p float8) returns float8
language sql immutable set search_path = kofi, public as $$
  select floor(p * 10 + 0.5) / 10
$$;

-- toUnit() from domain/units.ts.
create or replace function kofi.to_unit(p_value numeric, p_from kofi.unit, p_to text) returns float8
language sql immutable set search_path = kofi, public as $$
  select case when p_value is null then null
              when p_from::text = p_to then p_value::float8
              when p_from = 'cm' then p_value::float8 / 2.54
              else p_value::float8 * 2.54 end
$$;

-- longestEdge(d, unit) from domain/units.ts: each side converted and rounded to
-- one decimal (convertDimensions), then the largest; no depth counts as 0.
create or replace function kofi.longest_edge(p_height numeric, p_width numeric, p_depth numeric, p_unit kofi.unit, p_to text) returns float8
language sql immutable set search_path = kofi, public as $$
  select greatest(
    kofi.js_round1(kofi.to_unit(p_height, p_unit, p_to)),
    kofi.js_round1(kofi.to_unit(p_width, p_unit, p_to)),
    coalesce(kofi.js_round1(kofi.to_unit(p_depth, p_unit, p_to)), 0))
$$;

-- orientationOf() from domain/taxonomy.ts (float8, as JavaScript computes): a 3D
-- medium, or a depth of at least a fifth of the shorter face edge (a stretcher or a
-- frame is not a third dimension), is three-dimensional; else by width / height.
create or replace function kofi.orientation_of(p_height numeric, p_width numeric, p_depth numeric, p_medium kofi.medium) returns text
language sql immutable set search_path = kofi, public as $$
  select case
    when p_medium in ('sculpture', 'ceramics', 'installation')
      or (p_depth is not null and p_depth > 0 and least(p_height, p_width) > 0
          and p_depth::float8 >= least(p_height, p_width)::float8 / 5) then 'three_dimensional'
    when p_height is null or p_width is null or p_height = 0 or p_width::float8 / p_height::float8 <= 0 then 'square'
    when p_width::float8 / p_height::float8 >= 2 then 'panoramic'
    when p_width::float8 / p_height::float8 > 1.05 then 'landscape'
    when p_width::float8 / p_height::float8 < 0.95 then 'portrait'
    else 'square'
  end
$$;

-- mediumTagId() from domain/taxonomy.ts.
create or replace function kofi.medium_tag_id(p kofi.medium) returns text
language sql immutable set search_path = kofi, public as $$
  select case p
    when 'mixed media' then 'medium.mixed_media'
    when 'digital' then 'medium.digital_art'
    else 'medium.' || p::text
  end
$$;

-- ArtworkUses: exactly the four keys, each a boolean.
create or replace function kofi.uses_ok(p jsonb) returns boolean
language sql immutable set search_path = kofi, public as $$
  select coalesce(jsonb_typeof(p) = 'object'
     and (select array_agg(k order by k) from jsonb_object_keys(p) k) = array['auction', 'commission', 'exhibition', 'licensing']
     and not exists (select 1 from jsonb_each(p) e where jsonb_typeof(e.value) <> 'boolean'), false)
$$;

-- The four uses from a client value: missing / non-true keys are false (NO_USES).
create or replace function kofi.clean_uses(p jsonb) returns jsonb
language sql immutable set search_path = kofi, public as $$
  select jsonb_build_object(
    'auction', coalesce(p -> 'auction' = 'true'::jsonb, false),
    'exhibition', coalesce(p -> 'exhibition' = 'true'::jsonb, false),
    'licensing', coalesce(p -> 'licensing' = 'true'::jsonb, false),
    'commission', coalesce(p -> 'commission' = 'true'::jsonb, false))
$$;

-- The v6 artwork fields as the mock data source cleans them (cleanArtworkV6,
-- cleanUses, cleanKeywords, cleanEdition, cleanLocation in
-- src/data/mock/MockDataSource.ts): same messages, same fields, same order.

-- cleanUses(): an object; a known key present must be a boolean. Message or NULL.
create or replace function kofi.uses_problem(p jsonb) returns text
language sql immutable set search_path = kofi, public as $$
  select case
    when p is null or jsonb_typeof(p) <> 'object'
         or exists (select 1 from jsonb_each(p) e where e.key in ('auction', 'exhibition', 'licensing', 'commission') and jsonb_typeof(e.value) <> 'boolean')
      then 'Choose what the work is available for.'
  end
$$;

-- cleanKeywords(): trimmed, inner spaces collapsed, empties and case-insensitive
-- repeats dropped; each at most 40 characters, at most 20. Raises 22023 / 'tags'.
create or replace function kofi.clean_keywords(p jsonb) returns text[]
language plpgsql immutable set search_path = kofi, public as $$
declare
  v_out text[] := '{}';
  v_seen text[] := '{}';
  t text;
  e jsonb;
begin
  if p is null or jsonb_typeof(p) = 'null' then
    return v_out;
  end if;
  if jsonb_typeof(p) <> 'array' or exists (select 1 from jsonb_array_elements(p) x where jsonb_typeof(x) <> 'string') then
    raise exception 'Keywords must be a list of words.' using errcode = '22023', hint = 'tags';
  end if;
  for e in select x from jsonb_array_elements(p) with ordinality s (x, o) order by o loop
    t := regexp_replace(regexp_replace(e #>> '{}', '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g');
    continue when t = '' or lower(t) = any (v_seen);
    if char_length(t) > 40 then
      raise exception 'Keep each keyword under 40 characters.' using errcode = '22023', hint = 'tags';
    end if;
    v_seen := v_seen || lower(t);
    v_out := v_out || t;
  end loop;
  if cardinality(v_out) > 20 then
    raise exception 'Up to 20 keywords.' using errcode = '22023', hint = 'tags';
  end if;
  return v_out;
end $$;

-- cleanEdition(): problem as (field, message), or no row. NULL = no edition.
create or replace function kofi.edition_problem(p jsonb)
returns table (field text, message text)
language plpgsql immutable set search_path = kofi, public as $$
declare
  v_type text;
  v_num numeric;
  v_size numeric;
begin
  if p is null or jsonb_typeof(p) = 'null' then
    return;
  end if;
  field := 'edition';
  if jsonb_typeof(p) <> 'object' or jsonb_typeof(p -> 'type') is distinct from 'string'
     or (p ->> 'type') not in ('unique', 'limited', 'open', 'artist_proof', 'reproduction') then
    message := 'Choose an edition type.'; return next; return;
  end if;
  v_type := p ->> 'type';
  if v_type = 'unique' then
    return;
  end if;
  if coalesce(jsonb_typeof(p -> 'number'), 'null') <> 'null' and p -> 'number' <> '""'::jsonb then
    v_num := kofi.json_int(p -> 'number');
    if v_num is null or v_num < 1 or v_num > 100000 then
      message := 'The edition number must be a whole number of 1 or more.'; return next; return;
    end if;
  end if;
  if v_type <> 'open' and coalesce(jsonb_typeof(p -> 'size'), 'null') <> 'null' and p -> 'size' <> '""'::jsonb then
    v_size := kofi.json_int(p -> 'size');
    if v_size is null or v_size < 1 or v_size > 100000 then
      message := 'The edition size must be a whole number of 1 or more.'; return next; return;
    end if;
  end if;
  if v_type = 'limited' and v_size is null then
    message := 'Enter how many are in the edition.'; return next; return;
  end if;
  if v_num is not null and v_size is not null and v_num > v_size then
    message := 'The edition number cannot be higher than the edition size.'; return next; return;
  end if;
end $$;

-- The stored edition: {type} for a unique work, no size for an open edition, the
-- numbers as whole numbers; NULL stays NULL. Call after edition_problem().
create or replace function kofi.clean_edition(p jsonb) returns jsonb
language sql immutable set search_path = kofi, public as $$
  select case
    when p is null or jsonb_typeof(p) <> 'object' then null
    when p ->> 'type' = 'unique' then jsonb_build_object('type', 'unique')
    else jsonb_strip_nulls(jsonb_build_object(
      'type', p ->> 'type',
      'number', to_jsonb(kofi.json_int(p -> 'number')::bigint),
      'size', case when p ->> 'type' <> 'open' then to_jsonb(kofi.json_int(p -> 'size')::bigint) end))
  end
$$;

-- optStr() for one location part: (message) or NULL.
create or replace function kofi.location_part_problem(p jsonb, p_label text) returns text
language sql immutable set search_path = kofi, public as $$
  select case
    when p is null or jsonb_typeof(p) = 'null' then null
    when jsonb_typeof(p) <> 'string' then p_label || ' must be text.'
    when char_length(regexp_replace(p #>> '{}', '^\s+|\s+$', '', 'g')) > 120 then 'Keep the ' || lower(p_label) || ' under 120 characters.'
  end
$$;

-- cleanLocation(): problem as (field, message), or no row. NULL / all parts empty = none.
create or replace function kofi.location_problem(p jsonb)
returns table (field text, message text)
language plpgsql immutable set search_path = kofi, public as $$
declare
  v_city text;
  v_region text;
  v_country text;
begin
  if p is null or jsonb_typeof(p) = 'null' then
    return;
  end if;
  field := 'location';
  if jsonb_typeof(p) <> 'object' then
    message := 'Enter where the work is.'; return next; return;
  end if;
  message := coalesce(kofi.location_part_problem(p -> 'city', 'City'), kofi.location_part_problem(p -> 'region', 'Region'),
                      kofi.location_part_problem(p -> 'country', 'Country'));
  if message is not null then
    return next; return;
  end if;
  v_city := nullif(regexp_replace(coalesce(p ->> 'city', ''), '^\s+|\s+$', '', 'g'), '');
  v_region := nullif(regexp_replace(coalesce(p ->> 'region', ''), '^\s+|\s+$', '', 'g'), '');
  v_country := nullif(regexp_replace(coalesce(p ->> 'country', ''), '^\s+|\s+$', '', 'g'), '');
  if v_city is null and v_region is null and v_country is null then
    return;
  end if;
  if v_region is null or v_country is null then
    message := 'Add the region and country where the work is.'; return next; return;
  end if;
end $$;

-- The stored location: trimmed parts, precision as given (else city when there is
-- a city, else region); NULL when nothing is given. Call after location_problem().
create or replace function kofi.clean_location(p jsonb) returns jsonb
language sql immutable set search_path = kofi, public as $$
  select case
    when p is null or jsonb_typeof(p) <> 'object' then null
    when x.city is null and x.region is null and x.country is null then null
    else jsonb_strip_nulls(jsonb_build_object('city', x.city, 'region', x.region, 'country', x.country,
      'precision', case when p ->> 'precision' in ('city', 'region', 'country') then p ->> 'precision'
                        when x.city is not null then 'city' else 'region' end))
  end
  from (select
          nullif(regexp_replace(coalesce(p ->> 'city', ''), '^\s+|\s+$', '', 'g'), '') as city,
          nullif(regexp_replace(coalesce(p ->> 'region', ''), '^\s+|\s+$', '', 'g'), '') as region,
          nullif(regexp_replace(coalesce(p ->> 'country', ''), '^\s+|\s+$', '', 'g'), '') as country) x
$$;

-- Boolean forms for the CHECK constraints (a CHECK cannot hold a subquery): the
-- stored value is clean and has the stored shape.
create or replace function kofi.edition_ok(p jsonb) returns boolean
language sql immutable set search_path = kofi, public as $$
  select p is null or (jsonb_typeof(p) = 'object'
    and not exists (select 1 from kofi.edition_problem(p))
    and not exists (select 1 from jsonb_object_keys(p) k where k not in ('type', 'number', 'size')))
$$;
create or replace function kofi.location_ok(p jsonb) returns boolean
language sql immutable set search_path = kofi, public as $$
  select p is null or (jsonb_typeof(p) = 'object'
    and not exists (select 1 from kofi.location_problem(p))
    and p is not distinct from kofi.clean_location(p))
$$;

-- tag_ids column shape: no NULL elements, every element category.slug, at most 64.
create or replace function kofi.tag_ids_shape_ok(p text[]) returns boolean
language sql immutable set search_path = kofi, public as $$
  select p is not null and array_position(p, null) is null and cardinality(p) <= 64
     and not exists (select 1 from unnest(p) x where x !~ '^[a-z0-9_]+\.[a-z0-9_]+$')
$$;

-- @part call criteria helpers, tag_categories + tags (tables, guard, RLS)
-- cleanCriteria() + validateCriteria() (mock data source / domain/matching.ts): an
-- organiser's "looking for" — unknown keys dropped; tags must be library ids an
-- artist can pick, filed under their own category; uses from USE_KEYS; then the
-- validateCriteria() limits. Problem as (field, message), or no row.
create or replace function kofi.criteria_problem(c jsonb)
returns table (field text, message text)
language plpgsql stable set search_path = kofi, public as $$
declare
  kv record;
  x jsonb;
  k text;
  v float8;
  v_label text;
begin
  if c is null or jsonb_typeof(c) = 'null' then
    return;
  end if;
  if jsonb_typeof(c) <> 'object' then
    field := 'lookingFor'; message := 'The criteria are not valid.'; return next; return;
  end if;
  if coalesce(jsonb_typeof(c -> 'tags'), 'null') <> 'null' then
    if jsonb_typeof(c -> 'tags') <> 'object' then
      field := 'lookingFor'; message := 'Tags must be a list.'; return next; return;
    end if;
    for kv in select e.key, e.value from jsonb_each(c -> 'tags') e loop
      if jsonb_typeof(kv.value) <> 'array' or exists (select 1 from jsonb_array_elements(kv.value) y where jsonb_typeof(y) <> 'string') then
        field := 'lookingFor'; message := 'Tags must be a list.'; return next; return;
      end if;
      for x in select y from jsonb_array_elements(kv.value) with ordinality s (y, o) order by o loop
        k := regexp_replace(x #>> '{}', '^\s+|\s+$', '', 'g');
        if not exists (select 1 from kofi.tags t join kofi.tag_categories tc on tc.id = t.category
                       where t.id = k and t.phase = 'mvp' and t.artist_selectable and t.deprecated_at is null and tc.artist_position is not null) then
          field := 'lookingFor'; message := 'One of the tags is not in Kofi' || chr(8217) || 's library.'; return next; return;
        end if;
        if split_part(k, '.', 1) <> kv.key then
          field := 'lookingFor'; message := format('Each tag must belong to its category (%s).', kv.key); return next; return;
        end if;
      end loop;
    end loop;
  end if;
  if coalesce(jsonb_typeof(c -> 'uses'), 'null') <> 'null'
     and (jsonb_typeof(c -> 'uses') <> 'array'
          or exists (select 1 from jsonb_array_elements(c -> 'uses') u
                     where jsonb_typeof(u) <> 'string' or (u #>> '{}') not in ('auction', 'exhibition', 'licensing', 'commission'))) then
    field := 'lookingFor.uses'; message := 'Choose what the work must be available for.'; return next; return;
  end if;
  if coalesce(jsonb_typeof(c -> 'region'), 'null') <> 'null' then
    if jsonb_typeof(c -> 'region') <> 'string' then
      field := 'lookingFor.region'; message := 'Region must be text.'; return next; return;
    end if;
    if char_length(regexp_replace(c ->> 'region', '^\s+|\s+$', '', 'g')) > 1000 then
      field := 'lookingFor.region'; message := 'Keep the region under 1000 characters.'; return next; return;
    end if;
  end if;
  foreach k in array array['maxLongestEdgeCm', 'minLongestEdgeCm'] loop
    if coalesce(jsonb_typeof(c -> k), 'null') <> 'null' and c -> k <> '""'::jsonb and jsonb_typeof(c -> k) <> 'number' then
      field := 'lookingFor.' || k; message := 'Enter a size in centimetres.'; return next; return;
    end if;
  end loop;
  if coalesce(jsonb_typeof(c -> 'note'), 'null') <> 'null' then
    if jsonb_typeof(c -> 'note') <> 'string' then
      field := 'lookingFor.note'; message := 'Note must be text.'; return next; return;
    end if;
    if char_length(regexp_replace(c ->> 'note', '^\s+|\s+$', '', 'g')) > 10000 then
      field := 'lookingFor.note'; message := 'Keep the note under 10000 characters.'; return next; return;
    end if;
  end if;
  -- validateCriteria() on the cleaned value
  for kv in select e.key, e.value from jsonb_each(coalesce(kofi.clean_criteria(c) -> 'tags', '{}'::jsonb)) e loop
    if jsonb_array_length(kv.value) > 12 then
      select tc.label into v_label from kofi.tag_categories tc where tc.id = kv.key;
      field := 'lookingFor'; message := format('Up to 12 %s tags.', lower(coalesce(v_label, kv.key))); return next; return;
    end if;
  end loop;
  if char_length(coalesce(kofi.clean_criteria(c) ->> 'region', '')) > 80 then
    field := 'lookingFor.region'; message := 'Keep the region under 80 characters.'; return next; return;
  end if;
  foreach k in array array['maxLongestEdgeCm', 'minLongestEdgeCm'] loop
    v := kofi.json_float(c -> k);
    if v is not null and (v <= 0 or v > 100000) then
      field := 'lookingFor.' || k; message := 'Enter a size in centimetres.'; return next; return;
    end if;
  end loop;
  if kofi.json_float(c -> 'minLongestEdgeCm') > kofi.json_float(c -> 'maxLongestEdgeCm') then
    field := 'lookingFor.minLongestEdgeCm'; message := 'The smallest size cannot be above the largest.'; return next; return;
  end if;
  if char_length(coalesce(kofi.clean_criteria(c) ->> 'note', '')) > 400 then
    field := 'lookingFor.note'; message := 'Keep the note under 400 characters.'; return next; return;
  end if;
end $$;

-- The stored criteria (call after criteria_problem()): known keys only; tag ids
-- trimmed and de-duplicated (first kept), empty buckets dropped; uses in USE_KEYS
-- order; trimmed region / note; NULL when nothing is left ("any work").
create or replace function kofi.clean_criteria(c jsonb) returns jsonb
language plpgsql immutable set search_path = kofi, public as $$
declare
  v_out jsonb;
begin
  if c is null or jsonb_typeof(c) <> 'object' then
    return null;
  end if;
  v_out := jsonb_strip_nulls(jsonb_build_object(
    'tags', (select jsonb_object_agg(b.key, b.ids)
             from (select e.key,
                          (select jsonb_agg(to_jsonb(d.x) order by d.o) from (
                             select distinct on (t.x) t.x, t.o
                             from (select regexp_replace(y #>> '{}', '^\s+|\s+$', '', 'g') as x, o
                                   from jsonb_array_elements(e.value) with ordinality s (y, o) where jsonb_typeof(y) = 'string') t
                             order by t.x, t.o) d) as ids
                   from jsonb_each(case when jsonb_typeof(c -> 'tags') = 'object' then c -> 'tags' else '{}'::jsonb end) e
                   where jsonb_typeof(e.value) = 'array') b
             where b.ids is not null),
    'uses', (select jsonb_agg(u.k order by u.n)
             from unnest(array['auction', 'exhibition', 'licensing', 'commission']) with ordinality u (k, n)
             where jsonb_typeof(c -> 'uses') = 'array' and (c -> 'uses') ? u.k),
    'region', case when jsonb_typeof(c -> 'region') = 'string' then to_jsonb(nullif(regexp_replace(c ->> 'region', '^\s+|\s+$', '', 'g'), '')) end,
    'maxLongestEdgeCm', case when jsonb_typeof(c -> 'maxLongestEdgeCm') = 'number' then c -> 'maxLongestEdgeCm' end,
    'minLongestEdgeCm', case when jsonb_typeof(c -> 'minLongestEdgeCm') = 'number' then c -> 'minLongestEdgeCm' end,
    'note', case when jsonb_typeof(c -> 'note') = 'string' then to_jsonb(nullif(regexp_replace(c ->> 'note', '^\s+|\s+$', '', 'g'), '')) end));
  return nullif(v_out, '{}'::jsonb);
end $$;

-- CHECK on the stored value: the clean shape (no library lookup, so deprecating a
-- tag never blocks an unrelated edit of a call that asks for it).
create or replace function kofi.criteria_shape_ok(c jsonb) returns boolean
language sql immutable set search_path = kofi, public as $$
  select c is null or coalesce(
    jsonb_typeof(c) = 'object'
    and c is not distinct from kofi.clean_criteria(c)
    and not exists (select 1 from jsonb_each(coalesce(c -> 'tags', '{}'::jsonb)) e
                    where jsonb_array_length(e.value) > 12
                       or exists (select 1 from jsonb_array_elements_text(e.value) x where x !~ '^[a-z0-9_]+\.[a-z0-9_]+$' or split_part(x, '.', 1) <> e.key))
    and char_length(coalesce(c ->> 'region', '')) <= 80
    and char_length(coalesce(c ->> 'note', '')) <= 400
    and coalesce(kofi.json_float(c -> 'maxLongestEdgeCm') > 0 and kofi.json_float(c -> 'maxLongestEdgeCm') <= 100000, true)
    and coalesce(kofi.json_float(c -> 'minLongestEdgeCm') > 0 and kofi.json_float(c -> 'minLongestEdgeCm') <= 100000, true)
    and coalesce(kofi.json_float(c -> 'minLongestEdgeCm') <= kofi.json_float(c -> 'maxLongestEdgeCm'), true), false)
$$;

-- ------------------------------------------------------ tag_categories ------
create table if not exists kofi.tag_categories (
  id text primary key constraint tag_categories_id_format check (id ~ '^[a-z0-9_]+$'),
  label text not null constraint tag_categories_label_required check (char_length(btrim(label)) between 1 and 120),
  ui text not null default '',
  source text not null default '',
  belongs_to text not null default '',
  phase text not null constraint tag_categories_phase_known check (phase in ('mvp', 'phase2', 'phase3')),
  note text not null default '',
  -- ARTIST_TAG_CATEGORIES / FILTER_TAG_CATEGORIES order (NULL = not on the form / not a filter).
  artist_position integer,
  filter_position integer,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- tags ------
create table if not exists kofi.tags (
  id text primary key constraint tags_id_format check (id ~ '^[a-z0-9_]+\.[a-z0-9_]+$'),
  category text not null references kofi.tag_categories (id),
  label text not null constraint tags_label_required check (char_length(btrim(label)) between 1 and 120),
  definition text not null default '' constraint tags_definition_length check (char_length(definition) <= 600),
  artist_selectable boolean not null default false,
  phase text not null constraint tags_phase_known check (phase in ('mvp', 'phase2', 'phase3')),
  app_addition boolean not null default false,
  deprecated_at timestamptz,
  aliases text[] not null default '{}' constraint tags_aliases_shape check (array_position(aliases, null) is null and cardinality(aliases) <= 20),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tags_id_in_category check (split_part(id, '.', 1) = category)
);
create index if not exists tags_category_idx on kofi.tags (category, position);

drop trigger if exists tag_categories_touch on kofi.tag_categories;
create trigger tag_categories_touch before update on kofi.tag_categories for each row execute function kofi.touch_updated_at();
drop trigger if exists tags_touch on kofi.tags;
create trigger tags_touch before update on kofi.tags for each row execute function kofi.touch_updated_at();

-- Governance: an id never changes (it is what works store); a relabel keeps the
-- old label as an alias, so "old tag ID continues to resolve after relabeling".
create or replace function kofi.tags_guard() returns trigger
language plpgsql set search_path = kofi, public as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.category is distinct from old.category then
      raise exception 'A tag id never changes. Add a new tag and deprecate this one.' using errcode = '22023', hint = 'id';
    end if;
    if new.label is distinct from old.label and not (old.label = any (new.aliases)) then
      new.aliases := new.aliases || old.label;
    end if;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
revoke all on function kofi.tags_guard() from public, anon, authenticated;
drop trigger if exists tags_guard on kofi.tags;
create trigger tags_guard before insert or update on kofi.tags for each row execute function kofi.tags_guard();

alter table kofi.tag_categories enable row level security;
alter table kofi.tags enable row level security;
revoke all on kofi.tag_categories, kofi.tags from anon, authenticated;
grant select on kofi.tag_categories, kofi.tags to anon, authenticated;
-- Kofi admins add and edit tags (RLS); no deletes through the API (deprecate instead).
grant insert (id, category, label, definition, artist_selectable, phase, app_addition, deprecated_at, aliases, position) on kofi.tags to authenticated;
grant update (label, definition, artist_selectable, phase, deprecated_at, aliases, position) on kofi.tags to authenticated;
grant all on kofi.tag_categories, kofi.tags to service_role;

drop policy if exists tag_categories_select on kofi.tag_categories;
create policy tag_categories_select on kofi.tag_categories for select to anon, authenticated using (true);
drop policy if exists tags_select on kofi.tags;
create policy tags_select on kofi.tags for select to anon, authenticated using (true);
drop policy if exists tags_insert_admin on kofi.tags;
create policy tags_insert_admin on kofi.tags for insert to authenticated with check (kofi.is_admin());
drop policy if exists tags_update_admin on kofi.tags;
create policy tags_update_admin on kofi.tags for update to authenticated using (kofi.is_admin()) with check (kofi.is_admin());

-- @part tag library seed (generated)
-- ------------------------------------------------------- library seed -------
-- BEGIN GENERATED TAXONOMY (supabase/scripts/generate-taxonomy.mjs) — do not edit by hand
-- 25 categories and 174 tags (2 app additions) from src/domain/taxonomy.data.ts.
insert into kofi.tag_categories (id, label, ui, source, belongs_to, phase, note, artist_position, filter_position, position) values
  ('medium', 'Art Medium', 'Multi-select chips', 'Controlled tags', 'Artwork', 'mvp', 'Allow multiple processes/media.', 1, 1, 1),
  ('style', 'Artistic Style', 'Multi-select chips', 'Controlled tags', 'Artwork', 'mvp', 'Artist-selected; avoid auto-inference.', 2, 2, 2),
  ('subject', 'Subject Matter', 'Multi-select chips', 'Controlled tags', 'Artwork', 'mvp', 'Literal depicted subject, separate from conceptual themes.', 3, 3, 3),
  ('theme', 'Themes & Concepts', 'Multi-select chips', 'Controlled tags', 'Artwork', 'mvp', 'Narrative and conceptual topics.', 4, 4, 4),
  ('social_impact', 'Social Impact', 'Multi-select chips', 'Controlled tags', 'Artwork', 'mvp', 'Artist-declared focus of artwork; not a claim that results were achieved.', 5, 5, 5),
  ('material', 'Materials', 'Multi-select chips', 'Controlled tags', 'Artwork', 'mvp', 'Physical materials or production techniques.', 6, 6, 6),
  ('palette', 'Color Palette', 'Multi-select chips', 'Controlled tags', 'Artwork', 'mvp', 'Optional manual palette tags; colors can overlap.', 7, 7, 7),
  ('orientation', 'Artwork Orientation', 'Single-select', 'Controlled choice / derived', 'Artwork', 'mvp', 'Derived from dimensions for 2D work when appropriate.', null, null, 8),
  ('size', 'Artwork Size', 'Range + optional size bands', 'Numeric dimensions', 'Artwork', 'mvp', 'Use physical dimensions with units; do not rely solely on S/M/L.', null, null, 9),
  ('price', 'Price Range', 'Min/max currency inputs', 'Numeric', 'Artwork', 'mvp', 'Currency value stored separately; respect unpublished pricing.', null, null, 10),
  ('availability', 'Availability', 'Multi-select status and use flags', 'Artwork status / booleans', 'Artwork', 'mvp', 'Separate inventory status (available/sold) from permitted uses.', null, null, 11),
  ('edition', 'Edition Type', 'Single-select', 'Controlled choice', 'Artwork', 'mvp', 'Use edition size and number as additional structured fields.', null, null, 12),
  ('year_created', 'Creation Year', 'From/to year', 'Integer', 'Artwork', 'mvp', 'Store numeric year; display preset ranges as UI shortcuts.', null, null, 13),
  ('location', 'Artwork Location', 'City / region lookup', 'Structured address region', 'Artwork', 'mvp', 'Artwork location not automatically artist''s location.', null, null, 14),
  ('display_format', 'Display Format', 'Multi-select chips', 'Controlled tags', 'Artwork', 'mvp', 'Suitability and mounting requirements.', 8, 8, 15),
  ('acquisition', 'Acquisition Method', 'Multi-select chips', 'Controlled tags', 'Artwork', 'phase2', 'Ways work can be acquired, not a guaranteed availability.', null, null, 16),
  ('auction_eligibility', 'Auction Eligibility', 'Multi-select chips', 'Controlled tags / fields', 'Artwork', 'phase2', 'Consignment status, bidding terms and reserve as distinct fields.', null, null, 17),
  ('artist_experience', 'Artist Experience', 'Multi-select chips', 'Artist profile structured records', 'Artist', 'phase2', 'Filter artist history, not artwork tags.', null, null, 18),
  ('acquisition_budget', 'Acquisition Budget', 'Total-cost range', 'Numeric derived', 'Artwork / Transaction', 'phase2', 'Price plus shipping, framing and installation when known.', null, null, 19),
  ('production_timeline', 'Production Timeline', 'Single-select + estimate', 'Controlled choice / duration', 'Artwork', 'phase2', 'Ready, work-in-progress, made-to-order.', null, null, 20),
  ('logistics', 'Shipping & Logistics', 'Multi-select chips', 'Controlled tags', 'Artwork', 'phase2', 'Local pickup, shipping and installation capabilities.', null, null, 21),
  ('rights', 'Rights & Licensing', 'Multi-select chips', 'Permission fields', 'Artwork', 'phase2', 'Consent/license requirements; ownership remains with artist unless assigned.', null, null, 22),
  ('curatorial', 'Curatorial Classification', 'Multi-select chips', 'Curator-approved tags', 'Artwork', 'phase2', 'Curator assessment; keep separate from artist-submitted tags.', null, null, 23),
  ('documentation', 'Documentation', 'Multi-select chips', 'Document attachment flags', 'Artwork', 'phase2', 'Certificate, provenance and condition report.', null, null, 24),
  ('impact_evidence', 'Impact Documentation', 'Multi-select + optional outcome data', 'Verified evidence / records', 'Artwork / Opportunity', 'phase3', 'Separate intentions and social-issue tags from verified results.', null, null, 25)
on conflict (id) do update set label = excluded.label, ui = excluded.ui, source = excluded.source, belongs_to = excluded.belongs_to,
  phase = excluded.phase, note = excluded.note, artist_position = excluded.artist_position, filter_position = excluded.filter_position, position = excluded.position
where (kofi.tag_categories.label, kofi.tag_categories.ui, kofi.tag_categories.source, kofi.tag_categories.belongs_to, kofi.tag_categories.phase, kofi.tag_categories.note,
       kofi.tag_categories.artist_position, kofi.tag_categories.filter_position, kofi.tag_categories.position)
  is distinct from (excluded.label, excluded.ui, excluded.source, excluded.belongs_to, excluded.phase, excluded.note,
                    excluded.artist_position, excluded.filter_position, excluded.position);

-- tags 1-126 of 174
insert into kofi.tags (id, category, label, definition, artist_selectable, phase, app_addition, position) values
  ('medium.painting', 'medium', 'Painting', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 1),
  ('medium.photography', 'medium', 'Photography', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 2),
  ('medium.sculpture', 'medium', 'Sculpture', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 3),
  ('medium.drawing', 'medium', 'Drawing', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 4),
  ('medium.printmaking', 'medium', 'Printmaking', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 5),
  ('medium.digital_art', 'medium', 'Digital Art', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 6),
  ('medium.mixed_media', 'medium', 'Mixed Media', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 7),
  ('medium.textile', 'medium', 'Textile', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 8),
  ('medium.ceramics', 'medium', 'Ceramics', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 9),
  ('medium.collage', 'medium', 'Collage', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 10),
  ('medium.film', 'medium', 'Film', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 11),
  ('medium.installation', 'medium', 'Installation', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 12),
  ('medium.glass_art', 'medium', 'Glass Art', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 13),
  ('medium.woodwork', 'medium', 'Woodwork', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 14),
  ('style.abstract', 'style', 'Abstract', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 15),
  ('style.realism', 'style', 'Realism', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 16),
  ('style.surrealism', 'style', 'Surrealism', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 17),
  ('style.contemporary', 'style', 'Contemporary', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 18),
  ('style.minimalism', 'style', 'Minimalism', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 19),
  ('style.expressionism', 'style', 'Expressionism', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 20),
  ('style.impressionism', 'style', 'Impressionism', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 21),
  ('style.pop_art', 'style', 'Pop Art', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 22),
  ('style.conceptual', 'style', 'Conceptual', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 23),
  ('style.street_art', 'style', 'Street Art', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 24),
  ('style.figurative', 'style', 'Figurative', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 25),
  ('style.folk_art', 'style', 'Folk Art', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 26),
  ('subject.portraits', 'subject', 'Portraits', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 27),
  ('subject.landscapes', 'subject', 'Landscapes', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 28),
  ('subject.nature', 'subject', 'Nature', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 29),
  ('subject.architecture', 'subject', 'Architecture', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 30),
  ('subject.people', 'subject', 'People', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 31),
  ('subject.animals', 'subject', 'Animals', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 32),
  ('subject.still_life', 'subject', 'Still Life', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 33),
  ('subject.urban_life', 'subject', 'Urban Life', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 34),
  ('subject.sports', 'subject', 'Sports', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 35),
  ('subject.culture', 'subject', 'Culture', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 36),
  ('subject.history', 'subject', 'History', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 37),
  ('subject.spirituality', 'subject', 'Spirituality', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 38),
  ('subject.identity', 'subject', 'Identity', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 39),
  ('subject.politics', 'subject', 'Politics', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 40),
  ('theme.identity', 'theme', 'Identity', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 41),
  ('theme.heritage', 'theme', 'Heritage', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 42),
  ('theme.community', 'theme', 'Community', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 43),
  ('theme.justice', 'theme', 'Justice', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 44),
  ('theme.equity', 'theme', 'Equity', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 45),
  ('theme.belonging', 'theme', 'Belonging', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 46),
  ('theme.memory', 'theme', 'Memory', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 47),
  ('theme.migration', 'theme', 'Migration', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 48),
  ('theme.resilience', 'theme', 'Resilience', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 49),
  ('theme.joy', 'theme', 'Joy', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 50),
  ('theme.love', 'theme', 'Love', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 51),
  ('theme.environment', 'theme', 'Environment', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 52),
  ('theme.transformation', 'theme', 'Transformation', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 53),
  ('theme.freedom', 'theme', 'Freedom', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 54),
  ('social_impact.arts_accessibility', 'social_impact', 'Arts Accessibility', 'Art removes participation barriers or broadens access to creative experiences.', true, 'mvp', false, 55),
  ('social_impact.civic_participation', 'social_impact', 'Civic Participation', 'Art engages civic life, community decision-making or public dialogue.', true, 'mvp', false, 56),
  ('social_impact.community_building', 'social_impact', 'Community Building', 'Art creates connections, relationships or shared experiences.', true, 'mvp', false, 57),
  ('social_impact.community_health', 'social_impact', 'Community Health', 'Art addresses public wellbeing or community health conditions.', true, 'mvp', false, 58),
  ('social_impact.community_revitalization', 'social_impact', 'Community Revitalization', 'Art engages neighborhood assets, public spaces and community-led development.', true, 'mvp', false, 59),
  ('social_impact.cultural_preservation', 'social_impact', 'Cultural Preservation', 'Art sustains or documents cultural practices, memory and heritage.', true, 'mvp', false, 60),
  ('social_impact.disability_inclusion', 'social_impact', 'Disability Inclusion', 'Art centers disability perspectives or accessible participation.', true, 'mvp', false, 61),
  ('social_impact.economic_mobility', 'social_impact', 'Economic Mobility', 'Art explores or advances fair access to income and economic opportunity.', true, 'mvp', false, 62),
  ('social_impact.education_access', 'social_impact', 'Education Access', 'Art addresses educational opportunity, literacy or learning access.', true, 'mvp', false, 63),
  ('social_impact.environmental_justice', 'social_impact', 'Environmental Justice', 'Art examines unequal environmental burdens and community responses.', true, 'mvp', false, 64),
  ('social_impact.food_security', 'social_impact', 'Food Security', 'Art addresses reliable access to nutritious food and food systems.', true, 'mvp', false, 65),
  ('social_impact.gender_equity', 'social_impact', 'Gender Equity', 'Art explores equity across gender experiences and roles.', true, 'mvp', false, 66),
  ('social_impact.healing_wellbeing', 'social_impact', 'Healing & Wellbeing', 'Art supports reflection, restoration and shared wellbeing.', true, 'mvp', false, 67),
  ('social_impact.housing_stability', 'social_impact', 'Housing Stability', 'Art addresses housing access, displacement or homelessness.', true, 'mvp', false, 68),
  ('social_impact.immigrant_refugee_stories', 'social_impact', 'Immigrant & Refugee Stories', 'Art centers migration, belonging, resettlement or lived experience.', true, 'mvp', false, 69),
  ('social_impact.intergenerational_dialogue', 'social_impact', 'Intergenerational Dialogue', 'Art connects different generations and their experiences.', true, 'mvp', false, 70),
  ('social_impact.lgbtq_inclusion', 'social_impact', 'LGBTQ+ Inclusion', 'Art addresses inclusion, representation or belonging for LGBTQ+ communities.', true, 'mvp', false, 71),
  ('social_impact.mental_health_awareness', 'social_impact', 'Mental Health Awareness', 'Art explores mental health, stigma or support systems.', true, 'mvp', false, 72),
  ('social_impact.peacebuilding', 'social_impact', 'Peacebuilding', 'Art engages nonviolence, conflict transformation or dialogue.', true, 'mvp', false, 73),
  ('social_impact.racial_equity', 'social_impact', 'Racial Equity', 'Art explores structural equity and racialized experiences.', true, 'mvp', false, 74),
  ('social_impact.restorative_justice', 'social_impact', 'Restorative Justice', 'Art engages repair, accountability and community healing.', true, 'mvp', false, 75),
  ('social_impact.social_justice_advocacy', 'social_impact', 'Social Justice Advocacy', 'Art addresses rights, fairness, organizing or public change.', true, 'mvp', false, 76),
  ('social_impact.sustainability', 'social_impact', 'Sustainability', 'Art addresses long-term environmental or resource stewardship.', true, 'mvp', false, 77),
  ('social_impact.workforce_development', 'social_impact', 'Workforce Development', 'Art engages skills-building, career access and paid opportunities.', true, 'mvp', false, 78),
  ('social_impact.youth_empowerment', 'social_impact', 'Youth Empowerment', 'Art centers youth leadership, expression or agency.', true, 'mvp', false, 79),
  ('material.acrylic', 'material', 'Acrylic', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 80),
  ('material.oil', 'material', 'Oil', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 81),
  ('material.watercolor', 'material', 'Watercolor', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 82),
  ('material.ink', 'material', 'Ink', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 83),
  ('material.charcoal', 'material', 'Charcoal', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 84),
  ('material.graphite', 'material', 'Graphite', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 85),
  ('material.pastel', 'material', 'Pastel', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 86),
  ('material.resin', 'material', 'Resin', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 87),
  ('material.clay', 'material', 'Clay', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 88),
  ('material.bronze', 'material', 'Bronze', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 89),
  ('material.wood', 'material', 'Wood', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 90),
  ('material.steel', 'material', 'Steel', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 91),
  ('material.fabric', 'material', 'Fabric', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 92),
  ('material.paper', 'material', 'Paper', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 93),
  ('material.found_objects', 'material', 'Found Objects', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 94),
  ('palette.black_white', 'palette', 'Black & White', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 95),
  ('palette.monochromatic', 'palette', 'Monochromatic', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 96),
  ('palette.neutral', 'palette', 'Neutral', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 97),
  ('palette.earth_tones', 'palette', 'Earth Tones', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 98),
  ('palette.warm', 'palette', 'Warm', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 99),
  ('palette.cool', 'palette', 'Cool', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 100),
  ('palette.pastel', 'palette', 'Pastel', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 101),
  ('palette.vibrant', 'palette', 'Vibrant', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 102),
  ('palette.multicolored', 'palette', 'Multicolored', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 103),
  ('orientation.portrait', 'orientation', 'Portrait', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 104),
  ('orientation.landscape', 'orientation', 'Landscape', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 105),
  ('orientation.square', 'orientation', 'Square', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 106),
  ('orientation.panoramic', 'orientation', 'Panoramic', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 107),
  ('orientation.three_dimensional', 'orientation', 'Three-Dimensional', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 108),
  ('availability.available', 'availability', 'Available', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 109),
  ('availability.reserved', 'availability', 'Reserved', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 110),
  ('availability.sold', 'availability', 'Sold', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 111),
  ('availability.for_auction', 'availability', 'For Auction', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 112),
  ('availability.for_exhibition', 'availability', 'For Exhibition', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 113),
  ('availability.for_licensing', 'availability', 'For Licensing', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 114),
  ('availability.commission_available', 'availability', 'Commission Available', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 115),
  ('availability.not_for_sale', 'availability', 'Not for Sale', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 116),
  ('edition.unique_work', 'edition', 'Unique Work', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 117),
  ('edition.limited_edition', 'edition', 'Limited Edition', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 118),
  ('edition.open_edition', 'edition', 'Open Edition', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 119),
  ('edition.artist_proof', 'edition', 'Artist Proof', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 120),
  ('edition.reproduction', 'edition', 'Reproduction', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 121),
  ('display_format.framed', 'display_format', 'Framed', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 122),
  ('display_format.unframed', 'display_format', 'Unframed', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 123),
  ('display_format.wall_mounted', 'display_format', 'Wall-Mounted', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 124),
  ('display_format.freestanding', 'display_format', 'Freestanding', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 125),
  ('display_format.digital_display', 'display_format', 'Digital Display', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 126)
on conflict (id) do nothing;

-- @part tag library seed (2 of 2)
-- tags 127-174 of 174
insert into kofi.tags (id, category, label, definition, artist_selectable, phase, app_addition, position) values
  ('display_format.site_specific', 'display_format', 'Site-Specific', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 127),
  ('display_format.outdoor_suitable', 'display_format', 'Outdoor Suitable', 'Descriptive tag; artist-selected where appropriate.', true, 'mvp', false, 128),
  ('acquisition.direct_purchase', 'acquisition', 'Direct Purchase', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 129),
  ('acquisition.auction', 'acquisition', 'Auction', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 130),
  ('acquisition.commission', 'acquisition', 'Commission', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 131),
  ('acquisition.rental', 'acquisition', 'Rental', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 132),
  ('acquisition.licensing', 'acquisition', 'Licensing', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 133),
  ('acquisition.institutional_acquisition', 'acquisition', 'Institutional Acquisition', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 134),
  ('auction_eligibility.available_for_consignment', 'auction_eligibility', 'Available for Consignment', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 135),
  ('auction_eligibility.reserve_set', 'auction_eligibility', 'Reserve Set', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 136),
  ('auction_eligibility.no_reserve', 'auction_eligibility', 'No Reserve', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 137),
  ('auction_eligibility.auction_ready', 'auction_eligibility', 'Auction Ready', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 138),
  ('auction_eligibility.pending_approval', 'auction_eligibility', 'Pending Approval', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 139),
  ('artist_experience.exhibitions', 'artist_experience', 'Exhibitions', 'Descriptive tag; artist-selected where appropriate.', false, 'phase2', false, 140),
  ('artist_experience.commissions', 'artist_experience', 'Commissions', 'Descriptive tag; artist-selected where appropriate.', false, 'phase2', false, 141),
  ('artist_experience.public_art', 'artist_experience', 'Public Art', 'Descriptive tag; artist-selected where appropriate.', false, 'phase2', false, 142),
  ('artist_experience.previous_auctions', 'artist_experience', 'Previous Auctions', 'Descriptive tag; artist-selected where appropriate.', false, 'phase2', false, 143),
  ('artist_experience.institutional_collections', 'artist_experience', 'Institutional Collections', 'Descriptive tag; artist-selected where appropriate.', false, 'phase2', false, 144),
  ('artist_experience.teaching_artist', 'artist_experience', 'Teaching Artist', 'Descriptive tag; artist-selected where appropriate.', false, 'phase2', false, 145),
  ('artist_experience.licensing', 'artist_experience', 'Licensing', 'Descriptive tag; artist-selected where appropriate.', false, 'phase2', false, 146),
  ('production_timeline.ready_to_ship', 'production_timeline', 'Ready to Ship', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 147),
  ('production_timeline.work_in_progress', 'production_timeline', 'Work in Progress', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 148),
  ('production_timeline.made_to_order', 'production_timeline', 'Made to Order', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 149),
  ('production_timeline.commission_timeline_required', 'production_timeline', 'Commission Timeline Required', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 150),
  ('logistics.local_pickup', 'logistics', 'Local Pickup', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 151),
  ('logistics.domestic_shipping', 'logistics', 'Domestic Shipping', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 152),
  ('logistics.international_shipping', 'logistics', 'International Shipping', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 153),
  ('logistics.installation_required', 'logistics', 'Installation Required', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 154),
  ('logistics.white_glove_handling', 'logistics', 'White-Glove Handling', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 155),
  ('rights.original_artwork_available', 'rights', 'Original Artwork Available', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 156),
  ('rights.reproduction_rights_available', 'rights', 'Reproduction Rights Available', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 157),
  ('rights.commercial_licensing_available', 'rights', 'Commercial Licensing Available', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 158),
  ('rights.display_permission_available', 'rights', 'Display Permission Available', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 159),
  ('curatorial.exhibition_ready', 'curatorial', 'Exhibition Ready', 'Descriptive tag; artist-selected where appropriate.', false, 'phase2', false, 160),
  ('curatorial.collection_ready', 'curatorial', 'Collection Ready', 'Descriptive tag; artist-selected where appropriate.', false, 'phase2', false, 161),
  ('curatorial.public_art_suitable', 'curatorial', 'Public Art Suitable', 'Descriptive tag; artist-selected where appropriate.', false, 'phase2', false, 162),
  ('curatorial.corporate_display_suitable', 'curatorial', 'Corporate Display Suitable', 'Descriptive tag; artist-selected where appropriate.', false, 'phase2', false, 163),
  ('documentation.certificate_of_authenticity', 'documentation', 'Certificate of Authenticity', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 164),
  ('documentation.provenance_record', 'documentation', 'Provenance Record', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 165),
  ('documentation.edition_documentation', 'documentation', 'Edition Documentation', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 166),
  ('documentation.condition_report', 'documentation', 'Condition Report', 'Descriptive tag; artist-selected where appropriate.', true, 'phase2', false, 167),
  ('impact_evidence.artist_reported_impact', 'impact_evidence', 'Artist-Reported Impact', 'Descriptive tag; artist-selected where appropriate.', false, 'phase3', false, 168),
  ('impact_evidence.community_partner_verified', 'impact_evidence', 'Community Partner Verified', 'Descriptive tag; artist-selected where appropriate.', false, 'phase3', false, 169),
  ('impact_evidence.attendance_reach_documented', 'impact_evidence', 'Attendance / Reach Documented', 'Descriptive tag; artist-selected where appropriate.', false, 'phase3', false, 170),
  ('impact_evidence.paid_engagement_documented', 'impact_evidence', 'Paid Engagement Documented', 'Descriptive tag; artist-selected where appropriate.', false, 'phase3', false, 171),
  ('impact_evidence.evaluation_report_available', 'impact_evidence', 'Evaluation Report Available', 'Descriptive tag; artist-selected where appropriate.', false, 'phase3', false, 172),
  ('medium.performance', 'medium', 'Performance', 'Live or time-based work (added by the app: existing demo works use it).', true, 'mvp', true, 173),
  ('medium.video', 'medium', 'Video', 'Moving image shown on a screen (added by the app; Kofi’s list has Film).', true, 'mvp', true, 174)
on conflict (id) do nothing;

-- END GENERATED TAXONOMY

-- @part artworks + open_calls columns, tag normaliser, guards, backfill
-- ------------------------------------------------------ tag normaliser ------
-- normalizeTagIds() from domain/taxonomy.ts: trim, de-duplicate, drop ids that
-- are unknown, not artist-selectable, not MVP, deprecated or outside the
-- artist's categories; mirror the medium; library order. More than 6 in a
-- category (4 for Social Impact) raises 22023 with the same message and field.
create or replace function kofi.normalize_tag_ids(p_ids text[], p_medium kofi.medium) returns text[]
language plpgsql stable set search_path = kofi, public as $$
declare
  v_out text[];
  r record;
  v_cap integer;
begin
  select coalesce(array_agg(t.id order by t.position, t.id), '{}') into v_out
  from kofi.tags t
  where t.id = kofi.medium_tag_id(p_medium)
     or (t.id in (select regexp_replace(x, '^\s+|\s+$', '', 'g') from unnest(coalesce(p_ids, '{}'::text[])) x where x is not null)
         and t.artist_selectable and t.phase = 'mvp' and t.deprecated_at is null
         and exists (select 1 from kofi.tag_categories c where c.id = t.category and c.artist_position is not null));
  for r in
    select t.category, count(*) as n, min(t.position) as first_pos, c.label
    from kofi.tags t join kofi.tag_categories c on c.id = t.category
    where t.id = any (v_out)
    group by t.category, c.label
    order by min(t.position)
  loop
    v_cap := case when r.category = 'social_impact' then 4 else 6 end;
    if r.n > v_cap then
      raise exception 'Pick up to % % tags.', v_cap, lower(r.label) using errcode = '22023', hint = 'tags.' || r.category;
    end if;
  end loop;
  return v_out;
end $$;

-- ------------------------------------------------- artworks: new columns ----
alter table kofi.artworks add column if not exists tag_ids text[] not null default '{}';
alter table kofi.artworks add column if not exists uses jsonb not null
  default '{"auction": false, "exhibition": false, "licensing": false, "commission": false}'::jsonb;
alter table kofi.artworks add column if not exists edition jsonb;
alter table kofi.artworks add column if not exists location jsonb;

alter table kofi.artworks drop constraint if exists artworks_tag_ids_shape;
alter table kofi.artworks add constraint artworks_tag_ids_shape check (kofi.tag_ids_shape_ok(tag_ids));
alter table kofi.artworks drop constraint if exists artworks_uses_shape;
alter table kofi.artworks add constraint artworks_uses_shape check (kofi.uses_ok(uses));
alter table kofi.artworks drop constraint if exists artworks_edition_shape;
alter table kofi.artworks add constraint artworks_edition_shape check (kofi.edition_ok(edition));
alter table kofi.artworks drop constraint if exists artworks_location_shape;
alter table kofi.artworks add constraint artworks_location_shape check (kofi.location_ok(location));
create index if not exists artworks_tag_ids_gin_idx on kofi.artworks using gin (tag_ids);

-- Every write: tag_ids normalised (INSERT, or an UPDATE that changes tag_ids or
-- the medium); edition / location problems raised with their form field before
-- the CHECKs above would fire. Runs for trusted code too (seeds, demo reset).
create or replace function kofi.artworks_taxonomy() returns trigger
language plpgsql set search_path = kofi, public as $$
declare
  pr record;
begin
  if tg_op = 'INSERT' or new.tag_ids is distinct from old.tag_ids or new.medium is distinct from old.medium then
    new.tag_ids := kofi.normalize_tag_ids(new.tag_ids, new.medium);
  end if;
  if tg_op = 'INSERT' or new.edition is distinct from old.edition then
    select * into pr from kofi.edition_problem(new.edition) limit 1;
    if found then
      raise exception '%', pr.message using errcode = '22023', hint = pr.field;
    end if;
    new.edition := kofi.clean_edition(new.edition);
  end if;
  if tg_op = 'INSERT' or new.location is distinct from old.location then
    select * into pr from kofi.location_problem(new.location) limit 1;
    if found then
      raise exception '%', pr.message using errcode = '22023', hint = pr.field;
    end if;
    new.location := kofi.clean_location(new.location);
  end if;
  return new;
end $$;
revoke all on function kofi.artworks_taxonomy() from public, anon, authenticated;
drop trigger if exists artworks_taxonomy on kofi.artworks;
create trigger artworks_taxonomy before insert or update on kofi.artworks
  for each row execute function kofi.artworks_taxonomy();

-- Works stored before 0011 get their medium as their one tag (migrateState() in
-- mock mode: tagIds = [mediumTagId]; uses stay NO_USES — opt-ins are never
-- guessed). A data fix, not an edit: no audit rows, updated_at unchanged.
do $$
begin
  if exists (select 1 from kofi.artworks where tag_ids = '{}') then
    perform set_config('kofi.seeding', 'on', true);
    alter table kofi.artworks disable trigger artworks_touch;
    update kofi.artworks set tag_ids = kofi.normalize_tag_ids('{}', medium) where tag_ids = '{}';
    alter table kofi.artworks enable trigger artworks_touch;
    perform set_config('kofi.seeding', 'off', true);
  end if;
end $$;

-- Readable like the other work fields. `location` is NOT granted: it is read
-- through artworks_visible (label at the artist's precision; the full value for
-- the owner and Kofi only).
grant select (tag_ids, uses, edition) on kofi.artworks to anon, authenticated;

-- ---------------------------------------------- open_calls: looking_for -----
alter table kofi.open_calls add column if not exists looking_for jsonb;
alter table kofi.open_calls drop constraint if exists open_calls_looking_for_shape;
alter table kofi.open_calls add constraint open_calls_looking_for_shape check (kofi.criteria_shape_ok(looking_for));
grant select (looking_for) on kofi.open_calls to anon, authenticated;
-- Kofi and the call's partner write it (RLS + 0009's guard decide which rows).
grant insert (looking_for), update (looking_for) on kofi.open_calls to authenticated;

create or replace function kofi.open_calls_criteria_guard() returns trigger
language plpgsql set search_path = kofi, public as $$
declare
  pr record;
begin
  if tg_op = 'UPDATE' and new.looking_for is not distinct from old.looking_for then
    return new;
  end if;
  select * into pr from kofi.criteria_problem(new.looking_for) limit 1;
  if found then
    raise exception '%', pr.message using errcode = '22023', hint = pr.field;
  end if;
  new.looking_for := kofi.clean_criteria(new.looking_for);
  return new;
end $$;
revoke all on function kofi.open_calls_criteria_guard() from public, anon, authenticated;
drop trigger if exists open_calls_criteria_guard on kofi.open_calls;
create trigger open_calls_criteria_guard before insert or update on kofi.open_calls
  for each row execute function kofi.open_calls_criteria_guard();

-- @part views: artworks_visible, open_calls_visible, call_application_works, filter helpers
-- ---------------------------------------------------------- read helpers ----
-- locationLabel (projectArtwork): the work's own location at the ARTIST's chosen
-- precision, else the artist's region label; the full location for the owner and
-- Kofi only. No row when the caller may not see the work.
create or replace function kofi.artwork_location(p_artwork_id uuid)
returns table (location_label text, location jsonb)
language sql stable security definer set search_path = kofi, public as $$
  select
    case when w.location is not null
         then kofi.region_label(w.location ->> 'city', w.location ->> 'region', w.location ->> 'country', a.region_precision)
         else kofi.region_label(a.region_city, a.region_region, a.region_country, a.region_precision) end,
    case when w.artist_id = kofi.my_artist_id() or kofi.is_admin() then w.location end
  from kofi.artworks w
  join kofi.artists a on a.id = w.artist_id
  where w.id = p_artwork_id and kofi.artwork_visible(w.id)
$$;

-- ------------------------------------------------------------------ views ---
-- 0003's columns, in order, with the v6 columns appended.
create or replace view kofi.artworks_visible with (security_invoker = true) as
select
  w.id,
  w.artist_id,
  w.title,
  w.year,
  w.medium,
  w.materials,
  w.height,
  w.width,
  w.depth,
  w.unit,
  w.description,
  w.status,
  w.rights_note,
  p.price_amount,
  p.price_currency,
  coalesce(p.price_withheld, false) as price_withheld,
  w.price_visibility,
  w.visibility,
  w.tags,
  w.reviewed_at,
  w.created_at,
  w.updated_at,
  a.working_name as artist_working_name,
  a.career_stage as artist_career_stage,
  a.experience_commissions as artist_experience_commissions,
  a.experience_public_art as artist_experience_public_art,
  a.experience_residencies as artist_experience_residencies,
  a.experience_institutional_shows as artist_experience_institutional_shows,
  a.experience_years_practicing as artist_experience_years_practicing,
  a.status as artist_status,
  a.visibility as artist_visibility,
  (select x.region_label from kofi.artist_extras(w.artist_id) x) as artist_region_label,
  (w.artist_id = kofi.my_artist_id() or kofi.is_admin()) as can_edit,
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', i.id, 'src', i.src, 'alt', i.alt,
        'isPrimary', i.is_primary, 'metadataStripped', i.metadata_stripped
      ) order by i.position, i.created_at
    )
    from kofi.artwork_images i where i.artwork_id = w.id
  ), '[]'::jsonb) as images,
  w.tag_ids,
  w.uses,
  w.edition,
  kofi.orientation_of(w.height, w.width, w.depth, w.medium) as orientation,
  coalesce(l.location_label, '') as location_label,
  l.location
from kofi.artworks w
join kofi.artists a on a.id = w.artist_id
left join lateral kofi.artwork_price(w.id) p on true
left join lateral kofi.artwork_location(w.id) l on true;

-- 0009's view with looking_for appended.
create or replace view kofi.open_calls_visible with (security_invoker = true) as
select
  c.id, c.title, c.partner, c.summary, c.body, c.eligibility, c.mediums, c.opens_on, c.deadline,
  c.max_works, c.fee, c.award, c.image, c.external_url,
  kofi.programme_exhibition_link('open_call', c.id) as exhibition_id,
  c.sample, c.published, c.created_at, c.updated_at,
  c.kind, c.organizer_institution_id, c.terms,
  c.looking_for
from kofi.open_calls c;

-- 0009's reviewer projection, widened to the new artworks_visible row. The
-- location label follows the same rule; the full location is never included.
create or replace function kofi.call_application_works(p_call uuid default null)
returns setof kofi.artworks_visible
language sql stable security definer set search_path = kofi, public as $$
  select
    w.id, w.artist_id, w.title, w.year, w.medium, w.materials, w.height, w.width, w.depth, w.unit,
    w.description, w.status, w.rights_note,
    case when s.price_ok then w.price_amount end,
    case when s.price_ok then w.price_currency end,
    (w.price_amount is not null and not s.price_ok),
    w.price_visibility, w.visibility, w.tags, w.reviewed_at, w.created_at, w.updated_at,
    a.working_name, a.career_stage, a.experience_commissions, a.experience_public_art,
    a.experience_residencies, a.experience_institutional_shows, a.experience_years_practicing,
    'approved'::kofi.artist_status, 'public'::kofi.visibility,
    kofi.region_label(a.region_city, a.region_region, a.region_country, a.region_precision),
    false,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'src', i.src, 'alt', i.alt, 'isPrimary', i.is_primary, 'metadataStripped', i.metadata_stripped
      ) order by i.position, i.created_at)
      from kofi.artwork_images i where i.artwork_id = w.id
    ), '[]'::jsonb),
    w.tag_ids,
    w.uses,
    w.edition,
    kofi.orientation_of(w.height, w.width, w.depth, w.medium),
    case when w.location is not null
         then kofi.region_label(w.location ->> 'city', w.location ->> 'region', w.location ->> 'country', a.region_precision)
         else kofi.region_label(a.region_city, a.region_region, a.region_country, a.region_precision) end,
    null::jsonb
  from kofi.artworks w
  join kofi.artists a on a.id = w.artist_id
  cross join lateral (select kofi.can_see(w.price_visibility, w.artist_id) as price_ok) s
  where kofi.my_verified_institution_id() is not null
    and w.visibility <> 'private'
    and exists (
      select 1 from kofi.applications ap
      join kofi.open_calls c on c.id = ap.call_id
      where w.id = any (ap.artwork_ids) and ap.artist_id = w.artist_id
        and (p_call is null or ap.call_id = p_call)
        and c.organizer_institution_id = kofi.my_verified_institution_id()
    )
$$;
revoke execute on function kofi.call_application_works(uuid) from public, anon;
grant execute on function kofi.call_application_works(uuid) to authenticated;

revoke all on kofi.artworks_visible, kofi.open_calls_visible from anon, authenticated;
grant select on kofi.artworks_visible, kofi.open_calls_visible to anon, authenticated;
revoke all on function kofi.artwork_location(uuid) from public, anon, authenticated;
grant execute on function kofi.artwork_location(uuid) to anon, authenticated;

-- ------------------------------------------------- the Works filters --------
-- matchesFilters() from domain/filters.ts for one artworks_visible row, field by
-- field, in the same order, with the same JavaScript semantics (substring search
-- over the same words, OR within a tag category / AND across, longest edge after
-- unit conversion and one-decimal rounding, budget only against a price this
-- caller may see). p_skip_category drops that category's tags (tagFacets()).
create or replace function kofi.artwork_filter_ok(v kofi.artworks_visible, f jsonb, p_skip_category text default null) returns boolean
language plpgsql stable set search_path = kofi, public as $$
declare
  q text;
  hay text;
  arr text[];
  ids text[];
  kv record;
  v_unit text;
  v_max float8;
  v_min float8;
  v_edge float8;
  v_cur text;
begin
  if f is null or jsonb_typeof(f) <> 'object' then
    return true;
  end if;

  if jsonb_typeof(f -> 'query') = 'string' and kofi.js_norm(f ->> 'query') <> '' then
    q := kofi.js_norm(f ->> 'query');
    hay := lower(concat_ws(' ',
      v.title,
      coalesce(v.artist_working_name, 'Unknown artist'),
      v.medium::text,
      coalesce(v.description, ''),
      nullif(array_to_string(v.materials, ' '), ''),
      nullif(array_to_string(v.tags, ' '), ''),
      (select string_agg(replace(regexp_replace(t.x, '^.*\.', ''), '_', ' '), ' ' order by t.o)
         from unnest(v.tag_ids) with ordinality t (x, o)),
      v.year::text));
    if strpos(hay, q) = 0 then
      return false;
    end if;
  end if;

  arr := kofi.json_texts(f -> 'mediums');
  if cardinality(arr) > 0 and not (v.medium::text = any (arr)) then
    return false;
  end if;

  arr := array(select kofi.js_norm(x) from unnest(coalesce(kofi.json_texts(f -> 'materials'), '{}')) x where kofi.js_norm(x) <> '');
  if cardinality(arr) > 0 and not exists (
       select 1 from unnest(arr) w, unnest(coalesce(v.materials, '{}')) m where strpos(kofi.js_norm(m), w) > 0) then
    return false;
  end if;

  v_max := kofi.json_float(f -> 'maxLongestEdge');
  v_min := kofi.json_float(f -> 'minLongestEdge');
  if v_max is not null or v_min is not null then
    v_unit := case when f ->> 'sizeUnit' = 'in' then 'in' else 'cm' end;
    v_edge := kofi.longest_edge(v.height, v.width, v.depth, v.unit, v_unit);
    if v_max is not null and v_edge > v_max + 1e-9 then
      return false;
    end if;
    if v_min is not null and v_edge < v_min - 1e-9 then
      return false;
    end if;
  end if;

  arr := kofi.json_texts(f -> 'statuses');
  if cardinality(arr) > 0 and not (v.status::text = any (arr)) then
    return false;
  end if;
  arr := kofi.json_texts(f -> 'careerStages');
  if cardinality(arr) > 0 and not (v.artist_career_stage::text = any (arr)) then
    return false;
  end if;

  if jsonb_typeof(f -> 'region') = 'string' and kofi.js_norm(f ->> 'region') <> ''
     and strpos(kofi.js_norm(v.artist_region_label), kofi.js_norm(f ->> 'region')) = 0 then
    return false;
  end if;

  if f -> 'commissionsExperience' = 'true'::jsonb and not coalesce(v.artist_experience_commissions, false) then
    return false;
  end if;
  if f -> 'publicArtExperience' = 'true'::jsonb and not coalesce(v.artist_experience_public_art, false) then
    return false;
  end if;

  v_max := kofi.json_float(f -> 'budgetMax');
  v_min := kofi.json_float(f -> 'budgetMin');
  if v_max is not null or v_min is not null then
    v_cur := upper(case when jsonb_typeof(f -> 'budgetCurrency') = 'string' then f ->> 'budgetCurrency' else 'USD' end);
    -- price_amount / price_currency are NULL here whenever this caller may not see them.
    if v.price_amount is null or coalesce(v.price_currency, '') = '' or upper(v.price_currency) <> v_cur then
      if not coalesce(f -> 'includeUndisclosedPrice' = 'true'::jsonb, false) then
        return false;
      end if;
    else
      if v_max is not null and v.price_amount::float8 > v_max then
        return false;
      end if;
      if v_min is not null and v.price_amount::float8 < v_min then
        return false;
      end if;
    end if;
  end if;

  if jsonb_typeof(f -> 'years') = 'object' then
    if kofi.json_float(f -> 'years' -> 'from') is not null and v.year < kofi.json_float(f -> 'years' -> 'from') then
      return false;
    end if;
    if kofi.json_float(f -> 'years' -> 'to') is not null and v.year > kofi.json_float(f -> 'years' -> 'to') then
      return false;
    end if;
  end if;

  if jsonb_typeof(f -> 'tags') = 'object' then
    for kv in select e.key, e.value from jsonb_each(f -> 'tags') e loop
      continue when kv.key is not distinct from p_skip_category;
      ids := array(select x from unnest(coalesce(kofi.json_texts(kv.value), '{}')) x where split_part(x, '.', 1) = kv.key);
      if cardinality(ids) > 0 and not (coalesce(v.tag_ids, '{}') && ids) then
        return false;
      end if;
    end loop;
  end if;

  arr := kofi.json_texts(f -> 'orientations');
  if cardinality(arr) > 0 and not (v.orientation = any (arr)) then
    return false;
  end if;
  arr := kofi.json_texts(f -> 'editionTypes');
  if cardinality(arr) > 0 and (v.edition is null or not ((v.edition ->> 'type') = any (arr))) then
    return false;
  end if;
  arr := kofi.json_texts(f -> 'uses');
  if cardinality(arr) > 0 and not exists (select 1 from unnest(arr) u where v.uses -> u = 'true'::jsonb) then
    return false;
  end if;

  return true;
end $$;

-- @part RPCs: search_artworks, match_works, save_artwork; records 0011_taxonomy
-- ------------------------------------------------------------------ RPCs ----
-- The Works search. Runs as the caller over kofi.artworks_visible (RLS + the
-- redacted price), with listArtworks()'s discovery rules: never a draft (Only
-- me) record, Kofi-only records and works of artists who are not approved only
-- for Kofi admins. p_filters = ArtworkFilters as JSON. Returns
--   { "rows": [artworks_visible rows, sorted, p_offset / p_limit applied; NULL limit = all],
--     "total": every match,
--     "facets": { tag id: count } — tagFacets(): for each filter category, the
--               matches with that category's own tags left out, counted per tag }.
create or replace function kofi.search_artworks(p_filters jsonb default '{}'::jsonb, p_limit integer default null, p_offset integer default 0)
returns jsonb
language plpgsql stable security invoker set search_path = kofi, public as $$
declare
  f jsonb := case when jsonb_typeof(p_filters) = 'object' then p_filters else '{}'::jsonb end;
  v_admin boolean := kofi.is_admin();
  v_sort text := coalesce(case when jsonb_typeof(f -> 'sort') = 'string' then f ->> 'sort' end, 'newest');
  v_out jsonb;
begin
  if v_sort not in ('newest', 'oldest', 'title', 'size-asc', 'size-desc', 'price-asc', 'price-desc') then
    v_sort := 'newest';
  end if;
  with base as materialized (
    select v as r
    from kofi.artworks_visible v
    where v.visibility <> 'private'
      and (v.visibility <> 'kofi' or v_admin)
      and (v.artist_status = 'approved' or v_admin)
  ),
  hits as materialized (
    select b.r from base b where kofi.artwork_filter_ok(b.r, f, null)
  ),
  -- sortArtworks(): the client re-sorts with the same function; ties end on id.
  ranked as (
    select h.r,
           row_number() over (order by
             case when v_sort = 'newest' then (h.r).year end desc nulls last,
             case when v_sort = 'newest' then (h.r).created_at end desc nulls last,
             case when v_sort = 'oldest' then (h.r).year end asc nulls last,
             case when v_sort = 'oldest' then (h.r).created_at end asc nulls last,
             case when v_sort = 'title' then (h.r).title end asc nulls last,
             case when v_sort = 'size-asc' then kofi.longest_edge((h.r).height, (h.r).width, (h.r).depth, (h.r).unit, 'cm') end asc nulls last,
             case when v_sort = 'size-desc' then kofi.longest_edge((h.r).height, (h.r).width, (h.r).depth, (h.r).unit, 'cm') end desc nulls last,
             case when v_sort = 'price-asc' then (h.r).price_amount end asc nulls last,
             case when v_sort = 'price-desc' then (h.r).price_amount end desc nulls last,
             (h.r).id) as n
    from hits h
  ),
  facet_counts as (
    select t.id, count(*) as n
    from kofi.tag_categories c
    join base b on kofi.artwork_filter_ok(b.r, f, c.id)
    cross join lateral unnest((b.r).tag_ids) as t (id)
    where c.filter_position is not null and split_part(t.id, '.', 1) = c.id
    group by t.id
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(to_jsonb(o.r) order by o.n)
      from (select k.r, k.n from ranked k order by k.n offset greatest(coalesce(p_offset, 0), 0) limit (case when p_limit is null then null else greatest(p_limit, 0) end)) o
    ), '[]'::jsonb),
    'total', (select count(*) from hits),
    'facets', coalesce((select jsonb_object_agg(fc.id, fc.n order by fc.id) from facet_counts fc), '{}'::jsonb))
  into v_out;
  return v_out;
end $$;
revoke all on function kofi.search_artworks(jsonb, integer, integer) from public;
grant execute on function kofi.search_artworks(jsonb, integer, integer) to anon, authenticated;

-- The works a call's organiser (a verified curator of its institution) or Kofi
-- may see, for "Works that fit": the same rows and discovery rules as the Works
-- search, unranked. The client ranks them with domain/matching.ts (rankWorks
-- over effectiveCriteria(call)) so wording and order never differ between modes.
-- Matching reads only tag_ids, uses, location_label and the dimensions.
create or replace function kofi.match_works(p_call uuid)
returns setof kofi.artworks_visible
language plpgsql stable security invoker set search_path = kofi, public as $$
declare
  v_admin boolean := kofi.is_admin();
begin
  if not v_admin then
    perform kofi.require_organiser();
    if not kofi.is_call_organizer(p_call) then
      raise exception 'You can only manage calls your institution runs.' using errcode = '42501';
    end if;
  elsif not exists (select 1 from kofi.open_calls c where c.id = p_call) then
    raise exception 'Open call not found.' using errcode = 'P0002';
  end if;
  return query
    select v.*
    from kofi.artworks_visible v
    where v.visibility <> 'private'
      and (v.visibility <> 'kofi' or v_admin)
      and (v.artist_status = 'approved' or v_admin)
    order by v.created_at desc, v.id;
end $$;
revoke all on function kofi.match_works(uuid) from public, anon;
grant execute on function kofi.match_works(uuid) to authenticated;

-- 0005's save_artwork(), plus the v6 fields. A key the client leaves out keeps
-- the stored value (an older client cannot wipe tags or uses); tagIds is
-- normalised by artworks_taxonomy; uses keep only the four booleans; edition /
-- location are validated there with their own messages.
create or replace function kofi.save_artwork(p_artwork jsonb, p_images jsonb) returns uuid
language plpgsql volatile security invoker set search_path = kofi, public as $$
declare
  v_artist uuid := kofi.my_artist_id();
  v_id uuid := nullif(p_artwork ->> 'id', '')::uuid;
  v_access text;
  v_keep uuid[];
  v_tags text[];
  v_uses jsonb;
  v_keywords text[];
  v_medium kofi.medium;
  v_edition jsonb := nullif(p_artwork -> 'edition', 'null'::jsonb);
  v_location jsonb := nullif(p_artwork -> 'location', 'null'::jsonb);
begin
  if v_artist is null then
    raise exception 'Sign in as an artist to do this.' using errcode = '42501';
  end if;
  if p_images is null or jsonb_typeof(p_images) <> 'array' then
    raise exception 'Unsupported image.' using errcode = '22023', hint = 'images';
  end if;
  if p_artwork ->> 'visibility' = 'public' and jsonb_array_length(p_images) = 0 then
    raise exception 'Add at least one image before publishing.' using errcode = '22023', hint = 'images';
  end if;
  -- cleanArtworkV6(): tag ids (normalised and capped by artworks_taxonomy), uses, keywords.
  if p_artwork ? 'tagIds' then
    if jsonb_typeof(p_artwork -> 'tagIds') <> 'array'
       or exists (select 1 from jsonb_array_elements(p_artwork -> 'tagIds') x where jsonb_typeof(x) <> 'string') then
      raise exception 'Tags must be a list.' using errcode = '22023', hint = 'tags';
    end if;
    v_tags := kofi.json_texts(p_artwork -> 'tagIds');
  end if;
  if p_artwork ? 'uses' then
    if kofi.uses_problem(p_artwork -> 'uses') is not null then
      raise exception '%', kofi.uses_problem(p_artwork -> 'uses') using errcode = '22023', hint = 'uses';
    end if;
    v_uses := kofi.clean_uses(p_artwork -> 'uses');
  end if;
  v_keywords := kofi.clean_keywords(p_artwork -> 'tags');
  v_medium := (p_artwork ->> 'medium')::kofi.medium;

  if v_id is not null then
    v_access := kofi.describe_access('artwork', v_id);
    if v_access = 'not_found' then
      raise exception 'Artwork not found.' using errcode = 'P0002';
    elsif v_access <> 'owner' then
      raise exception 'You can only edit your own work.' using errcode = '42501';
    end if;
    update kofi.artworks set
      title = p_artwork ->> 'title',
      year = (p_artwork ->> 'year')::integer,
      medium = v_medium,
      materials = array(select jsonb_array_elements_text(coalesce(p_artwork -> 'materials', '[]'::jsonb))),
      height = (p_artwork #>> '{dimensions,height}')::numeric,
      width = (p_artwork #>> '{dimensions,width}')::numeric,
      depth = (p_artwork #>> '{dimensions,depth}')::numeric,
      unit = (p_artwork #>> '{dimensions,unit}')::kofi.unit,
      description = coalesce(p_artwork ->> 'description', ''),
      status = (p_artwork ->> 'status')::kofi.artwork_status,
      rights_note = coalesce(p_artwork ->> 'rightsNote', ''),
      price_amount = (p_artwork #>> '{price,amount}')::numeric,
      price_currency = p_artwork #>> '{price,currency}',
      price_visibility = (p_artwork ->> 'priceVisibility')::kofi.visibility,
      visibility = (p_artwork ->> 'visibility')::kofi.visibility,
      tags = v_keywords,
      -- No tag ids sent and a new medium: the old primary medium was only a mirror.
      tag_ids = coalesce(v_tags, case when medium is distinct from v_medium then array_remove(tag_ids, kofi.medium_tag_id(medium)) else tag_ids end),
      uses = coalesce(v_uses, uses),
      edition = case when p_artwork ? 'edition' then v_edition else edition end,
      -- The API roles cannot SELECT artworks.location; the owner's stored value comes
      -- from artwork_location() (owner / Kofi only).
      location = case when p_artwork ? 'location' then v_location else (select l.location from kofi.artwork_location(v_id) l) end
    where id = v_id;
  else
    insert into kofi.artworks (
      artist_id, title, year, medium, materials, height, width, depth, unit, description,
      status, rights_note, price_amount, price_currency, price_visibility, visibility, tags,
      tag_ids, uses, edition, location
    ) values (
      v_artist,
      p_artwork ->> 'title',
      (p_artwork ->> 'year')::integer,
      v_medium,
      array(select jsonb_array_elements_text(coalesce(p_artwork -> 'materials', '[]'::jsonb))),
      (p_artwork #>> '{dimensions,height}')::numeric,
      (p_artwork #>> '{dimensions,width}')::numeric,
      (p_artwork #>> '{dimensions,depth}')::numeric,
      (p_artwork #>> '{dimensions,unit}')::kofi.unit,
      coalesce(p_artwork ->> 'description', ''),
      (p_artwork ->> 'status')::kofi.artwork_status,
      coalesce(p_artwork ->> 'rightsNote', ''),
      (p_artwork #>> '{price,amount}')::numeric,
      p_artwork #>> '{price,currency}',
      (p_artwork ->> 'priceVisibility')::kofi.visibility,
      (p_artwork ->> 'visibility')::kofi.visibility,
      v_keywords,
      coalesce(v_tags, '{}'),
      coalesce(v_uses, kofi.clean_uses('{}'::jsonb)),
      v_edition,
      v_location
    )
    returning id into v_id;
  end if;

  v_keep := array(
    select (e ->> 'id')::uuid from jsonb_array_elements(p_images) e where nullif(e ->> 'id', '') is not null
  );
  delete from kofi.artwork_images where artwork_id = v_id and not (id = any (v_keep));
  insert into kofi.artwork_images (id, artwork_id, src, alt, is_primary, metadata_stripped, position)
  select
    coalesce(nullif(e ->> 'id', '')::uuid, gen_random_uuid()),
    v_id,
    e ->> 'src',
    coalesce(e ->> 'alt', ''),
    coalesce((e ->> 'isPrimary')::boolean, false),
    coalesce((e ->> 'metadataStripped')::boolean, false),
    (o - 1)::integer
  from jsonb_array_elements(p_images) with ordinality as t (e, o)
  on conflict (id) do update set
    artwork_id = excluded.artwork_id,
    src = excluded.src,
    alt = excluded.alt,
    is_primary = excluded.is_primary,
    metadata_stripped = excluded.metadata_stripped,
    position = excluded.position;
  return v_id;
end $$;
revoke execute on function kofi.save_artwork(jsonb, jsonb) from public, anon;
grant execute on function kofi.save_artwork(jsonb, jsonb) to authenticated;

-- Trigger functions (incl. the new ones) are never API-callable.
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
    where p.pronamespace = 'kofi'::regnamespace and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
grant all on all functions in schema kofi to service_role;

insert into kofi.applied_migrations (name) values ('0011_taxonomy') on conflict do nothing;

commit;

notify pgrst, 'reload schema';
