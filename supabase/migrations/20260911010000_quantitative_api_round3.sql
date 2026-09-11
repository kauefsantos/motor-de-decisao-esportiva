-- Backend quantitative/API round 3.
-- Persist opening/closing evidence and diagnostic 5Dollar corner/card standings.

ALTER TABLE public.experimental_bet_tracking
  ADD COLUMN IF NOT EXISTS opening_odd numeric,
  ADD COLUMN IF NOT EXISTS opening_line numeric,
  ADD COLUMN IF NOT EXISTS closing_line numeric,
  ADD COLUMN IF NOT EXISTS closing_stage text,
  ADD COLUMN IF NOT EXISTS clv_pct numeric,
  ADD COLUMN IF NOT EXISTS clv_implied_delta numeric,
  ADD COLUMN IF NOT EXISTS clv_status text,
  ADD COLUMN IF NOT EXISTS closing_fetched_at timestamptz,
  ADD COLUMN IF NOT EXISTS closing_source text;

COMMENT ON COLUMN public.experimental_bet_tracking.opening_odd IS
  'Bet365 opening price for the same contract when the Pro snapshot exposes it; diagnostic only.';
COMMENT ON COLUMN public.experimental_bet_tracking.opening_line IS
  'Bet365 opening line for the market. Never compare its price to another total line as if it were the same contract.';
COMMENT ON COLUMN public.experimental_bet_tracking.clv_pct IS
  'Closing-line value as entry_odd / closing_odd - 1. Positive means the accepted price beat the same-contract Bet365 closing price.';
COMMENT ON COLUMN public.experimental_bet_tracking.clv_implied_delta IS
  '1/closing_odd - 1/entry_odd for the exact same contract. Positive means the accepted price implied a lower probability than closing.';
COMMENT ON COLUMN public.experimental_bet_tracking.clv_status IS
  'MATCHED, LINE_MOVED, NO_CLOSING_PRICE, UNSUPPORTED or SOURCE_UNAVAILABLE. CLV is never compared across different total lines.';

CREATE TABLE IF NOT EXISTS public.five_dollar_league_priors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id bigint NOT NULL,
  prior_type text NOT NULL CHECK (prior_type IN ('corner','card')),
  season text,
  source_kind text,
  round_label text,
  team_id bigint NOT NULL,
  team_name text NOT NULL,
  played integer,
  total_for numeric,
  total_against numeric,
  average_for numeric,
  average_against numeric,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot_date date NOT NULL,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (league_id, prior_type, team_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_five_dollar_league_priors_lookup
  ON public.five_dollar_league_priors (league_id, prior_type, snapshot_date DESC);

ALTER TABLE public.five_dollar_league_priors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.five_dollar_league_priors FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.five_dollar_league_priors TO service_role;

COMMENT ON TABLE public.five_dollar_league_priors IS
  'Point-in-time corner/card standings snapshots from 5Dollar. Diagnostic/research only until a chronological walk-forward validation explicitly approves a feature version.';
