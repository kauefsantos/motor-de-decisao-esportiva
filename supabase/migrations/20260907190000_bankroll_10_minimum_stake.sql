ALTER TABLE public.experimental_bankroll_config
  ADD COLUMN IF NOT EXISTS min_stake_brl numeric NOT NULL DEFAULT 0.50
  CHECK (min_stake_brl >= 0);

UPDATE public.experimental_bankroll_config
SET
  start_date = '2026-09-07',
  initial_bankroll = 10.00,
  max_stake_pct = 0.05,
  min_stake_brl = 0.50,
  updated_at = now()
WHERE id = 'main';

COMMENT ON COLUMN public.experimental_bankroll_config.min_stake_brl IS
  'Aposta mínima operacional da bet365 Brasil. Valor positivo confirmado nunca pode ficar abaixo deste piso.';
