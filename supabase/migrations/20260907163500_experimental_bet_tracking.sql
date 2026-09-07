CREATE TABLE IF NOT EXISTS public.experimental_bet_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
  match_id uuid REFERENCES public.matches(id) ON DELETE CASCADE,
  prediction_id text NOT NULL,
  target_date date,
  match_label text NOT NULL,
  competition text,
  market_family text NOT NULL,
  market text NOT NULL,
  market_label text NOT NULL,
  participant text,
  side text,
  line_canonical numeric,
  model_version text NOT NULL,
  model_status text NOT NULL,
  model_probability numeric NOT NULL,
  fair_odd numeric,
  entry_odd numeric NOT NULL,
  min_odd_target numeric,
  edge numeric,
  expected_value numeric,
  closing_odd numeric,
  result text NOT NULL DEFAULT 'PENDING',
  profit_units numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE (run_id, prediction_id)
);

CREATE INDEX IF NOT EXISTS idx_experimental_bet_tracking_target_date
  ON public.experimental_bet_tracking(target_date);
CREATE INDEX IF NOT EXISTS idx_experimental_bet_tracking_market_family
  ON public.experimental_bet_tracking(market_family);
CREATE INDEX IF NOT EXISTS idx_experimental_bet_tracking_result
  ON public.experimental_bet_tracking(result);

GRANT ALL ON public.experimental_bet_tracking TO service_role;
ALTER TABLE public.experimental_bet_tracking ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.experimental_bet_tracking IS
  'Ledger do piloto experimental. Registra apenas seleções finais do Motor 2; closing_odd/result ficam pendentes para settlement posterior.';
