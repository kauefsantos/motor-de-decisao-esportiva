insert into public.source_definitions (source, definition_version, metric_definitions, configured, notes)
select 'research_adapter','research-v1',
  '{"mode":"Desk Research / Dados Públicos","accepted":["goals_scored","goals_conceded","corners_taken"],"rejected":{"shots_total":"DATA_DEFINITION_MISMATCH","shots_on_target":"DATA_DEFINITION_MISMATCH","cards_yellow_raw":"DATA_DEFINITION_MISMATCH","cards_red_raw":"DATA_DEFINITION_MISMATCH","fouls_committed":"SEM_CONTRATO"},"sources":["mirror publico do formato football-data (datasets/football-datasets)"]}'::jsonb,
  true,
  'Desk research em dados publicos e abertos. Nao e API oficial. Estado real e por execucao: OK / PARTIAL / UNAVAILABLE.'
where not exists (
  select 1 from public.source_definitions where source = 'research_adapter' and definition_version = 'research-v1'
);