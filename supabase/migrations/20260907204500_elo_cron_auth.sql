-- Segredo interno usado somente pelo pg_cron para chamar a rota server-side do Elo.
-- O valor nasce no banco e nunca é versionado no GitHub.
create table if not exists public.elo_cron_config (
  id text primary key default 'main',
  bearer_token text not null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now()
);

insert into public.elo_cron_config (id, bearer_token)
values ('main', encode(gen_random_bytes(32), 'hex'))
on conflict (id) do nothing;

alter table public.elo_cron_config enable row level security;
revoke all on public.elo_cron_config from anon, authenticated;
