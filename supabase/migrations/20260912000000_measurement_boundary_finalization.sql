-- Preserve the finalization review barrier now invalid rows are retained outside normalized.
-- Additive: historical snapshots are untouched. The RPC builds this snapshot from assessment data.
create function public.production_check_measurement_boundary()
returns trigger language plpgsql set search_path='' as $$
declare measurement jsonb;
begin
  for measurement in select value from jsonb_array_elements(coalesce(
    new.snapshot#>'{assessment,decision_snapshot,normalizationTrace,measurementBoundary,measurements}', '[]'::jsonb)) loop
    if measurement#>'{hpEligibility,eligible}'='false'::jsonb
      and coalesce(measurement->>'analyticalRole','unknown') not in ('leaching_batch','leaching_column','physical_or_composition') then
      raise exception 'Excluded or unresolved concentration evidence requires review before finalization' using errcode='22023';
    end if;
  end loop;
  return new;
end; $$;
revoke all on function public.production_check_measurement_boundary() from public,anon,authenticated;
create trigger production_measurement_boundary_before_finalization
before insert on public.production_finalizations
for each row execute function public.production_check_measurement_boundary();
