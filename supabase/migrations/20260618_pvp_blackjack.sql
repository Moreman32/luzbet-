create table if not exists public.casino_pvp_blackjack_rooms (
  room_id text primary key,
  host_code text not null references public.participants(code) on delete cascade,
  host_name text not null default '',
  guest_code text null references public.participants(code) on delete set null,
  guest_name text null,
  bet integer not null check (bet > 0 and bet <= 3000),
  status text not null default 'waiting' check (status in ('waiting', 'active', 'finished', 'cancelled')),
  turn_code text null references public.participants(code) on delete set null,
  winner_code text null references public.participants(code) on delete set null,
  deck jsonb not null default '[]'::jsonb,
  host_hand jsonb not null default '[]'::jsonb,
  guest_hand jsonb not null default '[]'::jsonb,
  host_stood boolean not null default false,
  guest_stood boolean not null default false,
  host_busted boolean not null default false,
  guest_busted boolean not null default false,
  resolution jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz null,
  finished_at timestamptz null
);

create unique index if not exists casino_pvp_blackjack_waiting_host_idx
  on public.casino_pvp_blackjack_rooms (host_code)
  where status in ('waiting', 'active');

create unique index if not exists casino_pvp_blackjack_active_guest_idx
  on public.casino_pvp_blackjack_rooms (guest_code)
  where guest_code is not null and status = 'active';

create index if not exists casino_pvp_blackjack_status_created_idx
  on public.casino_pvp_blackjack_rooms (status, created_at desc);

create index if not exists casino_pvp_blackjack_host_guest_idx
  on public.casino_pvp_blackjack_rooms (host_code, guest_code, updated_at desc);

drop trigger if exists set_casino_pvp_blackjack_rooms_updated_at on public.casino_pvp_blackjack_rooms;
create trigger set_casino_pvp_blackjack_rooms_updated_at
before update on public.casino_pvp_blackjack_rooms
for each row
execute function public.set_updated_at();

alter table public.casino_pvp_blackjack_rooms enable row level security;
