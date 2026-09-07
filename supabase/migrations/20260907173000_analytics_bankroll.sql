ALTER TABLE public.experimental_bet_tracking
  ADD COLUMN IF NOT EXISTS stake_brl numeric,
  ADD COLUMN IF NOT EXISTS profit_brl numeric,
  ADD COLUMN IF NOT EXISTS notes text;

CREATE TABLE IF NOT EXISTS public.experimental_bankroll_config (
  id text PRIMARY KEY DEFAULT 'main',
  start_date date NOT NULL,
  initial_bankroll numeric NOT NULL CHECK (initial_bankroll >= 0),
  max_stake_pct numeric NOT NULL DEFAULT 0.02 CHECK (max_stake_pct >= 0 AND max_stake_pct <= 1),
  fractional_kelly numeric NOT NULL DEFAULT 0.25 CHECK (fractional_kelly >= 0 AND fractional_kelly <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.experimental_bankroll_config (
  id, start_date, initial_bankroll, max_stake_pct, fractional_kelly, updated_at
)
VALUES ('main', '2026-09-08', 5.00, 0.02, 0.25, now())
ON CONFLICT (id) DO UPDATE SET
  start_date = EXCLUDED.start_date,
  initial_bankroll = EXCLUDED.initial_bankroll,
  max_stake_pct = EXCLUDED.max_stake_pct,
  fractional_kelly = EXCLUDED.fractional_kelly,
  updated_at = now();

GRANT ALL ON public.experimental_bankroll_config TO service_role;
ALTER TABLE public.experimental_bankroll_config ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.experimental_bankroll_config IS
  'Configuração do acompanhamento experimental. Banca inicial R$ 5,00 a partir de 08/09/2026.';
