-- E2E market funnel: line compatibility defense in depth.
-- The application already rejects a quote whose line differs from the modelled
-- line. This trigger makes the same invariant unavoidable at persistence time,
-- including privileged/direct writes to the final decision queue.

create or replace function public.enforce_decision_queue_line_compatibility()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if not exists (
    select 1
    from public.model_predictions mp
    where mp.run_id = new.run_id
      and mp.prediction_id = new.prediction_id
      and mp.match_id is not distinct from new.match_id
      and mp.line_canonical is not distinct from new.line_canonical
  ) then
    raise exception 'Linha da oportunidade incompatível com a linha modelada para esta previsão.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_decision_queue_line_compatibility() from public,anon,authenticated;
grant execute on function public.enforce_decision_queue_line_compatibility() to service_role;

drop trigger if exists trg_decision_queue_line_compatibility on public.decision_opportunity_queue;
create trigger trg_decision_queue_line_compatibility
before insert or update of run_id,match_id,prediction_id,line_canonical
on public.decision_opportunity_queue
for each row
execute function public.enforce_decision_queue_line_compatibility();

comment on function public.enforce_decision_queue_line_compatibility() is
  'Bloqueia persistência de oportunidade cuja run, partida, previsão ou linha canônica não corresponda à previsão modelada.';

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260912-e2e-market-funnel-line-defense',
  'e2e_market_funnel_line_defense',
  'Defense-in-depth trigger requires decision queue line_canonical to match the model prediction for the same run/match/prediction.'
)
on conflict (version) do update
set migration_name=excluded.migration_name,
    notes=excluded.notes,
    applied_at=pg_catalog.now();
