INSERT INTO public.source_definitions (source, definition_version, metric_definitions, configured, notes)
VALUES (
  'api_football',
  'api_football-v1',
  '{"corners_taken":{"sourceLabels":["Corner Kicks"],"contractCompatible":true},"shots_total":{"sourceLabels":["Total Shots"],"contractCompatible":false},"shots_on_target":{"sourceLabels":["Shots on Goal"],"contractCompatible":false},"cards_yellow_raw":{"sourceLabels":["Yellow Cards"],"contractCompatible":false},"cards_red_raw":{"sourceLabels":["Red Cards"],"contractCompatible":false},"goals":{"sourceLabels":["goals.full_time"],"contractCompatible":true}}'::jsonb,
  false,
  'API-Football (API-Sports v3). Credencial server-side API_FOOTBALL_KEY. configured=false ate validacao operacional com chamada real e persistencia.'
);
UPDATE public.source_definitions SET configured = false WHERE source = 'sofascore';