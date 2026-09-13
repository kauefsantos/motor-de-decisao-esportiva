-- Stage 5: preserve Asian settlement semantics in the financial ledger.
-- entry_odd is the real executed price after execution-quote confirmation.

create or replace function public.settle_experimental_bet_atomic(
  p_id uuid,
  p_outcome text
)
returns table (
  profit_brl numeric,
  profit_units numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_odd numeric;
  v_stake numeric;
  v_status text;
  v_result text;
  v_profit_units numeric;
  v_profit_brl numeric;
  v_now timestamptz := pg_catalog.now();
begin
  if p_outcome not in ('WIN','HALF_WIN','PUSH','HALF_LOSS','LOSS','VOID') then
    raise exception 'Resultado inválido para fechamento.';
  end if;

  select t.entry_odd, t.stake_brl, t.bet_status, t.result
    into v_odd, v_stake, v_status, v_result
  from public.experimental_bet_tracking t
  where t.id = p_id
  for update;

  if not found then
    raise exception 'Aposta aberta não encontrada.';
  end if;

  if v_status <> 'OPEN' or v_result <> 'PENDING' then
    raise exception 'Esta aposta não está mais aberta.';
  end if;

  if pg_catalog.coalesce(v_stake, 0) <= 0 then
    raise exception 'A aposta aberta está sem valor confirmado.';
  end if;
  if pg_catalog.coalesce(v_odd, 0) <= 1 then
    raise exception 'A aposta aberta está sem odd executada válida.';
  end if;

  v_profit_units := case p_outcome
    when 'WIN' then v_odd - 1
    when 'HALF_WIN' then (v_odd - 1) / 2
    when 'PUSH' then 0
    when 'HALF_LOSS' then -0.5
    when 'LOSS' then -1
    when 'VOID' then 0
  end;
  v_profit_brl := v_stake * v_profit_units;

  update public.experimental_bet_tracking t
  set bet_status = 'SETTLED',
      result = p_outcome,
      profit_units = v_profit_units,
      profit_brl = v_profit_brl,
      settled_at = v_now,
      updated_at = v_now
  where t.id = p_id
    and t.bet_status = 'OPEN'
    and t.result = 'PENDING';

  if not found then
    raise exception 'Esta aposta mudou de estado antes do fechamento.';
  end if;

  return query select v_profit_brl, v_profit_units;
end;
$$;

revoke all on function public.settle_experimental_bet_atomic(uuid,text)
  from public,anon,authenticated;
grant execute on function public.settle_experimental_bet_atomic(uuid,text)
  to service_role;

comment on function public.settle_experimental_bet_atomic(uuid,text) is
  'Fecha uma aposta sob row lock usando a odd real executada e suporta WIN/HALF_WIN/PUSH/HALF_LOSS/LOSS/VOID.';

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260913-stage5-asian-financial-settlement',
  'stage5_asian_financial_settlement',
  'Financial settlement preserves Asian half-win, push and half-loss semantics and prices P/L from the real executed entry_odd.'
)
on conflict(version) do update
set migration_name=excluded.migration_name,
    notes=excluded.notes,
    applied_at=pg_catalog.now();
