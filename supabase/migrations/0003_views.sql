-- =============================================================================
-- Kofi Collections — 0003 field-level redaction views
--
-- The client reads discovery data ONLY from these views. They are
-- security_invoker, so the base tables' RLS decides which ROWS come back.
-- The sensitive COLUMNS are not selectable by the API roles at all (0002);
-- the views obtain them through security-definer functions that re-check
-- permission for the specific row, returning NULL when the caller may not see
-- the field. Calling those functions directly through /rpc gives the same
-- answer — there is no unguarded path to a price, contact field or note.
-- =============================================================================

-- regionLabel() from src/domain/visibility.ts.
create or replace function public.region_label(
  p_city text, p_region text, p_country text, p_precision public.region_precision
) returns text
language sql immutable set search_path = public as $$
  select case p_precision
    when 'city' then coalesce(nullif(concat_ws(', ', nullif(p_city, ''), nullif(p_region, '')), ''), p_country)
    when 'region' then p_region || ', ' || p_country
    else p_country
  end
$$;

-- Owner/admin-only artist fields. Returns no row if the caller may not see the
-- artist at all; region_label is always filled for visible artists.
create or replace function public.artist_extras(p_artist_id uuid)
returns table (
  region_label text,
  region_city text,
  region_region text,
  region_country text,
  region_precision public.region_precision,
  legal_name text,
  contact_email text,
  contact_phone text,
  contact_studio_address text,
  kofi_notes text,
  consent_version text,
  consent_accepted_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    public.region_label(a.region_city, a.region_region, a.region_country, a.region_precision),
    case when x.privileged then a.region_city end,
    case when x.privileged then a.region_region end,
    case when x.privileged then a.region_country end,
    case when x.privileged then a.region_precision end,
    case when x.privileged then a.legal_name end,
    case when x.privileged then a.contact_email end,
    case when x.privileged then a.contact_phone end,
    case when x.privileged then a.contact_studio_address end,
    case when public.is_admin() then a.kofi_notes end,
    case when x.privileged then a.consent_version end,
    case when x.privileged then a.consent_accepted_at end
  from public.artists a
  cross join lateral (select (a.id = public.my_artist_id() or public.is_admin()) as privileged) x
  where a.id = p_artist_id and public.artist_visible(a.id)
$$;

-- Price redaction for one artwork. No row if the artwork is not visible.
create or replace function public.artwork_price(p_artwork_id uuid)
returns table (price_amount numeric, price_currency text, price_withheld boolean)
language sql stable security definer set search_path = public as $$
  select
    case when s.visible then w.price_amount end,
    case when s.visible then w.price_currency end,
    (w.price_amount is not null and not s.visible)
  from public.artworks w
  cross join lateral (select public.can_see(w.price_visibility, w.artist_id) as visible) s
  where w.id = p_artwork_id and public.artwork_visible(w.id)
$$;

-- ------------------------------------------------------------ artists_visible
create or replace view public.artists_visible with (security_invoker = true) as
select
  a.id,
  a.working_name,
  a.pronouns,
  a.bio,
  a.statement,
  a.mediums,
  a.career_stage,
  a.experience_commissions,
  a.experience_public_art,
  a.experience_residencies,
  a.experience_institutional_shows,
  a.experience_years_practicing,
  a.availability_commissions,
  a.availability_sales,
  a.availability_exhibitions,
  a.links,
  a.status,
  a.visibility,
  a.avatar_color,
  a.created_at,
  a.updated_at,
  x.region_label,
  x.region_city,
  x.region_region,
  x.region_country,
  x.region_precision,
  x.legal_name,
  x.contact_email,
  x.contact_phone,
  x.contact_studio_address,
  x.kofi_notes,
  x.consent_version,
  x.consent_accepted_at,
  (a.id = public.my_artist_id() or public.is_admin()) as can_edit
from public.artists a
left join lateral public.artist_extras(a.id) x on true;

-- ----------------------------------------------------------- artworks_visible
create or replace view public.artworks_visible with (security_invoker = true) as
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
  (select x.region_label from public.artist_extras(w.artist_id) x) as artist_region_label,
  (w.artist_id = public.my_artist_id() or public.is_admin()) as can_edit,
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', i.id, 'src', i.src, 'alt', i.alt,
        'isPrimary', i.is_primary, 'metadataStripped', i.metadata_stripped
      ) order by i.position, i.created_at
    )
    from public.artwork_images i where i.artwork_id = w.id
  ), '[]'::jsonb) as images
from public.artworks w
join public.artists a on a.id = w.artist_id
left join lateral public.artwork_price(w.id) p on true;

-- ---------------------------------------------------------- inquiries_visible
-- Adds the display labels an InquiryRow needs. The artist reading their inbox
-- cannot read the curators table, so names come from a definer function that
-- re-checks can_read_inquiry(). Work email / purpose are never included.
create or replace function public.inquiry_labels(p_inquiry_id uuid)
returns table (curator_name text, institution_name text, artist_working_name text, artwork_title text)
language sql stable security definer set search_path = public as $$
  select c.name, inst.name, a.working_name, w.title
  from public.inquiries i
  join public.curators c on c.id = i.curator_id
  join public.institutions inst on inst.id = c.institution_id
  join public.artists a on a.id = i.artist_id
  left join public.artworks w on w.id = i.artwork_id
  where i.id = p_inquiry_id and public.can_read_inquiry(i.id)
$$;

create or replace view public.inquiries_visible with (security_invoker = true) as
select
  i.id,
  i.curator_id,
  i.artist_id,
  i.artwork_id,
  i.message,
  i.status,
  i.created_at,
  i.decided_at,
  i.decided_by,
  i.staff_note,
  l.curator_name,
  l.institution_name,
  l.artist_working_name,
  l.artwork_title
from public.inquiries i
left join lateral public.inquiry_labels(i.id) l on true;

revoke all on public.artists_visible, public.artworks_visible, public.inquiries_visible from anon, authenticated;
grant select on public.artists_visible, public.artworks_visible to anon, authenticated;
grant select on public.inquiries_visible to authenticated;
