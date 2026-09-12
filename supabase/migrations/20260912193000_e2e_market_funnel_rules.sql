-- E2E market-funnel business rules.
-- Defense in depth: even privileged application code cannot persist a decision
-- queue outside the approved quantitative policy.

create or replace function public.replace_decision_queue_atomic(
  p_run_id uuid,
  p_owner_id uuid,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_count integer;
  v_rows integer;
begin
  perform 1
  from public.analysis_runs r
  where r.id=p_run_id and r.owner_id=p_owner_id
  for update;
  if not found then raise exception 'Análise não encontrada.'; end if;

  if exists(
    select 1 from public.decision_opportunity_queue q
    where q.run_id=p_run_id and q.queue_state='ACCEPTED'
  ) then
    raise exception 'A fila não pode ser reconstruída após uma escolha do usuário.';
  end if;

  if pg_catalog.jsonb_typeof(pg_catalog.coalesce(p_rows,'[]'::jsonb)) <> 'array' then
    raise exception 'Fila de decisão inválida.';
  end if;
  v_rows := pg_catalog.jsonb_array_length(pg_catalog.coalesce(p_rows,'[]'::jsonb));
  if v_rows > 3 then
    raise exception 'A fila principal aceita no máximo 3 oportunidades qualificadas.';
  end if;

  -- Every row must pass the final business rule. Thresholds are inclusive.
  if exists(
    select 1
    from pg_catalog.jsonb_to_recordset(pg_catalog.coalesce(p_rows,'[]'::jsonb)) as x(
      match_id uuid,prediction_id text,rank_global integer,match_label text,competition text,market_family text,market text,
      market_label text,participant text,side text,line_canonical numeric,model_version text,model_status text,
      model_probability numeric,fair_odd numeric,entry_odd numeric,min_odd_target numeric,edge numeric,expected_value numeric
    )
    where x.model_probability is null or x.model_probability < 0.70 or x.model_probability > 1
       or x.entry_odd is null or x.entry_odd < 1.70
       or x.edge is null or x.edge < 0.05
       or x.expected_value is null or x.expected_value < 0.08
  ) then
    raise exception 'Uma ou mais oportunidades não atendem à régua 70%% + odd 1,70 + EV 8%% + edge 5 p.p.';
  end if;

  -- The queue cannot be forged with a prediction from another run or a value
  -- that is no longer the model prediction stored for this run.
  if exists(
    select 1
    from pg_catalog.jsonb_to_recordset(pg_catalog.coalesce(p_rows,'[]'::jsonb)) as x(
      match_id uuid,prediction_id text,rank_global integer,match_label text,competition text,market_family text,market text,
      market_label text,participant text,side text,line_canonical numeric,model_version text,model_status text,
      model_probability numeric,fair_odd numeric,entry_odd numeric,min_odd_target numeric,edge numeric,expected_value numeric
    )
    left join public.model_predictions mp
      on mp.run_id=p_run_id
     and mp.prediction_id=x.prediction_id
     and mp.match_id is not distinct from x.match_id
    where mp.id is null
       or mp.model_probability is null
       or pg_catalog.abs(mp.model_probability - x.model_probability) > 0.000000001
       or mp.data_status <> 'OK'
  ) then
    raise exception 'Fila contém previsão ausente, divergente ou com dados não aprovados.';
  end if;

  -- At most one main opportunity per match.
  if exists(
    select 1
    from pg_catalog.jsonb_to_recordset(pg_catalog.coalesce(p_rows,'[]'::jsonb)) as x(
      match_id uuid,prediction_id text,rank_global integer,match_label text,competition text,market_family text,market text,
      market_label text,participant text,side text,line_canonical numeric,model_version text,model_status text,
      model_probability numeric,fair_odd numeric,entry_odd numeric,min_odd_target numeric,edge numeric,expected_value numeric
    )
    where x.match_id is not null
    group by x.match_id
    having count(*) > 1
  ) then
    raise exception 'A fila principal não permite duas oportunidades do mesmo jogo.';
  end if;

  -- Portfolio diversification: never fill all three positions with one family.
  if exists(
    select 1
    from pg_catalog.jsonb_to_recordset(pg_catalog.coalesce(p_rows,'[]'::jsonb)) as x(
      match_id uuid,prediction_id text,rank_global integer,match_label text,competition text,market_family text,market text,
      market_label text,participant text,side text,line_canonical numeric,model_version text,model_status text,
      model_probability numeric,fair_odd numeric,entry_odd numeric,min_odd_target numeric,edge numeric,expected_value numeric
    )
    group by x.market_family
    having count(*) > 2
  ) then
    raise exception 'A fila principal permite no máximo 2 oportunidades da mesma família.';
  end if;

  -- If the value is the current automatic Bet365 quote, it must still be fresh.
  -- A different value is considered an explicit manual quote and is evaluated
  -- by the same quantitative gates above.
  if exists(
    select 1
    from pg_catalog.jsonb_to_recordset(pg_catalog.coalesce(p_rows,'[]'::jsonb)) as x(
      match_id uuid,prediction_id text,rank_global integer,match_label text,competition text,market_family text,market text,
      market_label text,participant text,side text,line_canonical numeric,model_version text,model_status text,
      model_probability numeric,fair_odd numeric,entry_odd numeric,min_odd_target numeric,edge numeric,expected_value numeric
    )
    join lateral (
      select s.odd,s.fetched_at
      from public.experimental_odds_snapshots s
      where s.run_id=p_run_id
        and s.prediction_id=x.prediction_id
        and s.status='MATCHED'
      order by s.fetched_at desc
      limit 1
    ) s on s.odd is not null and pg_catalog.abs(s.odd-x.entry_odd) <= 0.000000001
    where s.fetched_at < pg_catalog.now() - interval '10 minutes'
  ) then
    raise exception 'Odd automática expirada; atualize a cotação antes de continuar.';
  end if;

  delete from public.decision_opportunity_queue where run_id=p_run_id;
  insert into public.decision_opportunity_queue(
    run_id,match_id,prediction_id,rank_global,match_label,competition,market_family,market,market_label,
    participant,side,line_canonical,model_version,model_status,model_probability,fair_odd,entry_odd,min_odd_target,edge,expected_value
  )
  select p_run_id,x.match_id,x.prediction_id,x.rank_global,x.match_label,x.competition,x.market_family,x.market,x.market_label,
         x.participant,x.side,x.line_canonical,x.model_version,x.model_status,x.model_probability,x.fair_odd,x.entry_odd,
         x.min_odd_target,x.edge,x.expected_value
  from pg_catalog.jsonb_to_recordset(pg_catalog.coalesce(p_rows,'[]'::jsonb)) as x(
    match_id uuid,prediction_id text,rank_global integer,match_label text,competition text,market_family text,market text,
    market_label text,participant text,side text,line_canonical numeric,model_version text,model_status text,
    model_probability numeric,fair_odd numeric,entry_odd numeric,min_odd_target numeric,edge numeric,expected_value numeric
  );
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

revoke all on function public.replace_decision_queue_atomic(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.replace_decision_queue_atomic(uuid,uuid,jsonb) to service_role;

comment on function public.replace_decision_queue_atomic(uuid,uuid,jsonb) is
  'Persiste somente 0-3 oportunidades finais com p>=70%, odd>=1.70, EV>=8%, edge>=5pp, uma por jogo, no máximo duas por família e odd automática fresca.';

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260912-e2e-market-funnel-rules',
  'e2e_market_funnel_rules',
  'Defense-in-depth for the decision queue: inclusive p>=70%, odd>=1.70, EV>=8%, edge>=5pp, max three, one per match, family diversification and automatic-odds freshness.'
)
on conflict (version) do update
set migration_name=excluded.migration_name,
    notes=excluded.notes,
    applied_at=pg_catalog.now();
