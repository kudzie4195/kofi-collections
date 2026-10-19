-- =============================================================================
-- Kofi Collections — 0006 realtime
--
-- The client subscribes to postgres_changes on these tables only as a
-- "something changed, refetch" signal; it never renders event payloads.
-- Supabase Realtime applies the subscriber's RLS to each event. (Assumed, not
-- verified here: Realtime also drops columns the subscriber cannot SELECT,
-- e.g. artworks.price_amount — the client does not depend on payloads either way.)
-- =============================================================================

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipping realtime setup';
    return;
  end if;
  foreach t in array array[
    'artists', 'artworks', 'artwork_images', 'curators', 'shortlists',
    'shortlist_items', 'inquiries', 'documents'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
