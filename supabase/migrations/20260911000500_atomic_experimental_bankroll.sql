-- Serialize experimental bankroll confirmations across different bets.
-- The config row is the single lock point, so two concurrent confirmations
-- cannot both spend the same available balance snapshot.

CREATE OR REPLACE FUNCTION public.confirm_experimental_bet_atomic(
  p_id uuid,
  p_stake_brl numeric
)
RETURNS TABLE (
  status text,
  stake_brl numeric,
  available_after numeric,
  max_allowed numeric,
  minimum_stake numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_initial numeric;
  v_max_pct numeric;
  v_min_stake numeric;
  v_current_status text;
  v_settled_profit numeric := 0;
  v_locked numeric := 0;
  v_equity numeric := 0;
  v_available numeric := 0;
  v_stake numeric := 0;
  v_max_allowed numeric := 0;
  v_now timestamptz := now();
BEGIN
  SELECT c.initial_bankroll, c.max_stake_pct, c.min_stake_brl
    INTO v_initial, v_max_pct, v_min_stake
  FROM public.experimental_bankroll_config AS c
  WHERE c.id = 'main'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configuração da banca experimental ausente.';
  END IF;

  SELECT t.bet_status
    INTO v_current_status
  FROM public.experimental_bet_tracking AS t
  WHERE t.id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não foi possível localizar esta sugestão.';
  END IF;

  IF v_current_status <> 'PROPOSED' THEN
    RAISE EXCEPTION 'Esta sugestão já foi confirmada ou recusada.';
  END IF;

  SELECT COALESCE(SUM(COALESCE(t.profit_brl, 0)), 0)
    INTO v_settled_profit
  FROM public.experimental_bet_tracking AS t
  WHERE t.bet_status = 'SETTLED' OR t.result <> 'PENDING';

  SELECT COALESCE(SUM(COALESCE(t.stake_brl, 0)), 0)
    INTO v_locked
  FROM public.experimental_bet_tracking AS t
  WHERE t.bet_status = 'OPEN' AND t.result = 'PENDING';

  v_equity := COALESCE(v_initial, 0) + v_settled_profit;
  v_available := GREATEST(0, v_equity - v_locked);
  v_stake := GREATEST(0, FLOOR(COALESCE(p_stake_brl, 0) * 100 + 0.000000001) / 100);

  IF v_available >= v_min_stake AND v_min_stake > 0 THEN
    v_max_allowed := LEAST(
      v_available,
      GREATEST(v_min_stake, FLOOR(v_available * v_max_pct * 100 + 0.000000001) / 100)
    );
  ELSE
    v_max_allowed := 0;
  END IF;

  IF v_stake <= 0 THEN
    UPDATE public.experimental_bet_tracking AS t
    SET bet_status = 'DECLINED',
        stake_brl = 0,
        declined_at = v_now,
        updated_at = v_now
    WHERE t.id = p_id AND t.bet_status = 'PROPOSED';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Esta sugestão mudou de estado antes da recusa.';
    END IF;

    RETURN QUERY SELECT 'DECLINED'::text, 0::numeric, v_available, v_max_allowed, v_min_stake;
    RETURN;
  END IF;

  IF v_stake < v_min_stake THEN
    RAISE EXCEPTION 'A aposta mínima operacional é R$ %.', to_char(v_min_stake, 'FM999999990D00');
  END IF;

  IF v_stake > v_available THEN
    RAISE EXCEPTION 'O valor informado supera o saldo disponível de R$ %.', to_char(v_available, 'FM999999990D00');
  END IF;

  IF v_stake > v_max_allowed THEN
    RAISE EXCEPTION 'O limite operacional desta aposta é R$ %.', to_char(v_max_allowed, 'FM999999990D00');
  END IF;

  UPDATE public.experimental_bet_tracking AS t
  SET bet_status = 'OPEN',
      stake_brl = v_stake,
      accepted_at = v_now,
      declined_at = NULL,
      updated_at = v_now
  WHERE t.id = p_id AND t.bet_status = 'PROPOSED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esta sugestão mudou de estado antes da confirmação.';
  END IF;

  RETURN QUERY SELECT
    'OPEN'::text,
    v_stake,
    GREATEST(0, v_available - v_stake),
    v_max_allowed,
    v_min_stake;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_experimental_bet_atomic(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_experimental_bet_atomic(uuid, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.settle_experimental_bet_atomic(
  p_id uuid,
  p_outcome text
)
RETURNS TABLE (
  profit_brl numeric,
  profit_units numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_odd numeric;
  v_stake numeric;
  v_status text;
  v_result text;
  v_profit_units numeric;
  v_profit_brl numeric;
  v_now timestamptz := now();
BEGIN
  IF p_outcome NOT IN ('WIN', 'LOSS') THEN
    RAISE EXCEPTION 'Resultado inválido para fechamento.';
  END IF;

  SELECT t.entry_odd, t.stake_brl, t.bet_status, t.result
    INTO v_odd, v_stake, v_status, v_result
  FROM public.experimental_bet_tracking AS t
  WHERE t.id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aposta aberta não encontrada.';
  END IF;

  IF v_status <> 'OPEN' OR v_result <> 'PENDING' THEN
    RAISE EXCEPTION 'Esta aposta não está mais aberta.';
  END IF;

  IF COALESCE(v_stake, 0) <= 0 THEN
    RAISE EXCEPTION 'A aposta aberta está sem valor confirmado.';
  END IF;

  v_profit_units := CASE WHEN p_outcome = 'WIN' THEN v_odd - 1 ELSE -1 END;
  v_profit_brl := v_stake * v_profit_units;

  UPDATE public.experimental_bet_tracking AS t
  SET bet_status = 'SETTLED',
      result = p_outcome,
      profit_units = v_profit_units,
      profit_brl = v_profit_brl,
      settled_at = v_now,
      updated_at = v_now
  WHERE t.id = p_id AND t.bet_status = 'OPEN' AND t.result = 'PENDING';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esta aposta mudou de estado antes do fechamento.';
  END IF;

  RETURN QUERY SELECT v_profit_brl, v_profit_units;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_experimental_bet_atomic(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_experimental_bet_atomic(uuid, text) TO service_role;

-- Enforce the 2 weekday / 3 weekend selection rule at the database boundary.
-- Locking the parent run serializes attempts to consume the last slot.
CREATE OR REPLACE FUNCTION public.enforce_experimental_selection_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target_date date;
  v_limit integer := 2;
  v_active integer := 0;
BEGIN
  IF NEW.bet_status NOT IN ('PROPOSED', 'OPEN') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.bet_status IN ('PROPOSED', 'OPEN') THEN
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
    INTO v_active
  FROM public.experimental_bet_tracking AS t
  WHERE t.run_id = NEW.run_id
    AND t.id IS DISTINCT FROM NEW.id
    AND t.bet_status IN ('PROPOSED', 'OPEN');

  IF v_active >= v_limit THEN
    RAISE EXCEPTION 'Limite de % seleção(ões) ativas atingido para esta rodada.', v_limit;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_experimental_selection_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_experimental_selection_limit() TO service_role;

DROP TRIGGER IF EXISTS trg_experimental_selection_limit ON public.experimental_bet_tracking;
CREATE TRIGGER trg_experimental_selection_limit
BEFORE INSERT OR UPDATE OF bet_status ON public.experimental_bet_tracking
FOR EACH ROW
EXECUTE FUNCTION public.enforce_experimental_selection_limit();

COMMENT ON FUNCTION public.confirm_experimental_bet_atomic(uuid, numeric) IS
  'Serializa confirmação/recusa da banca experimental através de lock na configuração main.';
COMMENT ON FUNCTION public.settle_experimental_bet_atomic(uuid, text) IS
  'Fecha uma aposta experimental sob row lock, calculando lucro a partir da odd e stake persistidas.';
COMMENT ON FUNCTION public.enforce_experimental_selection_limit() IS
  'Impõe no banco 2 seleções ativas em dias úteis e 3 em fins de semana, serializando por run.';
