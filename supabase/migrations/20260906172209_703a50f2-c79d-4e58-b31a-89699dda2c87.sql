
CREATE TABLE public.analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'CREATED',
  current_step text,
  matches_total int NOT NULL DEFAULT 0,
  matches_resolved int NOT NULL DEFAULT 0,
  matches_failed int NOT NULL DEFAULT 0,
  candidates_published int NOT NULL DEFAULT 0,
  candidates_blocked int NOT NULL DEFAULT 0,
  selections_count int NOT NULL DEFAULT 0,
  notes jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.uploaded_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
  filename text NOT NULL,
  row_count int NOT NULL DEFAULT 0,
  invalid_row_count int NOT NULL DEFAULT 0,
  leagues text[] NOT NULL DEFAULT '{}',
  raw_headers text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
  raw_partida text NOT NULL,
  raw_horario text NOT NULL,
  raw_campeonato text NOT NULL,
  home_team text,
  away_team text,
  competition text,
  country text,
  season text,
  kickoff_local timestamptz,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  resolver_confidence numeric,
  resolution_status text NOT NULL DEFAULT 'PENDING',
  resolution_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.match_external_ids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  source text NOT NULL,
  external_id text NOT NULL,
  confidence numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.source_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL UNIQUE,
  definition_version text NOT NULL,
  metric_definitions jsonb NOT NULL DEFAULT '{}'::jsonb,
  configured boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.source_fetches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
  match_id uuid REFERENCES public.matches(id) ON DELETE CASCADE,
  source text NOT NULL,
  status text NOT NULL,
  http_status int,
  error_message text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  attempt int NOT NULL DEFAULT 1
);

CREATE TABLE public.raw_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
  match_id uuid REFERENCES public.matches(id) ON DELETE CASCADE,
  source text NOT NULL,
  metric text NOT NULL,
  raw_value jsonb,
  observed_at timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  definition_version text
);

CREATE TABLE public.normalized_match_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
  match_id uuid REFERENCES public.matches(id) ON DELETE CASCADE,
  scope text NOT NULL,
  metric text NOT NULL,
  normalized_value numeric,
  sample_size int,
  source text,
  definition_version text,
  lineage jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.model_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_family text NOT NULL,
  model_version text NOT NULL,
  calibration_version text,
  validation_status text NOT NULL DEFAULT 'NOT_VALIDATED',
  out_of_sample_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.model_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
  match_id uuid REFERENCES public.matches(id) ON DELETE CASCADE,
  prediction_id text NOT NULL,
  market text NOT NULL,
  participant text,
  side text,
  line_raw text,
  line_canonical numeric,
  model_probability numeric,
  p_cal numeric,
  conservative_probability numeric,
  outcome_distribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_version text,
  calibration_version text,
  model_status text NOT NULL,
  data_status text NOT NULL,
  prediction_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.market_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
  match_id uuid REFERENCES public.matches(id) ON DELETE CASCADE,
  prediction_id text NOT NULL,
  market text NOT NULL,
  market_family text NOT NULL,
  participant text,
  side text,
  line_raw text,
  line_canonical numeric,
  market_label text NOT NULL,
  p_cal numeric,
  p_cons numeric,
  fair_odd_info numeric,
  confidence_score numeric,
  data_quality_score numeric,
  sample_reliability numeric,
  uncertainty numeric,
  stability numeric,
  market_score numeric,
  settlement_definition text,
  model_status text NOT NULL,
  data_status text NOT NULL,
  published boolean NOT NULL DEFAULT false,
  block_reason text,
  reason_short text,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, prediction_id)
);

CREATE TABLE public.user_odds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.market_candidates(id) ON DELETE CASCADE,
  bookmaker text NOT NULL DEFAULT 'bet365_br',
  odd numeric NOT NULL,
  line_at_entry numeric,
  entered_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.value_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.market_candidates(id) ON DELETE CASCADE,
  odd numeric NOT NULL,
  implied_probability numeric,
  fair_odd numeric,
  min_odd_target numeric,
  edge_cons numeric,
  ev_cons numeric,
  w_eff numeric,
  l_eff numeric,
  probability_status text NOT NULL,
  value_status text NOT NULL,
  execution_status text NOT NULL,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.final_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
  evaluation_id uuid NOT NULL REFERENCES public.value_evaluations(id) ON DELETE CASCADE,
  rank int NOT NULL,
  explanation text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.pipeline_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
  step text NOT NULL,
  level text NOT NULL DEFAULT 'INFO',
  message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_matches_run ON public.matches(run_id);
CREATE INDEX idx_candidates_run ON public.market_candidates(run_id);
CREATE INDEX idx_logs_run ON public.pipeline_logs(run_id);

GRANT ALL ON public.analysis_runs TO service_role;
GRANT ALL ON public.uploaded_files TO service_role;
GRANT ALL ON public.matches TO service_role;
GRANT ALL ON public.match_external_ids TO service_role;
GRANT ALL ON public.source_definitions TO service_role;
GRANT ALL ON public.source_fetches TO service_role;
GRANT ALL ON public.raw_observations TO service_role;
GRANT ALL ON public.normalized_match_stats TO service_role;
GRANT ALL ON public.model_versions TO service_role;
GRANT ALL ON public.model_predictions TO service_role;
GRANT ALL ON public.market_candidates TO service_role;
GRANT ALL ON public.user_odds TO service_role;
GRANT ALL ON public.value_evaluations TO service_role;
GRANT ALL ON public.final_selections TO service_role;
GRANT ALL ON public.pipeline_logs TO service_role;

ALTER TABLE public.analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uploaded_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_external_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_fetches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.normalized_match_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_odds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.value_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.final_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_logs ENABLE ROW LEVEL SECURITY;

INSERT INTO public.source_definitions (source, definition_version, configured, notes, metric_definitions) VALUES
 ('sofascore','sofascore-v0',false,'Adapter preparado, credenciais/endpoint nao configurados','{"corners":"corners_taken","cards":"yellow=1,red=2"}'::jsonb),
 ('ogol','ogol-v0',false,'Adapter preparado, nao configurado','{}'::jsonb),
 ('transfermarkt','transfermarkt-v0',false,'Adapter preparado, nao configurado','{}'::jsonb),
 ('opta','opta-v0',false,'Requer API licenciada; nunca simular','{"shots":"Opta shots","shots_on_target":"Opta shots on target"}'::jsonb);

INSERT INTO public.model_versions (market_family, model_version, calibration_version, validation_status) VALUES
 ('1X2','goals-bivariate-v0',NULL,'NOT_PRODUCTION_VALIDATED'),
 ('BTTS','goals-bivariate-v0',NULL,'NOT_PRODUCTION_VALIDATED'),
 ('CORNERS','count-v0',NULL,'NOT_PRODUCTION_VALIDATED'),
 ('CARDS','count-v0',NULL,'NOT_PRODUCTION_VALIDATED'),
 ('SHOTS','count-v0',NULL,'NOT_PRODUCTION_VALIDATED'),
 ('SHOTS_ON_TARGET','count-v0',NULL,'NOT_PRODUCTION_VALIDATED');
