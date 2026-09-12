-- COALESCE/GREATEST are SQL special expressions, not schema-qualified functions.
-- Recreate the affected RPCs with portable PostgreSQL syntax.

create or replace function public.create_analysis_run_atomic(
  p_owner_id uuid,
  p_idempotency_key uuid,
  p_target_date date,
  p_filename text,
  p_invalid_count integer,
  p_leagues text[],
  p_headers text[],
  p_rows jsonb
)
returns table(run_id uuid, reused boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_count integer;
  v_inserted integer;
begin
  if p_owner_id is null or p_idempotency_key is null then
    raise exception 'Identidade da solicitação inválida.';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Lista de partidas inválida.';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count < 1 or v_count > 300 then
    raise exception 'A análise deve conter entre 1 e 300 partidas.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_owner_id::text || ':' || p_idempotency_key::text, 0)
  );

  select r.id into v_run_id
  from public.analysis_runs r
  where r.owner_id = p_owner_id and r.idempotency_key = p_idempotency_key;

  if v_run_id is not null then
    return query select v_run_id, true;
    return;
  end if;

  insert into public.analysis_runs(owner_id, idempotency_key, target_date, status, matches_total, notes)
  values (
    p_owner_id,
    p_idempotency_key,
    p_target_date,
    'CREATED',
    v_count,
    pg_catalog.jsonb_build_object('prediction_at', pg_catalog.now())
  )
  returning id into v_run_id;

  insert into public.uploaded_files(run_id, filename, row_count, invalid_row_count, leagues, raw_headers)
  values (
    v_run_id,
    pg_catalog.left(coalesce(p_filename, 'analise.csv'), 200),
    v_count,
    greatest(coalesce(p_invalid_count, 0), 0),
    coalesce(p_leagues, '{}'::text[]),
    coalesce(p_headers, '{}'::text[])
  );

  insert into public.matches(run_id, raw_partida, raw_horario, raw_campeonato)
  select
    v_run_id,
    pg_catalog.btrim(x.partida),
    pg_catalog.btrim(x.horario),
    pg_catalog.btrim(x.campeonato)
  from pg_catalog.jsonb_to_recordset(p_rows) as x(partida text, horario text, campeonato text)
  where pg_catalog.btrim(coalesce(x.partida, '')) <> ''
    and pg_catalog.btrim(coalesce(x.horario, '')) <> ''
    and pg_catalog.btrim(coalesce(x.campeonato, '')) <> '';
  get diagnostics v_inserted = row_count;

  if v_inserted <> v_count then
    raise exception 'Uma ou mais partidas ficaram inválidas durante a criação.';
  end if;

  return query select v_run_id, false;
end;
$$;
revoke all on function public.create_analysis_run_atomic(uuid,uuid,date,text,integer,text[],text[],jsonb) from public,anon,authenticated;
grant execute on function public.create_analysis_run_atomic(uuid,uuid,date,text,integer,text[],text[],jsonb) to service_role;

create or replace function public.enforce_experimental_selection_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_date date;
  v_owner_id uuid;
  v_used integer := 0;
begin
  if NEW.bet_status not in ('PROPOSED','OPEN','SETTLED') then return NEW; end if;
  if TG_OP = 'UPDATE' and OLD.bet_status in ('PROPOSED','OPEN','SETTLED') then return NEW; end if;

  select r.target_date, r.owner_id into v_target_date, v_owner_id
  from public.analysis_runs r where r.id = NEW.run_id;
  if not found then raise exception 'Rodada experimental não encontrada para validar limite.'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_owner_id::text || ':' || coalesce(v_target_date::text,'sem-data'), 0)
  );

  select count(*) into v_used
  from public.experimental_bet_tracking t
  join public.analysis_runs r on r.id = t.run_id
  where r.owner_id = v_owner_id
    and r.target_date is not distinct from v_target_date
    and t.id is distinct from NEW.id
    and t.bet_status in ('PROPOSED','OPEN','SETTLED');

  if v_used >= 3 then raise exception 'Limite diário de 3 seleções atingido.'; end if;
  return NEW;
end;
$$;
revoke all on function public.enforce_experimental_selection_limit() from public,anon,authenticated;
grant execute on function public.enforce_experimental_selection_limit() to service_role;

create or replace function public.create_analysis_draft_atomic(
  p_owner_id uuid,
  p_client_request_id uuid,
  p_filename text,
  p_target_date date,
  p_headers text[],
  p_leagues text[],
  p_invalid_count integer,
  p_rows jsonb
)
returns table(draft_id uuid, reused boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft_id uuid;
  v_count integer;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Lista de partidas inválida.'; end if;
  v_count := jsonb_array_length(p_rows);
  if v_count < 1 or v_count > 300 then raise exception 'O rascunho deve conter entre 1 e 300 partidas.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_id::text || ':draft:' || p_client_request_id::text,0));

  select d.id into v_draft_id from public.analysis_drafts d
  where d.owner_id=p_owner_id and d.client_request_id=p_client_request_id;
  if v_draft_id is not null then return query select v_draft_id,true; return; end if;

  insert into public.analysis_drafts(owner_id,client_request_id,filename,target_date,headers,leagues,invalid_count)
  values(
    p_owner_id,p_client_request_id,pg_catalog.left(p_filename,200),p_target_date,
    coalesce(p_headers,'{}'::text[]),coalesce(p_leagues,'{}'::text[]),greatest(p_invalid_count,0)
  ) returning id into v_draft_id;

  insert into public.analysis_draft_games(draft_id,ordinal,partida,horario,campeonato,target_date)
  select v_draft_id, ordinality::integer-1,
         pg_catalog.btrim(x.value->>'partida'), pg_catalog.btrim(x.value->>'horario'),
         pg_catalog.btrim(x.value->>'campeonato'),
         coalesce(nullif(x.value->>'targetDate','')::date,p_target_date)
  from pg_catalog.jsonb_array_elements(p_rows) with ordinality as x(value,ordinality);

  return query select v_draft_id,false;
end;
$$;
revoke all on function public.create_analysis_draft_atomic(uuid,uuid,text,date,text[],text[],integer,jsonb) from public,anon,authenticated;
grant execute on function public.create_analysis_draft_atomic(uuid,uuid,text,date,text[],text[],integer,jsonb) to service_role;

create or replace function public.apply_analysis_draft_corrections(
  p_draft_id uuid,
  p_owner_id uuid,
  p_corrections jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_game_id uuid;
  v_field text;
  v_value text;
  v_editable text[];
  v_changed integer := 0;
begin
  perform 1 from public.analysis_drafts d where d.id=p_draft_id and d.owner_id=p_owner_id for update;
  if not found then raise exception 'Rascunho não encontrado.'; end if;

  for v_item in select value from pg_catalog.jsonb_array_elements(coalesce(p_corrections,'[]'::jsonb)) loop
    v_game_id := (v_item->>'gameId')::uuid;
    v_field := v_item->>'field';
    v_value := pg_catalog.btrim(coalesce(v_item->>'value',''));
    select g.editable_fields into v_editable from public.analysis_draft_games g
      where g.id=v_game_id and g.draft_id=p_draft_id for update;
    if not found then raise exception 'Partida do rascunho não encontrada.'; end if;
    if not (v_field = any(v_editable)) then raise exception 'Campo não liberado para correção.'; end if;
    if v_value='' then raise exception 'Correção vazia não é permitida.'; end if;

    if v_field='partida' then update public.analysis_draft_games set partida=v_value where id=v_game_id;
    elsif v_field='horario' then update public.analysis_draft_games set horario=v_value where id=v_game_id;
    elsif v_field='campeonato' then update public.analysis_draft_games set campeonato=v_value where id=v_game_id;
    elsif v_field='target_date' then update public.analysis_draft_games set target_date=v_value::date where id=v_game_id;
    else raise exception 'Campo de correção inválido.';
    end if;

    update public.analysis_draft_games
      set validation_status='PENDING',editable_fields='{}',validation_errors='[]',suggestions='[]',
          resolved_event_id=null,resolved_home_team=null,resolved_away_team=null,resolved_competition=null,
          resolved_kickoff=null,resolver_confidence=null,updated_at=pg_catalog.now()
    where id=v_game_id;
    v_changed := v_changed+1;
  end loop;
  update public.analysis_drafts set status='VALIDATING',updated_at=pg_catalog.now() where id=p_draft_id;
  return v_changed;
end;
$$;
revoke all on function public.apply_analysis_draft_corrections(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.apply_analysis_draft_corrections(uuid,uuid,jsonb) to service_role;

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
declare v_count integer;
begin
  perform 1 from public.analysis_runs r where r.id=p_run_id and r.owner_id=p_owner_id for update;
  if not found then raise exception 'Análise não encontrada.'; end if;
  if exists(select 1 from public.decision_opportunity_queue q where q.run_id=p_run_id and q.queue_state='ACCEPTED') then
    raise exception 'A fila não pode ser reconstruída após uma escolha do usuário.';
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

create or replace function public.next_decision_batch_atomic(
  p_run_id uuid,
  p_owner_id uuid,
  p_limit integer default 10
)
returns setof public.decision_opportunity_queue
language plpgsql
security definer
set search_path=''
as $$
declare v_batch integer;
begin
  if p_limit<1 or p_limit>10 then raise exception 'O lote deve conter entre 1 e 10 opções.'; end if;
  perform 1 from public.analysis_runs r where r.id=p_run_id and r.owner_id=p_owner_id for update;
  if not found then raise exception 'Análise não encontrada.'; end if;

  if exists(select 1 from public.decision_opportunity_queue q where q.run_id=p_run_id and q.queue_state='SHOWN') then
    return query select * from public.decision_opportunity_queue q
      where q.run_id=p_run_id and q.queue_state='SHOWN' order by q.rank_global;
    return;
  end if;

  select coalesce(max(q.batch_no),0)+1 into v_batch
    from public.decision_opportunity_queue q where q.run_id=p_run_id;
  update public.decision_opportunity_queue q
    set queue_state='SHOWN',batch_no=v_batch,updated_at=pg_catalog.now()
    where q.id in (
      select z.id from public.decision_opportunity_queue z
      where z.run_id=p_run_id and z.queue_state='AVAILABLE'
      order by z.rank_global limit p_limit
      for update skip locked
    );
  return query select * from public.decision_opportunity_queue q
    where q.run_id=p_run_id and q.queue_state='SHOWN' order by q.rank_global;
end;
$$;
revoke all on function public.next_decision_batch_atomic(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.next_decision_batch_atomic(uuid,uuid,integer) to service_role;

create or replace function public.accept_decision_opportunity_atomic(
  p_queue_id uuid,
  p_owner_id uuid
)
returns table(accepted boolean, accepted_count integer, ready_for_stake boolean)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_q public.decision_opportunity_queue%rowtype;
  v_target date;
  v_count integer;
  v_exhausted boolean;
begin
  select q.* into v_q
  from public.decision_opportunity_queue q
  join public.analysis_runs r on r.id=q.run_id
  where q.id=p_queue_id and r.owner_id=p_owner_id
  for update of q;
  if not found then raise exception 'Opção não encontrada.'; end if;

  select r.target_date into v_target from public.analysis_runs r where r.id=v_q.run_id for update;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_owner_id::text||':'||coalesce(v_target::text,'sem-data'),0)
  );
  select count(*) into v_count
  from public.decision_opportunity_queue q join public.analysis_runs r on r.id=q.run_id
  where r.owner_id=p_owner_id and r.target_date is not distinct from v_target and q.queue_state='ACCEPTED';
  if v_count>=3 then raise exception 'Limite diário de 3 escolhas atingido.'; end if;
  if v_q.queue_state<>'SHOWN' then
    select not exists(select 1 from public.decision_opportunity_queue where run_id=v_q.run_id and queue_state in ('AVAILABLE','SHOWN')) into v_exhausted;
    return query select false,v_count,(v_count>=3 or (v_count>0 and v_exhausted));
    return;
  end if;

  update public.decision_opportunity_queue set queue_state='ACCEPTED',updated_at=pg_catalog.now() where id=p_queue_id;
  v_count:=v_count+1;

  insert into public.experimental_bet_tracking(
    run_id,match_id,prediction_id,target_date,match_label,competition,market_family,market,market_label,
    participant,side,line_canonical,model_version,model_status,model_probability,fair_odd,entry_odd,
    min_odd_target,edge,expected_value,result,bet_status,selection_rank,updated_at
  ) values(
    v_q.run_id,v_q.match_id,v_q.prediction_id,v_target,v_q.match_label,v_q.competition,v_q.market_family,v_q.market,
    v_q.market_label,v_q.participant,v_q.side,v_q.line_canonical,v_q.model_version,v_q.model_status,v_q.model_probability,
    v_q.fair_odd,v_q.entry_odd,v_q.min_odd_target,v_q.edge,v_q.expected_value,'PENDING','PROPOSED',v_count,pg_catalog.now()
  ) on conflict(run_id,prediction_id) do update set
    bet_status='PROPOSED',selection_rank=excluded.selection_rank,updated_at=pg_catalog.now();

  select not exists(select 1 from public.decision_opportunity_queue where run_id=v_q.run_id and queue_state in ('AVAILABLE','SHOWN')) into v_exhausted;
  return query select true,v_count,(v_count>=3 or (v_count>0 and v_exhausted));
end;
$$;
revoke all on function public.accept_decision_opportunity_atomic(uuid,uuid) from public,anon,authenticated;
grant execute on function public.accept_decision_opportunity_atomic(uuid,uuid) to service_role;

create or replace function public.mark_external_api_rate_limited(p_provider text,p_retry_after_seconds integer)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.external_api_rate_state(provider,blocked_until,updated_at)
  values(
    p_provider,
    pg_catalog.now()+pg_catalog.make_interval(secs=>greatest(1,p_retry_after_seconds)),
    pg_catalog.now()
  )
  on conflict(provider) do update set blocked_until=excluded.blocked_until,updated_at=excluded.updated_at;
end;
$$;
revoke all on function public.mark_external_api_rate_limited(text,integer) from public,anon,authenticated;
grant execute on function public.mark_external_api_rate_limited(text,integer) to service_role;
