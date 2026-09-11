-- A settled bet still consumed one of the day's final-selection slots.
-- Only DECLINED releases a slot for a replacement.
CREATE OR REPLACE FUNCTION public.enforce_experimental_selection_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target_date date;
  v_limit integer := 2;
  v_used integer := 0;
BEGIN
  IF NEW.bet_status NOT IN ('PROPOSED', 'OPEN', 'SETTLED') THEN
    RETURN NEW;
  END IF;

  -- Moving an already-counted selection between PROPOSED/OPEN/SETTLED does not
  -- consume a second slot.
  IF TG_OP = 'UPDATE' AND OLD.bet_status IN ('PROPOSED', 'OPEN', 'SETTLED') THEN
    RETURN NEW;
  END IF;

  SELECT r.target_date
    INTO v_target_date
  FROM public.analysis_runs AS r
  WHERE r.id = NEW.run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rodada experimental não encontrada para validar limite.';
  END IF;

  IF EXTRACT(DOW FROM v_target_date) IN (0, 6) THEN
    v_limit := 3;
  END IF;

  SELECT COUNT(*)
    INTO v_used
  FROM public.experimental_bet_tracking AS t
  WHERE t.run_id = NEW.run_id
    AND t.id IS DISTINCT FROM NEW.id
    AND t.bet_status IN ('PROPOSED', 'OPEN', 'SETTLED');

  IF v_used >= v_limit THEN
    RAISE EXCEPTION 'Limite de % seleção(ões) da rodada atingido.', v_limit;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_experimental_selection_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_experimental_selection_limit() TO service_role;

COMMENT ON FUNCTION public.enforce_experimental_selection_limit() IS
  'Impõe 2 seleções em dias úteis e 3 em fins de semana; SETTLED continua consumindo vaga e DECLINED libera substituição.';
