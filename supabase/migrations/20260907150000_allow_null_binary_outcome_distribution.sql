-- 1X2 e BTTS são contratos binários: o Motor 2 usa model_probability/p_cons,
-- portanto não existe distribuição asiática aplicável. O backend experimental
-- ainda envia NULL nesse campo; normalize para JSON vazio antes da constraint,
-- sem afrouxar o schema de model_predictions.

CREATE OR REPLACE FUNCTION public.normalize_prediction_outcome_distribution()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.outcome_distribution IS NULL THEN
    NEW.outcome_distribution := '{}'::jsonb;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_prediction_outcome_distribution
  ON public.model_predictions;

CREATE TRIGGER trg_normalize_prediction_outcome_distribution
BEFORE INSERT OR UPDATE OF outcome_distribution
ON public.model_predictions
FOR EACH ROW
EXECUTE FUNCTION public.normalize_prediction_outcome_distribution();

ALTER TABLE public.model_predictions
  ALTER COLUMN outcome_distribution SET NOT NULL;
