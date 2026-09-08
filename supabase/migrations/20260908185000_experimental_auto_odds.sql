create table if not exists public.experimental_odds_snapshots (
  run_id uuid not null references public.analysis_runs(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  prediction_id text not null,
  fixture_id bigint not null,
  bookmaker text not null default 'bet365',
  market text not null,
  side text,
  model_line numeric,
  offered_line numeric,
  odd numeric,
  stage text,
  api_market text,
  status text not null,
  reason text not null,
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (run_id, prediction_id),
  constraint experimental_odds_snapshots_stage_check
    check (stage is null or stage in ('opening','closing')),
  constraint experimental_odds_snapshots_status_check
    check (status in ('MATCHED','LINE_MISMATCH','UNSUPPORTED','NO_PRICE','SOURCE_UNAVAILABLE')),
  constraint experimental_odds_snapshots_odd_check
    check (odd is null or odd > 1)
);

create index if not exists experimental_odds_snapshots_match_idx
  on public.experimental_odds_snapshots (run_id, match_id);
create index if not exists experimental_odds_snapshots_status_idx
  on public.experimental_odds_snapshots (run_id, status);

alter table public.experimental_odds_snapshots enable row level security;
revoke all on public.experimental_odds_snapshots from anon, authenticated;

comment on table public.experimental_odds_snapshots is
  'Audit trail of Bet365 pre-match prices fetched via 5Dollar after Motor 1 generated probabilities.';
