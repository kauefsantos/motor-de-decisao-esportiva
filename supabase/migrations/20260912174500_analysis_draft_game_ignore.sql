alter table public.analysis_draft_games
  add column if not exists ignored boolean not null default false;

create or replace function public.finalize_analysis_draft_atomic(
  p_draft_id uuid,
  p_owner_id uuid,
  p_idempotency_key uuid
)
returns table(run_id uuid, reused boolean)
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_draft public.analysis_drafts%rowtype;
  v_dates integer;
  v_target date;
  v_rows jsonb;
  v_run uuid;
  v_reused boolean;
  v_active_count integer;
begin
  select * into v_draft
  from public.analysis_drafts d
  where d.id=p_draft_id and d.owner_id=p_owner_id
  for update;

  if not found then raise exception 'Rascunho não encontrado.'; end if;
  if v_draft.status='FINALIZED' and v_draft.final_run_id is not null then
    return query select v_draft.final_run_id,true;
    return;
  end if;

  select count(*) into v_active_count
  from public.analysis_draft_games g
  where g.draft_id=p_draft_id and not g.ignored;

  if v_active_count=0 then
    raise exception 'Escolha pelo menos uma partida para analisar.';
  end if;

  if exists(
    select 1
    from public.analysis_draft_games g
    where g.draft_id=p_draft_id
      and not g.ignored
      and g.validation_status<>'VALID'
  ) then
    raise exception 'Ainda existem partidas que precisam de correção ou validação.';
  end if;

  select count(distinct target_date),min(target_date)
  into v_dates,v_target
  from public.analysis_draft_games
  where draft_id=p_draft_id and not ignored;

  if v_dates<>1 or v_target is null then
    raise exception 'Todas as partidas analisadas precisam ter a mesma data válida.';
  end if;

  select jsonb_agg(
    jsonb_build_object('partida',partida,'horario',horario,'campeonato',campeonato)
    order by ordinal
  )
  into v_rows
  from public.analysis_draft_games
  where draft_id=p_draft_id and not ignored;

  select x.run_id,x.reused into v_run,v_reused
  from public.create_analysis_run_atomic(
    p_owner_id,
    p_idempotency_key,
    v_target,
    v_draft.filename,
    0,
    v_draft.leagues,
    v_draft.headers,
    v_rows
  ) x;

  update public.analysis_drafts
  set status='FINALIZED',final_run_id=v_run,updated_at=pg_catalog.now()
  where id=p_draft_id;

  return query select v_run,v_reused;
end;
$function$;
