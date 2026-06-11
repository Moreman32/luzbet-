create table if not exists public.match_rewards (
  id bigserial primary key,
  code text not null,
  match_key text not null,
  group_code text not null,
  match_index integer not null,
  pred_home integer not null,
  pred_away integer not null,
  actual_home integer not null,
  actual_away integer not null,
  result_type text not null check (result_type in ('exact', 'outcome', 'miss')),
  coins_delta integer not null,
  message text not null,
  settled_at timestamptz not null default now(),
  shown_at timestamptz null,
  created_at timestamptz not null default now()
);

create unique index if not exists match_rewards_code_match_key_key
  on public.match_rewards (code, match_key);

create index if not exists match_rewards_code_shown_at_idx
  on public.match_rewards (code, shown_at, settled_at);

alter table public.match_rewards enable row level security;

drop policy if exists "service role manages match rewards" on public.match_rewards;
create policy "service role manages match rewards"
on public.match_rewards
for all
to service_role
using (true)
with check (true);
