-- Backend/API hardening + staged validation/decision funnel.
-- Lovable Cloud remains runtime truth; this migration is the versioned source of truth.

-- ---------------------------------------------------------------------------
-- 1) Atomic and idempotent analysis creation
-- ---------------------------------------------------------------------------
alter table public.analysis_runs
  add column if not exists idempotency_key uuid;

create unique index if not exists uq_analysis_runs_owner_idempotency
  on public.analysis_runs(owner_id, idempotency_key)
  where idempotency_key is not null;

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
    pg_catalog.left(pg_catalog.coalesce(p_filename, 'analise.csv'), 200),
    v_count,
    pg_catalog.greatest(pg_catalog.coalesce(p_invalid_count, 0), 0),
    pg_catalog.coalesce(p_leagues, '{}'::text[]),
    pg_catalog.coalesce(p_headers, '{}'::text[])
  );

  insert into public.matches(run_id, raw_partida, raw_horario, raw_campeonato)
  select
    v_run_id,
    pg_catalog.btrim(x.partida),
    pg_catalog.btrim(x.horario),
    pg_catalog.btrim(x.campeonato)
  from pg_catalog.jsonb_to_recordset(p_rows) as x(partida text, horario text, campeonato text)
  where pg_catalog.btrim(pg_catalog.coalesce(x.partida, '')) <> ''
    and pg_catalog.btrim(pg_catalog.coalesce(x.horario, '')) <> ''
    and pg_catalog.btrim(pg_catalog.coalesce(x.campeonato, '')) <> '';

  if (select count(*) from public.matches m where m.run_id = v_run_id) <> v_count then
    raise exception 'Uma ou mais partidas ficaram inválidas durante a criação.';
  end if;

  return query select v_run_id, false;
end;
$$;

revoke all on function public.create_analysis_run_atomic(uuid,uuid,date,text,integer,text[],text[],jsonb)
  from public, anon, authenticated;
grant execute on function public.create_analysis_run_atomic(uuid,uuid,date,text,integer,text[],text[],jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2) Atomic queue enqueue + compare-and-set retry
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_analysis_job_atomic(
  p_run_id uuid,
  p_user_id uuid
)
returns table(status text, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_created boolean := false;
begin
  if not exists (
    select 1 from public.analysis_runs r
    where r.id = p_run_id and r.owner_id = p_user_id
  ) then
    raise exception 'Análise não encontrada.';
  end if;

  insert into public.analysis_jobs(run_id, user_id, status)
  values (p_run_id, p_user_id, 'QUEUED')
  on conflict (run_id) do nothing;
  get diagnostics v_created = row_count;

  select j.status into v_status
  from public.analysis_jobs j
  where j.run_id = p_run_id and j.user_id = p_user_id;

  return query select v_status, v_created;
end;
$$;

revoke all on function public.enqueue_analysis_job_atomic(uuid,uuid) from public, anon, authenticated;
grant execute on function public.enqueue_analysis_job_atomic(uuid,uuid) to service_role;

create or replace function public.retry_analysis_job_atomic(
  p_run_id uuid,
  p_user_id uuid
)
returns table(retried boolean, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed integer := 0;
  v_status text;
begin
  update public.analysis_jobs j
  set status = 'QUEUED',
      current_step = null,
      last_error = null,
      locked_at = null,
      completed_at = null,
      dispatch_token = gen_random_uuid(),
      updated_at = pg_catalog.now()
  where j.run_id = p_run_id
    and j.user_id = p_user_id
    and j.status = 'ERROR';
  get diagnostics v_changed = row_count;

  if v_changed = 1 then
    update public.analysis_runs r
    set status = 'RUNNING', updated_at = pg_catalog.now()
    where r.id = p_run_id and r.owner_id = p_user_id;
    v_status := 'QUEUED';
  else
    select j.status into v_status
    from public.analysis_jobs j
    where j.run_id = p_run_id and j.user_id = p_user_id;
  end if;

  return query select (v_changed = 1), v_status;
end;
$$;

revoke all on function public.retry_analysis_job_atomic(uuid,uuid) from public, anon, authenticated;
grant execute on function public.retry_analysis_job_atomic(uuid,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3) Atomic replacement of the legacy run odds/evaluation result set
-- ---------------------------------------------------------------------------
create or replace function public.replace_run_value_analysis_atomic(
  p_run_id uuid,
  p_owner_id uuid,
  p_user_odds jsonb,
  p_evaluations jsonb,
  p_selections jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  perform 1
  from public.analysis_runs r
  where r.id = p_run_id and r.owner_id = p_owner_id
  for update;
  if not found then raise exception 'Análise não encontrada.'; end if;

  delete from public.final_selections where run_id = p_run_id;
  delete from public.value_evaluations where run_id = p_run_id;
  delete from public.user_odds where run_id = p_run_id;

  insert into public.user_odds(run_id,candidate_id,bookmaker,odd,line_at_entry)
  select p_run_id, x.candidate_id, 'bet365_br', x.odd, x.line_at_entry
  from pg_catalog.jsonb_to_recordset(pg_catalog.coalesce(p_user_odds,'[]'::jsonb))
    as x(candidate_id uuid, odd numeric, line_at_entry numeric);

  insert into public.value_evaluations(
    run_id,candidate_id,odd,implied_probability,fair_odd,min_odd_target,edge_cons,ev_cons,
    w_eff,l_eff,probability_status,value_status,execution_status,rejection_reason
  )
  select p_run_id,x.candidate_id,x.odd,x.implied_probability,x.fair_odd,x.min_odd_target,
         x.edge_cons,x.ev_cons,x.w_eff,x.l_eff,x.probability_status,x.value_status,
         x.execution_status,x.rejection_reason
  from pg_catalog.jsonb_to_recordset(pg_catalog.coalesce(p_evaluations,'[]'::jsonb)) as x(
    candidate_id uuid, odd numeric, implied_probability numeric, fair_odd numeric,
    min_odd_target numeric, edge_cons numeric, ev_cons numeric, w_eff numeric, l_eff numeric,
    probability_status text, value_status text, execution_status text, rejection_reason text
  );

  insert into public.final_selections(run_id,evaluation_id,rank,explanation)
  select p_run_id, ve.id, s.rank, s.explanation
  from pg_catalog.jsonb_to_recordset(pg_catalog.coalesce(p_selections,'[]'::jsonb))
    as s(candidate_id uuid, rank integer, explanation text)
  join public.value_evaluations ve
    on ve.run_id = p_run_id and ve.candidate_id = s.candidate_id;

  select count(*) into v_count from public.final_selections fs where fs.run_id = p_run_id;
  update public.analysis_runs
  set selections_count = v_count, status = 'COMPLETED', updated_at = pg_catalog.now()
  where id = p_run_id and owner_id = p_owner_id;
  return v_count;
end;
$$;

revoke all on function public.replace_run_value_analysis_atomic(uuid,uuid,jsonb,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_run_value_analysis_atomic(uuid,uuid,jsonb,jsonb,jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4) Daily selection rule: maximum 3 every day, across all runs for owner/date.
-- DECLINED releases a slot; SETTLED still consumes it.
-- ---------------------------------------------------------------------------
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
    pg_catalog.hashtextextended(v_owner_id::text || ':' || pg_catalog.coalesce(v_target_date::text,'sem-data'), 0)
  );

  select count(*) into v_used
  from public.experimental_bet_tracking t
  join public.analysis_runs r on r.id = t.run_id
  where r.owner_id = v_owner_id
    and r.target_date is not distinct from v_target_date
    and t.id is distinct from NEW.id
    and t.bet_status in ('PROPOSED','OPEN','SETTLED');

  if v_used >= 3 then
    raise exception 'Limite diário de 3 seleções atingido.';
  end if;
  return NEW;
end;
$$;

revoke all on function public.enforce_experimental_selection_limit() from public, anon, authenticated;
grant execute on function public.enforce_experimental_selection_limit() to service_role;
comment on function public.enforce_experimental_selection_limit() is
  'Impõe no máximo 3 seleções por usuário/data em todos os dias; DECLINED libera vaga e SETTLED continua contando.';

-- ---------------------------------------------------------------------------
-- 5) Draft validation layer. Frontend may edit only fields explicitly flagged.
-- ---------------------------------------------------------------------------
create table if not exists public.analysis_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_request_id uuid not null,
  filename text not null,
  target_date date,
  headers text[] not null default '{}',
  leagues text[] not null default '{}',
  invalid_count integer not null default 0 check (invalid_count >= 0),
  status text not null default 'VALIDATING' check (status in ('VALIDATING','NEEDS_CORRECTION','READY','FINALIZED','CANCELLED')),
  final_run_id uuid references public.analysis_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,client_request_id)
);

create table if not exists public.analysis_draft_games (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.analysis_drafts(id) on delete cascade,
  ordinal integer not null check (ordinal >= 0),
  partida text not null,
  horario text not null,
  campeonato text not null,
  target_date date,
  validation_status text not null default 'PENDING' check (validation_status in ('PENDING','VALID','INVALID','AMBIGUOUS','SOURCE_UNAVAILABLE')),
  editable_fields text[] not null default '{}',
  validation_errors jsonb not null default '[]',
  suggestions jsonb not null default '[]',
  resolved_event_id bigint,
  resolved_home_team text,
  resolved_away_team text,
  resolved_competition text,
  resolved_kickoff timestamptz,
  resolver_confidence numeric,
  updated_at timestamptz not null default now(),
  unique(draft_id,ordinal),
  check (editable_fields <@ array['partida','horario','campeonato','target_date']::text[])
);

alter table public.analysis_drafts enable row level security;
alter table public.analysis_draft_games enable row level security;
revoke all on public.analysis_drafts, public.analysis_draft_games from public, anon, authenticated;
grant all on public.analysis_drafts, public.analysis_draft_games to service_role;

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
  values(p_owner_id,p_client_request_id,pg_catalog.left(p_filename,200),p_target_date,
         pg_catalog.coalesce(p_headers,'{}'),pg_catalog.coalesce(p_leagues,'{}'),pg_catalog.greatest(p_invalid_count,0))
  returning id into v_draft_id;

  insert into public.analysis_draft_games(draft_id,ordinal,partida,horario,campeonato,target_date)
  select v_draft_id, ordinality::integer-1,
         pg_catalog.btrim(x.value->>'partida'), pg_catalog.btrim(x.value->>'horario'),
         pg_catalog.btrim(x.value->>'campeonato'),
         pg_catalog.coalesce(nullif(x.value->>'targetDate','')::date,p_target_date)
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

  for v_item in select value from pg_catalog.jsonb_array_elements(pg_catalog.coalesce(p_corrections,'[]'::jsonb)) loop
    v_game_id := (v_item->>'gameId')::uuid;
    v_field := v_item->>'field';
    v_value := pg_catalog.btrim(pg_catalog.coalesce(v_item->>'value',''));
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

create or replace function public.finalize_analysis_draft_atomic(
  p_draft_id uuid,
  p_owner_id uuid,
  p_idempotency_key uuid
)
returns table(run_id uuid,reused boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft public.analysis_drafts%rowtype;
  v_dates integer;
  v_target date;
  v_rows jsonb;
  v_run uuid;
  v_reused boolean;
begin
  select * into v_draft from public.analysis_drafts d
    where d.id=p_draft_id and d.owner_id=p_owner_id for update;
  if not found then raise exception 'Rascunho não encontrado.'; end if;
  if v_draft.status='FINALIZED' and v_draft.final_run_id is not null then
    return query select v_draft.final_run_id,true; return;
  end if;
  if exists(select 1 from public.analysis_draft_games g where g.draft_id=p_draft_id and g.validation_status<>'VALID') then
    raise exception 'Ainda existem partidas que precisam de correção ou validação.';
  end if;
  select count(distinct target_date),min(target_date) into v_dates,v_target
    from public.analysis_draft_games where draft_id=p_draft_id;
  if v_dates<>1 or v_target is null then raise exception 'Todas as partidas precisam ter a mesma data válida.'; end if;

  select jsonb_agg(jsonb_build_object('partida',partida,'horario',horario,'campeonato',campeonato) order by ordinal)
    into v_rows from public.analysis_draft_games where draft_id=p_draft_id;

  select x.run_id,x.reused into v_run,v_reused
  from public.create_analysis_run_atomic(p_owner_id,p_idempotency_key,v_target,v_draft.filename,0,v_draft.leagues,v_draft.headers,v_rows) x;

  update public.analysis_drafts set status='FINALIZED',final_run_id=v_run,updated_at=pg_catalog.now() where id=p_draft_id;
  return query select v_run,v_reused;
end;
$$;

revoke all on function public.finalize_analysis_draft_atomic(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.finalize_analysis_draft_atomic(uuid,uuid,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6) User-choice opportunity queue: batches up to 10, max 3 accepted/day.
-- ---------------------------------------------------------------------------
create table if not exists public.decision_opportunity_queue (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.analysis_runs(id) on delete cascade,
  match_id uuid references public.matches(id) on delete cascade,
  prediction_id text not null,
  rank_global integer not null check(rank_global>0),
  batch_no integer,
  queue_state text not null default 'AVAILABLE' check(queue_state in ('AVAILABLE','SHOWN','ACCEPTED','DECLINED')),
  match_label text not null,
  competition text,
  market_family text not null,
  market text not null,
  market_label text not null,
  participant text,
  side text,
  line_canonical numeric,
  model_version text not null,
  model_status text not null,
  model_probability numeric not null check(model_probability>0 and model_probability<=1),
  fair_odd numeric,
  entry_odd numeric not null check(entry_odd>1),
  min_odd_target numeric,
  edge numeric,
  expected_value numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(run_id,prediction_id),
  unique(run_id,rank_global)
);

alter table public.decision_opportunity_queue enable row level security;
revoke all on public.decision_opportunity_queue from public,anon,authenticated;
grant all on public.decision_opportunity_queue to service_role;

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

  select pg_catalog.coalesce(max(q.batch_no),0)+1 into v_batch
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

create or replace function public.decline_decision_opportunity_atomic(
  p_queue_id uuid,
  p_owner_id uuid
)
returns table(declined boolean, exhausted boolean, accepted_count integer)
language plpgsql
security definer
set search_path=''
as $$
declare v_run uuid; v_target date; v_count integer; v_exhausted boolean;
begin
  select q.run_id,r.target_date into v_run,v_target
  from public.decision_opportunity_queue q join public.analysis_runs r on r.id=q.run_id
  where q.id=p_queue_id and r.owner_id=p_owner_id for update of q,r;
  if not found then raise exception 'Opção não encontrada.'; end if;
  update public.decision_opportunity_queue set queue_state='DECLINED',updated_at=pg_catalog.now()
    where id=p_queue_id and queue_state='SHOWN';
  if not found then return query select false,false,0; return; end if;
  select count(*) into v_count from public.decision_opportunity_queue where run_id=v_run and queue_state='ACCEPTED';
  select not exists(select 1 from public.decision_opportunity_queue where run_id=v_run and queue_state in ('AVAILABLE','SHOWN')) into v_exhausted;
  return query select true,v_exhausted,v_count;
end;
$$;
revoke all on function public.decline_decision_opportunity_atomic(uuid,uuid) from public,anon,authenticated;
grant execute on function public.decline_decision_opportunity_atomic(uuid,uuid) to service_role;

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
begin
  select q.* into v_q
  from public.decision_opportunity_queue q
  join public.analysis_runs r on r.id=q.run_id
  where q.id=p_queue_id and r.owner_id=p_owner_id
  for update of q;
  if not found then raise exception 'Opção não encontrada.'; end if;

  select r.target_date into v_target from public.analysis_runs r where r.id=v_q.run_id for update;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_id::text||':'||pg_catalog.coalesce(v_target::text,'sem-data'),0));
  select count(*) into v_count
  from public.decision_opportunity_queue q join public.analysis_runs r on r.id=q.run_id
  where r.owner_id=p_owner_id and r.target_date is not distinct from v_target and q.queue_state='ACCEPTED';
  if v_count>=3 then raise exception 'Limite diário de 3 escolhas atingido.'; end if;
  if v_q.queue_state<>'SHOWN' then return query select false,v_count,(v_count>=3); return; end if;

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

  return query select true,v_count,(v_count>=3);
end;
$$;
revoke all on function public.accept_decision_opportunity_atomic(uuid,uuid) from public,anon,authenticated;
grant execute on function public.accept_decision_opportunity_atomic(uuid,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7) Distributed 5Dollar rate state/cache/status/capability registry
-- ---------------------------------------------------------------------------
create table if not exists public.external_api_rate_state(
  provider text primary key,
  window_started_at timestamptz not null default now(),
  used_count integer not null default 0 check(used_count>=0),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);
create table if not exists public.external_api_cache(
  provider text not null,
  cache_key text not null,
  payload jsonb not null,
  http_status integer,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  primary key(provider,cache_key)
);
create index if not exists idx_external_api_cache_expiry on public.external_api_cache(expires_at);
create table if not exists public.external_api_status_snapshots(
  provider text primary key,
  plan text,
  reported_limit integer,
  payload jsonb not null default '{}',
  checked_at timestamptz not null default now()
);
create table if not exists public.external_api_capabilities(
  provider text not null,
  capability_key text not null,
  minimum_plan text not null,
  enabled boolean not null,
  reason text not null,
  metadata jsonb not null default '{}',
  reviewed_at date not null default current_date,
  primary key(provider,capability_key)
);

alter table public.external_api_rate_state enable row level security;
alter table public.external_api_cache enable row level security;
alter table public.external_api_status_snapshots enable row level security;
alter table public.external_api_capabilities enable row level security;
revoke all on public.external_api_rate_state,public.external_api_cache,public.external_api_status_snapshots,public.external_api_capabilities from public,anon,authenticated;
grant all on public.external_api_rate_state,public.external_api_cache,public.external_api_status_snapshots,public.external_api_capabilities to service_role;

insert into public.external_api_capabilities(provider,capability_key,minimum_plan,enabled,reason,metadata) values
('five_dollar','fixtures_window','pro',true,'Base operacional para resolução em lote.','{}'),
('five_dollar','bet365_snapshots','pro',true,'Odds opening/closing para mercados com contrato validado.','{}'),
('five_dollar','events_stats','pro',true,'Captura para pesquisa; não entra no modelo sem walk-forward aprovado.','{"model_feature_gate":"research_only"}'),
('five_dollar','corner_card_standings','pro',true,'Priors capturados e pré-aquecidos fora da interação.','{}'),
('five_dollar','btts_price','pro',false,'Preço existe, mas mercado permanece desligado até modelo/regra de negócio validados.','{"gate":"business_model_validation"}'),
('five_dollar','odds_tick_history','ultra',false,'Não chamar no plano Pro; recurso Ultra.','{"endpoint":"/fixtures/{id}/odds/history"}')
on conflict(provider,capability_key) do update set minimum_plan=excluded.minimum_plan,enabled=excluded.enabled,
 reason=excluded.reason,metadata=excluded.metadata,reviewed_at=current_date;

create or replace function public.acquire_external_api_slot(
  p_provider text,
  p_limit integer default 9,
  p_window_seconds integer default 60
)
returns table(allowed boolean,remaining integer,reset_at timestamptz)
language plpgsql
security definer
set search_path=''
as $$
declare v public.external_api_rate_state%rowtype; v_now timestamptz:=pg_catalog.clock_timestamp();
begin
  if p_limit<1 or p_limit>100 or p_window_seconds<1 or p_window_seconds>3600 then raise exception 'Configuração de rate limit inválida.'; end if;
  insert into public.external_api_rate_state(provider) values(p_provider) on conflict(provider) do nothing;
  select * into v from public.external_api_rate_state where provider=p_provider for update;
  if v.blocked_until is not null and v.blocked_until>v_now then
    return query select false,0,v.blocked_until; return;
  end if;
  if v.window_started_at + pg_catalog.make_interval(secs=>p_window_seconds)<=v_now then
    v.window_started_at:=v_now; v.used_count:=0;
  end if;
  if v.used_count>=p_limit then
    update public.external_api_rate_state set window_started_at=v.window_started_at,used_count=v.used_count,
      blocked_until=null,updated_at=v_now where provider=p_provider;
    return query select false,0,v.window_started_at+pg_catalog.make_interval(secs=>p_window_seconds); return;
  end if;
  v.used_count:=v.used_count+1;
  update public.external_api_rate_state set window_started_at=v.window_started_at,used_count=v.used_count,
    blocked_until=null,updated_at=v_now where provider=p_provider;
  return query select true,p_limit-v.used_count,v.window_started_at+pg_catalog.make_interval(secs=>p_window_seconds);
end;
$$;
revoke all on function public.acquire_external_api_slot(text,integer,integer) from public,anon,authenticated;
grant execute on function public.acquire_external_api_slot(text,integer,integer) to service_role;

create or replace function public.mark_external_api_rate_limited(p_provider text,p_retry_after_seconds integer)
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.external_api_rate_state(provider,blocked_until,updated_at)
  values(p_provider,pg_catalog.now()+pg_catalog.make_interval(secs=>pg_catalog.greatest(1,p_retry_after_seconds)),pg_catalog.now())
  on conflict(provider) do update set blocked_until=excluded.blocked_until,updated_at=excluded.updated_at;
end;$$;
revoke all on function public.mark_external_api_rate_limited(text,integer) from public,anon,authenticated;
grant execute on function public.mark_external_api_rate_limited(text,integer) to service_role;

-- Maintenance capability token. It is never exposed to browser roles.
create table if not exists private.external_api_maintenance_config(
  singleton boolean primary key default true check(singleton),
  dispatch_token uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now()
);
insert into private.external_api_maintenance_config(singleton) values(true) on conflict(singleton) do nothing;
revoke all on private.external_api_maintenance_config from public,anon,authenticated;
grant select,update on private.external_api_maintenance_config to service_role;

create or replace function public.validate_external_api_maintenance_token(p_token uuid)
returns boolean language sql security definer set search_path='' stable as $$
  select exists(select 1 from private.external_api_maintenance_config where singleton=true and dispatch_token=p_token)
$$;
revoke all on function public.validate_external_api_maintenance_token(uuid) from public,anon,authenticated;
grant execute on function public.validate_external_api_maintenance_token(uuid) to service_role;

create or replace function public.kick_external_api_maintenance()
returns bigint language plpgsql security definer set search_path='' as $$
declare v_token uuid; v_request bigint;
begin
  select dispatch_token into v_token from private.external_api_maintenance_config where singleton=true;
  select net.http_post(
    url:='https://quant-football-insights.lovable.app/api/five-dollar-maintenance',
    body:=pg_catalog.jsonb_build_object('dispatchToken',v_token),
    params:='{}'::jsonb,
    headers:=pg_catalog.jsonb_build_object('Content-Type','application/json'),
    timeout_milliseconds:=120000
  ) into v_request;
  return v_request;
end;$$;
revoke all on function public.kick_external_api_maintenance() from public,anon,authenticated;
grant execute on function public.kick_external_api_maintenance() to service_role;

do $$ begin
  if exists(select 1 from cron.job where jobname='five-dollar-maintenance-daily') then
    perform cron.unschedule('five-dollar-maintenance-daily');
  end if;
end $$;
select cron.schedule('five-dollar-maintenance-daily','10 06 * * *','select public.kick_external_api_maintenance();');

-- bounded cache cleanup
create or replace function public.cleanup_external_api_cache()
returns integer language plpgsql security definer set search_path='' as $$
declare v integer; begin
  delete from public.external_api_cache where expires_at<pg_catalog.now(); get diagnostics v=row_count; return v;
end;$$;
revoke all on function public.cleanup_external_api_cache() from public,anon,authenticated;
grant execute on function public.cleanup_external_api_cache() to service_role;

insert into public.app_schema_releases(version,migration_name,notes)
values('20260912-backend-api-funnel','backend_api_funnel_hardening',
'Atomic run/job operations, daily max-3 selection, staged CSV validation, 10-item decision queue, distributed API rate/cache state, capability registry and maintenance dispatch.')
on conflict(version) do update set migration_name=excluded.migration_name,notes=excluded.notes,applied_at=now();
