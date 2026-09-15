-- 1) Fix mutable search_path on application functions (all objects already schema-qualified)
alter function public.elo_is_target_league(text, text) set search_path = '';
alter function public.elo_league_key(text, text) set search_path = '';
alter function public.normalize_brazil_league_lineage() set search_path = '';
alter function public.normalize_prediction_outcome_distribution() set search_path = '';

-- 2) Owner-scoped RLS policies (browser roles hold no table grants; policies are defense in depth)
drop policy if exists analysis_drafts_owner_select on public.analysis_drafts;
drop policy if exists analysis_drafts_owner_insert on public.analysis_drafts;
drop policy if exists analysis_drafts_owner_update on public.analysis_drafts;
drop policy if exists analysis_drafts_owner_delete on public.analysis_drafts;

create policy analysis_drafts_owner_select on public.analysis_drafts
  for select to authenticated
  using (private.is_authorized_app_user() and owner_id = (select auth.uid()));
create policy analysis_drafts_owner_insert on public.analysis_drafts
  for insert to authenticated
  with check (private.is_authorized_app_user() and owner_id = (select auth.uid()));
create policy analysis_drafts_owner_update on public.analysis_drafts
  for update to authenticated
  using (private.is_authorized_app_user() and owner_id = (select auth.uid()))
  with check (private.is_authorized_app_user() and owner_id = (select auth.uid()));
create policy analysis_drafts_owner_delete on public.analysis_drafts
  for delete to authenticated
  using (private.is_authorized_app_user() and owner_id = (select auth.uid()));

drop policy if exists analysis_draft_games_owner_select on public.analysis_draft_games;
drop policy if exists analysis_draft_games_owner_insert on public.analysis_draft_games;
drop policy if exists analysis_draft_games_owner_update on public.analysis_draft_games;
drop policy if exists analysis_draft_games_owner_delete on public.analysis_draft_games;

create policy analysis_draft_games_owner_select on public.analysis_draft_games
  for select to authenticated
  using (exists (
    select 1 from public.analysis_drafts d
    where d.id = analysis_draft_games.draft_id
      and d.owner_id = (select auth.uid())
      and private.is_authorized_app_user()
  ));
create policy analysis_draft_games_owner_insert on public.analysis_draft_games
  for insert to authenticated
  with check (exists (
    select 1 from public.analysis_drafts d
    where d.id = analysis_draft_games.draft_id
      and d.owner_id = (select auth.uid())
      and private.is_authorized_app_user()
  ));
create policy analysis_draft_games_owner_update on public.analysis_draft_games
  for update to authenticated
  using (exists (
    select 1 from public.analysis_drafts d
    where d.id = analysis_draft_games.draft_id
      and d.owner_id = (select auth.uid())
      and private.is_authorized_app_user()
  ))
  with check (exists (
    select 1 from public.analysis_drafts d
    where d.id = analysis_draft_games.draft_id
      and d.owner_id = (select auth.uid())
      and private.is_authorized_app_user()
  ));
create policy analysis_draft_games_owner_delete on public.analysis_draft_games
  for delete to authenticated
  using (exists (
    select 1 from public.analysis_drafts d
    where d.id = analysis_draft_games.draft_id
      and d.owner_id = (select auth.uid())
      and private.is_authorized_app_user()
  ));

drop policy if exists run_owner_select on public.decision_opportunity_queue;
drop policy if exists run_owner_insert on public.decision_opportunity_queue;
drop policy if exists run_owner_update on public.decision_opportunity_queue;
drop policy if exists run_owner_delete on public.decision_opportunity_queue;

create policy run_owner_select on public.decision_opportunity_queue
  for select to authenticated using (private.owns_run(run_id));
create policy run_owner_insert on public.decision_opportunity_queue
  for insert to authenticated with check (private.owns_run(run_id));
create policy run_owner_update on public.decision_opportunity_queue
  for update to authenticated using (private.owns_run(run_id)) with check (private.owns_run(run_id));
create policy run_owner_delete on public.decision_opportunity_queue
  for delete to authenticated using (private.owns_run(run_id));

drop policy if exists push_delivery_outbox_select_own on public.push_delivery_outbox;

create policy push_delivery_outbox_select_own on public.push_delivery_outbox
  for select to authenticated
  using (private.is_authorized_app_user() and user_id = (select auth.uid()));