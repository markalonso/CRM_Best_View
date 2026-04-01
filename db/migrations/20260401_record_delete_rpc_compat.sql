begin;

-- Compatibility wrapper for PostgREST RPC resolution when parameter order is
-- inferred as (p_record_ids, p_type) from schema cache.
create or replace function public.delete_crm_records_transactional(
  p_record_ids uuid[],
  p_type text
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.delete_crm_records_transactional(
    p_type => p_type,
    p_record_ids => p_record_ids
  );
$$;

commit;
