-- Production-model gate for executable decision opportunities.
-- Experimental predictions remain available for research, but cannot be persisted
-- into the operational decision queue until both the prediction and registered
-- model version are production validated with a non-null calibration version.

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

  if pg_catalog.jsonb_typeof(coalesce(p_rows,'[]'::jsonb)) <> 'array' then
    raise exception 'Fila de decisão inválida.';
  end if;
  v_rows := pg_catalog.jsonb_array_length(coalesce(p_rows,'[]'::jsonb));
  if v_rows > 3 then
    raise exception 'A fila principal aceita no máximo 3 oportunidades qualificadas.';
  end if;

  -- Research predictions are allowed to exist, but are never executable.
  -- Returning an empty queue (instead of raising) preserves the valid business
  -- outcome "zero bets" for the current experimental pipeline.
  if exists(
    select 1
    from pg_catalog.jsonb_to_recordset(coalesce(p_rows,'[]'::jsonb)) as x(
      match_id uuid,prediction_id text,rank_global integer,match_label text,competition text,market_family text,market text,
      market_label text,participant text,side text,line_canonical numeric,model_version text,model_status text,
      model_probability numeric,fair_odd numeric,entry_odd numeric,min_odd_target numeric,edge numeric,expected_value numeric
    )
    left join public.model_predictions mp
      on mp.run_id=p_run_id
     and mp.prediction_id=x.prediction_id
     and mp.match_id is not distinct from x.match_id
    left join lateral (
      select mv.validation_status,mv.calibration_version
      from public.model_versions mv
      where mv.market_family=x.market_family
        and mv.model_version=mp.model_version
      order by mv.created_at desc
      limit 1
    ) mv on true
    where mp.id is null
       or mp.data_status <> 'OK'
       or mp.model_status <> 'PRODUCTION_VALIDATED'
       or mp.calibration_version is null
       or coalesce(mp.conservative_probability,mp.p_cal) is null
       or x.model_status <> 'PRODUCTION_VALIDATED'
       or x.model_version is distinct from mp.model_version
       or mv.validation_status is distinct from 'PRODUCTION_VALIDATED'
       or mv.calibration_version is null
       or mv.calibration_version is distinct from mp.calibration_version
  ) then
    delete from public.decision_opportunity_queue where run_id=p_run_id;
    return 0;
  end if;

  -- Thresholds remain inclusive and now apply to the calibrated/conservative
  -- decision probability, not to the raw experimental probability.
  if exists(
    select 1
    from pg_catalog.jsonb_to_recordset(coalesce(p_rows,'[]'::jsonb)) as x(
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

  -- Bind the queue value to the calibrated/conservative probability stored for
  -- this exact prediction. A raw model probability can no longer be substituted.
  if exists(
    select 1
    from pg_catalog.jsonb_to_recordset(coalesce(p_rows,'[]'::jsonb)) as x(
      match_id uuid,prediction_id text,rank_global integer,match_label text,competition text,market_family text,market text,
      market_label text,participant text,side text,line_canonical numeric,model_version text,model_status text,
      model_probability numeric,fair_odd numeric,entry_odd numeric,min_odd_target numeric,edge numeric,expected_value numeric
    )
    left join public.model_predictions mp
      on mp.run_id=p_run_id
     and mp.prediction_id=x.prediction_id
     and mp.match_id is not distinct from x.match_id
    where mp.id is null
       or coalesce(mp.conservative_probability,mp.p_cal) is null
       or pg_catalog.abs(coalesce(mp.conservative_probability,mp.p_cal)-x.model_probability) > 0.000000001
       or mp.data_status <> 'OK'
       or mp.model_status <> 'PRODUCTION_VALIDATED'
       or mp.model_version is distinct from x.model_version
  ) then
    raise exception 'Fila contém previsão ausente, não validada ou probabilidade de decisão divergente.';
  end if;

  if exists(
    select 1
    from pg_catalog.jsonb_to_recordset(coalesce(p_rows,'[]'::jsonb)) as x(
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

  if exists(
    select 1
    from pg_catalog.jsonb_to_recordset(coalesce(p_rows,'[]'::jsonb)) as x(
      match_id uuid,prediction_id text,rank_global integer,match_label text,competition text,market_family text,market text,
      market_label text,participant text,side text,line_canonical numeric,model_version text,model_status text,
      model_probability numeric,fair_odd numeric,entry_odd numeric,min_odd_target numeric,edge numeric,expected_value numeric
    )
    group by x.market_family
    having count(*) > 2
  ) then
    raise exception 'A fila principal permite no máximo 2 oportunidades da mesma família.';
  end if;

  if exists(
    select 1
    from pg_catalog.jsonb_to_recordset(coalesce(p_rows,'[]'::jsonb)) as x(
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
  from pg_catalog.jsonb_to_recordset(coalesce(p_rows,'[]'::jsonb)) as x(
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
  'Persiste somente 0-3 oportunidades com modelo e calibração PRODUCTION_VALIDATED, probabilidade calibrada/conservadora, p>=70%, odd>=1.70, EV>=8%, edge>=5pp e demais controles do funil.';

insert into public.app_schema_releases(version,migration_name,notes)
values(
  '20260912-production-model-decision-gate',
  'production_model_decision_gate',
  'Executable queue now requires prediction + registered model version PRODUCTION_VALIDATED, matching calibration version and calibrated/conservative decision probability. Experimental models resolve safely to zero executable bets.'
)
on conflict (version) do update
set migration_name=excluded.migration_name,
    notes=excluded.notes,
    applied_at=pg_catalog.now();
