-- Additive gate: immutable historical records are unchanged, including existing downloads.
create function public.production_check_hp_outcome()
returns trigger language plpgsql set search_path='' as $$
declare hazard jsonb; hp text; outcome jsonb; confirmed boolean := false; complete boolean := true;
begin
  hazard := new.snapshot#>'{assessment,decision_snapshot,classification,hazard}';
  if hazard->>'outcomeVersion' is distinct from 'hp-waste-2026-09-10.2'
    or hazard#>>'{aggregate,status}' not in ('hazardous','non_hazardous')
    or hazard#>>'{aggregate,status}' is null
    or hazard->'isHazardous' is null or hazard->'isHazardous'='null'::jsonb then
    raise exception 'Indeterminate or legacy HP assessment blocks finalization; reprocess or resolve HP evidence' using errcode='22023';
  end if;
  foreach hp in array array['HP1','HP2','HP3','HP4','HP5','HP6','HP7','HP8','HP9','HP10','HP11','HP12','HP13','HP14','HP15'] loop
    outcome := hazard->'resultsByHp'->hp;
    if outcome->>'ruleVersion' is distinct from 'hp-waste-2026-09-10.2'
      or outcome->>'status' is null or outcome->>'status' not in ('triggered','not_triggered','not_assessable','not_applicable','requires_manual_assessment') then
      raise exception 'Structured HP outcomes required for finalization' using errcode='22023';
    end if;
    confirmed := confirmed or outcome->>'status'='triggered';
    complete := complete and outcome->>'status' in ('not_triggered','not_applicable')
      and coalesce(outcome->>'coverage'='property_assessed',false)
      and outcome->'issues'='[]'::jsonb;
  end loop;
  if hazard#>>'{aggregate,status}'='hazardous' then
    if not confirmed or hazard->'isHazardous'<>'true'::jsonb then
      raise exception 'Hazard aggregate disagrees with confirmed HP outcomes' using errcode='22023';
    end if;
  elsif not coalesce(complete,false) or hazard->'isHazardous'<>'false'::jsonb or hazard#>'{aggregate,issues}' is distinct from '[]'::jsonb then
    raise exception 'Non-hazardous classification requires complete resolved HP evidence' using errcode='22023';
  end if;
  return new;
end; $$;
revoke all on function public.production_check_hp_outcome() from public,anon,authenticated;
create trigger production_hp_outcome_before_finalization before insert on public.production_finalizations
for each row execute function public.production_check_hp_outcome();
