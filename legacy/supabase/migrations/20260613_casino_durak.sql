create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.casino_durak_games (
  game_id text primary key,
  round_id text not null unique references public.casino_rounds(round_id) on delete cascade,
  code text not null references public.participants(code) on delete cascade,
  status text not null default 'active' check (status in ('active', 'finished', 'abandoned')),
  difficulty text not null check (difficulty in ('regular', 'pro')),
  bet integer not null check (bet > 0 and bet <= 500),
  winner text null check (winner in ('player', 'bot')),
  trump_suit text not null check (trump_suit in ('clubs', 'diamonds', 'hearts', 'spades')),
  attacker text not null check (attacker in ('player', 'bot')),
  defender text not null check (defender in ('player', 'bot')),
  talon jsonb not null default '[]'::jsonb,
  player_hand jsonb not null default '[]'::jsonb,
  bot_hand jsonb not null default '[]'::jsonb,
  table_pairs jsonb not null default '[]'::jsonb,
  discard_pile jsonb not null default '[]'::jsonb,
  turn_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz null
);

create unique index if not exists casino_durak_games_one_active_per_code_idx
  on public.casino_durak_games (code)
  where status = 'active';

create index if not exists casino_durak_games_code_status_idx
  on public.casino_durak_games (code, status, updated_at desc);

create index if not exists casino_durak_games_round_id_idx
  on public.casino_durak_games (round_id);

drop trigger if exists set_casino_durak_games_updated_at on public.casino_durak_games;
create trigger set_casino_durak_games_updated_at
before update on public.casino_durak_games
for each row
execute function public.set_updated_at();

alter table public.casino_durak_games enable row level security;
