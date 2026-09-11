-- Persist every experimental odds/value evaluation so the detailed result can
-- be reconstructed server-side. This is an audit ledger, separate from
-- experimental_bet_tracking (which remains the bet/suggestion lifecycle).

CREATE TABLE IF NOT EXISTS public.experimental_value_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
  prediction_id text NOT NULL,
  match_id uuid REFERENCES public.matches(id) ON DELETE SET NULL,
  market text NOT NULL,
  market_label text NOT NULL,
  participant text,
  side text,
  line_canonical numeric,
  bookmaker text NOT NULL DEFAULT 'bet365_br',
  price_source text NOT NULL DEFAULT 'USER_OR_AUTOMATIC_INPUT',
  odd numeric NOT NULL CHECK (odd > 1),
  model_probability numeric NOT NULL,
  decision_probability numeric,
  fair_odd numeric,
  min_odd_target numeric,
  edge numeric,
  expected_value numeric,
  probability_status text NOT NULL,
  value_status text NOT NULL,
  execution_status text NOT NULL,
  rejection_reason text,
  selected boolean NOT NULL DEFAULT false,
  model_version text,
  model_status text NOT NULL,
  production_status text NOT NULL,
  market_family text NOT NULL,
  evaluation_fingerprint text NOT NULL,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT experimental_value_evaluations_identity UNIQUE (run_id, prediction_id, evaluation_fingerprint)
);

CREATE INDEX IF NOT EXISTS experimental_value_evaluations_run_idx
  ON public.experimental_value_evaluations (run_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS experimental_value_evaluations_prediction_idx
  ON public.experimental_value_evaluations (prediction_id, evaluated_at DESC);

ALTER TABLE public.experimental_value_evaluations ENABLE ROW LEVEL SECURITY;

-- Operational evaluation data is server-only. Authenticated browser access is
-- intentionally denied; server functions use the service-role boundary.
REVOKE ALL ON TABLE public.experimental_value_evaluations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.experimental_value_evaluations TO service_role;

COMMENT ON TABLE public.experimental_value_evaluations IS
  'Append-only audit ledger of every experimental odds/value evaluation. Separate from bet tracking; written/read only through the server boundary.';

-- One canonical detailed snapshot per run. The ledger above remains append-only
-- for audit history while this snapshot supports fast, deterministic recovery
-- of the latest result screen on another browser/device.
CREATE TABLE IF NOT EXISTS public.experimental_analysis_results (
  run_id uuid PRIMARY KEY REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
  result_payload jsonb NOT NULL,
  analyzed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.experimental_analysis_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.experimental_analysis_results FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.experimental_analysis_results TO service_role;

COMMENT ON TABLE public.experimental_analysis_results IS
  'Latest canonical server-side result payload for an experimental run; localStorage is cache only.';