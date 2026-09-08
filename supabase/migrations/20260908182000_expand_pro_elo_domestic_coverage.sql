-- 5Dollar Pro: ampliar a cobertura doméstica usada pelo Elo e manter o cron
-- no limite conservador já configurado (pg_sleep 6.2s entre chamadas).

create or replace function public.elo_is_target_league(p_country text, p_name text)
returns boolean
language plpgsql
immutable
as $$
declare n text := lower(coalesce(p_name,''));
begin
  if n ~ '(women|femin|youth|junior|u[0-9]|reserve)' then return false; end if;
  if p_country='GB-ENG' then return n like '%premier league%' or n like '%championship%'; end if;
  if p_country='DE' then return n like '%bundesliga i%' or n like '%bundesliga ii%' or n='bundesliga' or n='2. bundesliga'; end if;
  if p_country='ES' then return n like '%la liga%' or n like '%segunda%'; end if;
  if p_country='IT' then return n like '%serie a%' or n like '%serie b%'; end if;
  if p_country='FR' then return n like '%ligue 1%' or n like '%ligue 2%'; end if;
  if p_country='BR' then return n like '%serie a%' or n like '%serie b%'; end if;
  if p_country='PT' then return n like '%primeira liga%' or n like '%segunda liga%' or n like '%liga portugal%'; end if;
  if p_country='NL' then return n like '%eredivisie%' or n like '%eerste divisie%'; end if;
  if p_country='BE' then return n like '%pro league%'; end if;
  if p_country='TR' then return n like '%super lig%' or n like '%süper lig%' or n like '%1 lig%'; end if;
  if p_country='AR' then return n like '%liga profesional%' or n like '%nacional b%' or n like '%primera division%'; end if;
  if p_country='EC' then return n like '%ligapro serie a%' or n like '%ligapro serie b%'; end if;
  if p_country='NO' then return n like '%eliteserien%' or n like '%division 1%'; end if;
  if p_country='SK' then return n like '%super liga%'; end if;
  if p_country='US' then return n like '%major league soccer%' or n='mls'; end if;
  if p_country='SA' then return n like '%pro league%'; end if;
  return false;
end $$;

create or replace function public.elo_league_key(p_country text, p_name text)
returns text
language sql
immutable
as $$
  select case
    when p_country='GB-ENG' and lower(p_name) like '%championship%' then 'england-championship'
    when p_country='GB-ENG' then 'england-premier-league'
    when p_country='DE' and lower(p_name) like '%bundesliga ii%' then 'germany-2-bundesliga'
    when p_country='DE' and lower(p_name) like '%2. bundesliga%' then 'germany-2-bundesliga'
    when p_country='DE' then 'germany-bundesliga'
    when p_country='ES' and lower(p_name) like '%segunda%' then 'spain-la-liga-2'
    when p_country='ES' and lower(p_name) like '%la liga 2%' then 'spain-la-liga-2'
    when p_country='ES' then 'spain-la-liga'
    when p_country='IT' and lower(p_name) like '%serie b%' then 'italy-serie-b'
    when p_country='IT' then 'italy-serie-a'
    when p_country='FR' and lower(p_name) like '%ligue 2%' then 'france-ligue-2'
    when p_country='FR' then 'france-ligue-1'
    when p_country='BR' and lower(p_name) like '%serie b%' then 'brazil-serie-b'
    when p_country='BR' then 'brazil-serie-a'
    when p_country='PT' and lower(p_name) like '%segunda%' then 'portugal-segunda-liga'
    when p_country='PT' then 'portugal-primeira-liga'
    when p_country='NL' and lower(p_name) like '%eerste%' then 'netherlands-eerste-divisie'
    when p_country='NL' then 'netherlands-eredivisie'
    when p_country='BE' then 'belgium-pro-league'
    when p_country='TR' and lower(p_name) like '%1 lig%' then 'turkey-1-lig'
    when p_country='TR' then 'turkey-super-lig'
    when p_country='AR' and lower(p_name) like '%nacional b%' then 'argentina-nacional-b'
    when p_country='AR' then 'argentina-liga-profesional'
    when p_country='EC' and lower(p_name) like '%serie b%' then 'ecuador-ligapro-serie-b'
    when p_country='EC' then 'ecuador-ligapro-serie-a'
    when p_country='NO' and lower(p_name) like '%division 1%' then 'norway-division-1'
    when p_country='NO' then 'norway-eliteserien'
    when p_country='SK' then 'slovakia-super-liga'
    when p_country='US' then 'usa-mls'
    when p_country='SA' then 'saudi-pro-league'
    else lower(regexp_replace(trim(p_name),'[^a-zA-Z0-9]+','-','g'))
  end
$$;

-- A função principal já existe e contém as proteções de Vault, retry/status e
-- espaçamento de 6.2s. Alteramos apenas a lista de países para não duplicar a
-- função inteira e manter o mesmo job cron.
do $$
declare d text;
begin
  select pg_get_functiondef('public.elo_sync_from_5dollar()'::regprocedure) into d;
  d := replace(
    d,
    'foreach v_country in array array[''GB-ENG'',''DE'',''ES'',''IT'',''FR'',''BR'',''PT'',''NL'',''BE'',''TR'',''AR'',''US'',''SA''] loop',
    'foreach v_country in array array[''GB-ENG'',''DE'',''ES'',''IT'',''FR'',''BR'',''PT'',''NL'',''BE'',''TR'',''AR'',''EC'',''NO'',''SK'',''US'',''SA''] loop'
  );
  execute d;
end $$;
