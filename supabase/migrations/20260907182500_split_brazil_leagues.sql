-- A 5Dollar usa nomes como "Brazil Serie A"/"Brazil Serie B", mas a antiga
-- normalização removia o token A/B e gerava o mesmo prefixo `brazil-serie:`.
-- Separamos a identidade da liga no lineage usando a competição da partida-alvo
-- da run, evitando misturar Série A e Série B no treino experimental.

CREATE OR REPLACE FUNCTION public.normalize_brazil_league_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  comp text;
  ext text;
  fixed text;
BEGIN
  IF NEW.source <> 'five_dollar_football' OR NEW.raw_value IS NULL OR NEW.match_id IS NULL THEN
    RETURN NEW;
  END IF;

  ext := NEW.raw_value->>'externalMatchId';
  IF ext IS NULL OR ext NOT LIKE 'brazil-serie:%' THEN
    RETURN NEW;
  END IF;

  SELECT lower(coalesce(m.competition, '')) INTO comp
  FROM public.matches m
  WHERE m.id = NEW.match_id;

  IF comp LIKE '%série a%' OR comp LIKE '%serie a%' THEN
    fixed := regexp_replace(ext, '^brazil-serie:', 'brazil-serie-a:');
  ELSIF comp LIKE '%série b%' OR comp LIKE '%serie b%' THEN
    fixed := regexp_replace(ext, '^brazil-serie:', 'brazil-serie-b:');
  ELSE
    RETURN NEW;
  END IF;

  NEW.raw_value := jsonb_set(NEW.raw_value, '{externalMatchId}', to_jsonb(fixed), false);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_brazil_league_lineage ON public.raw_observations;
CREATE TRIGGER trg_normalize_brazil_league_lineage
BEFORE INSERT OR UPDATE OF raw_value, match_id, source
ON public.raw_observations
FOR EACH ROW
EXECUTE FUNCTION public.normalize_brazil_league_lineage();

-- Corrige o histórico já coletado para que o piloto possa ser reexecutado sem
-- recolher novamente todos os jogos.
UPDATE public.raw_observations ro
SET raw_value = jsonb_set(
  ro.raw_value,
  '{externalMatchId}',
  to_jsonb(
    regexp_replace(
      ro.raw_value->>'externalMatchId',
      '^brazil-serie:',
      CASE
        WHEN lower(coalesce(m.competition, '')) LIKE '%série a%'
          OR lower(coalesce(m.competition, '')) LIKE '%serie a%'
          THEN 'brazil-serie-a:'
        WHEN lower(coalesce(m.competition, '')) LIKE '%série b%'
          OR lower(coalesce(m.competition, '')) LIKE '%serie b%'
          THEN 'brazil-serie-b:'
        ELSE 'brazil-serie:'
      END
    )
  ),
  false
)
FROM public.matches m
WHERE ro.match_id = m.id
  AND ro.source = 'five_dollar_football'
  AND ro.raw_value->>'externalMatchId' LIKE 'brazil-serie:%'
  AND (
    lower(coalesce(m.competition, '')) LIKE '%série a%'
    OR lower(coalesce(m.competition, '')) LIKE '%serie a%'
    OR lower(coalesce(m.competition, '')) LIKE '%série b%'
    OR lower(coalesce(m.competition, '')) LIKE '%serie b%'
  );
