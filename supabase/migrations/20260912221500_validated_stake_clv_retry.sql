-- Betting operations hardening: only validated/calibrated predictions may carry
-- new positive stake. Existing legacy OPEN bets may still be settled unchanged.
-- CLV unavailable captures receive a bounded retry budget.

alter table public.experimental_bet_tracking
  add column if not exists clv_attempts integer not null default 0,
  add column if not exists clv_next_retry_at timestamptz;

alter table public.experimental_bet_tracking
  drop constraint if exists experimental_bet_tracking_clv_attempts_check;
alter table public.experimental_bet_tracking
  add constraint experimental_bet_tracking_clv_attempts_check
  check (clv_attempts between 0 and 3);

create or replace function private.enforce_validated_stake()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_prediction public.model_predictions%rowtype;
  v_validation text;
  v_calibration text;
begin
  if coalesce(new.stake_brl,0) <= 0 or new.bet_status not in ('OPEN','SETTLED') then
    return new;
  end if;

  -- Preserve historical truth: an already-open legacy bet may be settled as long
  -- as its stake is not rewritten. This does not authorize a new wager.
  if tg_op='UPDATE'
     and old.bet_status='OPEN'
     and new.bet_status='SETTLED'
     and new.stake_brl is not distinct from old.stake_brl then
    return new;
  end if;

  select mp.* into v_prediction
  from public.model_predictions mp
  where mp.run_id=new.run_id and mp.prediction_id=new.prediction_id
  limit 1;

  if not found
     or v_prediction.model_status <> 'PRODUCTION_VALIDATED'
     or v_prediction.data_status <> 'OK'
     or v_prediction.calibration_version is null
     or coalesce(v_prediction.conservative_probability,v_prediction.p_cal) is null then
    raise exception 'Stake operacional exige previsão validada e calibrada.';
  end if;

  select mv.validation_status,mv.calibration_version
    into v_validation,v_calibration
  from public.model_versions mv
  where mv.market_family=new.market_family
    and mv.model_version=v_prediction.model_version
  order by mv.created_at desc
  limit 1;

  if v_validation is distinct from 'PRODUCTION_VALIDATED'
     or v_calibration is null
     or v_calibration is distinct from v_prediction.calibration_version then
    raise exception 'Stake operacional exige versão de modelo validada e calibração vigente.';
  end if;

  if pg_catalog.abs(new.model_probability-coalesce(v_prediction.conservative_probability,v_prediction.p_cal)) > 0.000000001 then
    raise exception 'Stake operacional exige a probabilidade calibrada/conservadora da previsão.';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_validated_stake() from public,anon,authenticated;

drop trigger if exists trg_experimental_validated_stake on public.experimental_bet_tracking;
create trigger trg_experimental_validated_stake
before insert or update of bet_status,stake_brl,model_probability on public.experimental_bet_tracking
for each row execute function private.enforce_validated_stake();

create or replace function public.get_due_clv_tracking_ids(p_owner_id uuid,p_limit integer default 2)
returns table(id uuid)
language sql
stable
security definer
set search_path=''
as $$
  select t.id
  from public.experimental_bet_tracking t
  join public.analysis_runs r on r.id=t.run_id
  where r.owner_id=p_owner_id
    and t.bet_status='SETTLED'
    and t.clv_status in ('SOURCE_UNAVAILABLE','NO_CLOSING_PRICE','UNAVAILABLE')
    and t.clv_attempts < 3
    and (t.clv_next_retry_at is null or t.clv_next_retry_at <= pg_catalog.now())
  order by t.clv_next_retry_at nulls first,t.settled_at desc nulls last
  limit pg_catalog.greatest(1,pg_catalog.least(coalesce(p_limit,2),3));
$$;

revoke all on function public.get_due_clv_tracking_ids(uuid,integer) from public,anon,authenticated;
grant execute on function public.get_due_clv_tracking_ids(uuid,integer) to service_role;

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260912-validated-stake-clv-retry',
  'validated_stake_clv_retry',
  'New positive stake requires a production-validated calibrated prediction. Existing OPEN legacy bets can still be settled without changing stake. CLV missing-source/no-price states receive at most three automatic attempts.'
)
on conflict(version) do update
set migration_name=excluded.migration_name,notes=excluded.notes,applied_at=pg_catalog.now();
