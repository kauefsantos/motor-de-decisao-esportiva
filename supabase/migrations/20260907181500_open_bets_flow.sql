ALTER TABLE public.experimental_bet_tracking
  ADD COLUMN IF NOT EXISTS bet_status text NOT NULL DEFAULT 'PROPOSED',
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS declined_at timestamptz,
  ADD COLUMN IF NOT EXISTS selection_rank integer;

UPDATE public.experimental_bet_tracking
SET bet_status = CASE
  WHEN result <> 'PENDING' THEN 'SETTLED'
  WHEN stake_brl IS NOT NULL AND stake_brl > 0 THEN 'OPEN'
  ELSE 'PROPOSED'
END
WHERE bet_status IS NULL OR bet_status NOT IN ('PROPOSED','OPEN','DECLINED','SETTLED');

ALTER TABLE public.experimental_bet_tracking
  DROP CONSTRAINT IF EXISTS experimental_bet_tracking_bet_status_check;
ALTER TABLE public.experimental_bet_tracking
  ADD CONSTRAINT experimental_bet_tracking_bet_status_check
  CHECK (bet_status IN ('PROPOSED','OPEN','DECLINED','SETTLED'));

CREATE INDEX IF NOT EXISTS idx_experimental_bet_tracking_bet_status
  ON public.experimental_bet_tracking(bet_status);
CREATE INDEX IF NOT EXISTS idx_experimental_bet_tracking_run_rank
  ON public.experimental_bet_tracking(run_id, selection_rank);
