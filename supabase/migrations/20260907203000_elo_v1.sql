-- Elo v1: ledger de partidas, ratings atuais, histórico e contexto usado nas previsões.
-- Sem políticas públicas: acesso apenas pelo backend/service role.

create table if not exists public.elo_fixtures (
  source text not null default 'five_dollar_football',
  league_id bigint not null,
  league_key text not null,
  league_name text not null,
  country_code text,
  fixture_id bigint not null,
  kickoff_at timestamptz not null,
  home_team_id bigint not null,
  home_team_name text not null,
  away_team_id bigint not null,
  away_team_name text not null,
  home_goals integer not null check (home_goals >= 0),
  away_goals integer not null check (away_goals >= 0),
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source, league_id, fixture_id)
);

create index if not exists elo_fixtures_kickoff_idx
  on public.elo_fixtures (league_id, kickoff_at);
create index if not exists elo_fixtures_team_idx
  on public.elo_fixtures (home_team_id, away_team_id);

create table if not exists public.elo_team_ratings (
  model_version text not null,
  league_id bigint not null,
  league_key text not null,
  league_name text not null,
  team_id bigint not null,
  team_name text not null,
  rating numeric not null,
  matches_processed integer not null default 0,
  first_fixture_at timestamptz,
  last_fixture_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (model_version, league_id, team_id)
);

create index if not exists elo_team_ratings_team_idx
  on public.elo_team_ratings (model_version, team_id, last_fixture_at desc);

create table if not exists public.elo_fixture_history (
  model_version text not null,
  league_id bigint not null,
  league_key text not null,
  league_name text not null,
  fixture_id bigint not null,
  kickoff_at timestamptz not null,
  home_team_id bigint not null,
  home_team_name text not null,
  away_team_id bigint not null,
  away_team_name text not null,
  home_goals integer not null,
  away_goals integer not null,
  home_rating_before numeric not null,
  away_rating_before numeric not null,
  home_rating_after numeric not null,
  away_rating_after numeric not null,
  home_advantage_points numeric not null,
  expected_home_score numeric not null,
  actual_home_score numeric not null,
  elo_delta numeric not null,
  created_at timestamptz not null default now(),
  primary key (model_version, league_id, fixture_id)
);

create index if not exists elo_fixture_history_kickoff_idx
  on public.elo_fixture_history (model_version, league_id, kickoff_at);

create table if not exists public.elo_sync_state (
  id text primary key default 'main',
  source text not null default 'five_dollar_football',
  model_version text not null,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_status text not null default 'NEVER_RUN',
  leagues_processed integer not null default 0,
  fixtures_fetched integer not null default 0,
  api_requests integer not null default 0,
  error_message text,
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.elo_prediction_context (
  run_id uuid not null references public.analysis_runs(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  prediction_at timestamptz not null,
  model_version text not null,
  league_id bigint not null,
  home_team_id bigint not null,
  away_team_id bigint not null,
  home_rating numeric not null,
  away_rating numeric not null,
  elo_delta numeric not null,
  base_lambda_home numeric not null,
  base_lambda_away numeric not null,
  adjusted_lambda_home numeric not null,
  adjusted_lambda_away numeric not null,
  created_at timestamptz not null default now(),
  primary key (run_id, match_id)
);

alter table public.elo_fixtures enable row level security;
alter table public.elo_team_ratings enable row level security;
alter table public.elo_fixture_history enable row level security;
alter table public.elo_sync_state enable row level security;
alter table public.elo_prediction_context enable row level security;

revoke all on public.elo_fixtures from anon, authenticated;
revoke all on public.elo_team_ratings from anon, authenticated;
revoke all on public.elo_fixture_history from anon, authenticated;
revoke all on public.elo_sync_state from anon, authenticated;
revoke all on public.elo_prediction_context from anon, authenticated;
