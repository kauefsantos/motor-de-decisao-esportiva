-- 1X2 e BTTS são contratos binários e usam model_probability/p_cons no Motor 2.
-- A distribuição asiática só é obrigatória para contratos ASIAN.
-- Permitir NULL evita que o batch experimental inteiro falhe ao misturar
-- corners/goals asiáticos com 1X2/BTTS no mesmo insert.
ALTER TABLE public.model_predictions
  ALTER COLUMN outcome_distribution DROP NOT NULL;
