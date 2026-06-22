drop index if exists public.casino_pvp_blackjack_active_guest_idx;

create index if not exists casino_pvp_blackjack_guest_status_idx
  on public.casino_pvp_blackjack_rooms (guest_code, status, updated_at desc);

create table if not exists public.casino_pvp_dice_rooms (
  room_id text primary key,
  host_code text not null references public.participants(code) on delete cascade,
  host_name text not null default '',
  guest_code text null references public.participants(code) on delete set null,
  guest_name text null,
  bet integer not null check (bet > 0 and bet <= 3000),
  status text not null default 'waiting' check (status in ('waiting', 'active', 'finished', 'cancelled')),
  winner_code text null references public.participants(code) on delete set null,
  host_roll integer null check (host_roll between 1 and 6),
  guest_roll integer null check (guest_roll between 1 and 6),
  resolution jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz null,
  finished_at timestamptz null,
  settled_at timestamptz null,
  cancel_refunded_at timestamptz null
);

create unique index if not exists casino_pvp_dice_waiting_host_idx
  on public.casino_pvp_dice_rooms (host_code)
  where status in ('waiting', 'active');

create index if not exists casino_pvp_dice_guest_status_idx
  on public.casino_pvp_dice_rooms (guest_code, status, updated_at desc);

create index if not exists casino_pvp_dice_status_created_idx
  on public.casino_pvp_dice_rooms (status, created_at desc);

drop trigger if exists set_casino_pvp_dice_rooms_updated_at on public.casino_pvp_dice_rooms;
create trigger set_casino_pvp_dice_rooms_updated_at
before update on public.casino_pvp_dice_rooms
for each row
execute function public.set_updated_at();

alter table public.casino_pvp_dice_rooms enable row level security;

create table if not exists public.casino_pvp_chicken_rooms (
  room_id text primary key,
  host_code text not null references public.participants(code) on delete cascade,
  host_name text not null default '',
  guest_code text null references public.participants(code) on delete set null,
  guest_name text null,
  bet integer not null check (bet > 0 and bet <= 3000),
  status text not null default 'waiting' check (status in ('waiting', 'active', 'finished', 'cancelled')),
  winner_code text null references public.participants(code) on delete set null,
  host_steps integer not null default 0 check (host_steps >= 0),
  guest_steps integer not null default 0 check (guest_steps >= 0),
  host_stood boolean not null default false,
  guest_stood boolean not null default false,
  host_busted boolean not null default false,
  guest_busted boolean not null default false,
  resolution jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz null,
  finished_at timestamptz null,
  settled_at timestamptz null,
  cancel_refunded_at timestamptz null
);

create unique index if not exists casino_pvp_chicken_waiting_host_idx
  on public.casino_pvp_chicken_rooms (host_code)
  where status in ('waiting', 'active');

create index if not exists casino_pvp_chicken_guest_status_idx
  on public.casino_pvp_chicken_rooms (guest_code, status, updated_at desc);

create index if not exists casino_pvp_chicken_status_created_idx
  on public.casino_pvp_chicken_rooms (status, created_at desc);

drop trigger if exists set_casino_pvp_chicken_rooms_updated_at on public.casino_pvp_chicken_rooms;
create trigger set_casino_pvp_chicken_rooms_updated_at
before update on public.casino_pvp_chicken_rooms
for each row
execute function public.set_updated_at();

alter table public.casino_pvp_chicken_rooms enable row level security;

create or replace function public.apply_pvp_dice_finish(
  p_room_id text,
  p_host_code text,
  p_host_name text,
  p_guest_code text,
  p_guest_name text,
  p_payout_host integer,
  p_payout_guest integer
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  update public.casino_pvp_dice_rooms
     set settled_at = now()
   where room_id = p_room_id
     and status = 'finished'
     and settled_at is null
  returning true into v_claimed;

  if coalesce(v_claimed, false) is not true then
    return false;
  end if;

  insert into public.casino(code, name, coins, spent, last_daily, last_cashback)
  values (p_host_code, coalesce(p_host_name, ''), greatest(coalesce(p_payout_host, 0), 0), 0, null, null)
  on conflict (code) do update
    set coins = greatest(coalesce(public.casino.coins, 0), 0) + excluded.coins,
        spent = greatest(coalesce(public.casino.spent, 0), 0);

  if coalesce(p_guest_code, '') <> '' then
    insert into public.casino(code, name, coins, spent, last_daily, last_cashback)
    values (p_guest_code, coalesce(p_guest_name, ''), greatest(coalesce(p_payout_guest, 0), 0), 0, null, null)
    on conflict (code) do update
      set coins = greatest(coalesce(public.casino.coins, 0), 0) + excluded.coins,
          spent = greatest(coalesce(public.casino.spent, 0), 0);
  end if;

  return true;
end;
$$;

create or replace function public.apply_pvp_dice_cancel_refund(
  p_room_id text,
  p_host_code text,
  p_host_name text,
  p_bet integer
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  update public.casino_pvp_dice_rooms
     set cancel_refunded_at = now()
   where room_id = p_room_id
     and status = 'cancelled'
     and cancel_refunded_at is null
  returning true into v_claimed;

  if coalesce(v_claimed, false) is not true then
    return false;
  end if;

  insert into public.casino(code, name, coins, spent, last_daily, last_cashback)
  values (p_host_code, coalesce(p_host_name, ''), greatest(coalesce(p_bet, 0), 0), 0, null, null)
  on conflict (code) do update
    set coins = greatest(coalesce(public.casino.coins, 0), 0) + excluded.coins,
        spent = greatest(coalesce(public.casino.spent, 0) - greatest(coalesce(p_bet, 0), 0), 0);

  return true;
end;
$$;

create or replace function public.claim_pvp_dice_room(
  p_room_id text,
  p_guest_code text,
  p_guest_name text,
  p_bet integer,
  p_accepted_at timestamptz
)
returns public.casino_pvp_dice_rooms
language plpgsql
set search_path = public
as $$
declare
  v_room public.casino_pvp_dice_rooms%rowtype;
  v_casino public.casino%rowtype;
  v_coins integer;
  v_spent integer;
begin
  select *
    into v_room
    from public.casino_pvp_dice_rooms
   where room_id = p_room_id
   for update;

  if not found then
    raise exception 'room not found';
  end if;

  if v_room.host_code = p_guest_code then
    raise exception 'host cannot accept own room';
  end if;

  if v_room.status <> 'waiting' or v_room.guest_code is not null then
    raise exception 'room already taken';
  end if;

  select *
    into v_casino
    from public.casino
   where code = p_guest_code
   for update;

  v_coins := greatest(coalesce(v_casino.coins, 1000), 0);
  v_spent := greatest(coalesce(v_casino.spent, 0), 0);

  if v_coins < greatest(coalesce(p_bet, 0), 0) then
    raise exception 'not enough coins';
  end if;

  insert into public.casino(code, name, coins, spent, last_daily, last_cashback)
  values (
    p_guest_code,
    coalesce(p_guest_name, ''),
    v_coins - greatest(coalesce(p_bet, 0), 0),
    v_spent + greatest(coalesce(p_bet, 0), 0),
    v_casino.last_daily,
    v_casino.last_cashback
  )
  on conflict (code) do update
    set name = excluded.name,
        coins = excluded.coins,
        spent = excluded.spent,
        last_daily = coalesce(public.casino.last_daily, excluded.last_daily),
        last_cashback = coalesce(public.casino.last_cashback, excluded.last_cashback);

  update public.casino_pvp_dice_rooms
     set guest_code = p_guest_code,
         guest_name = coalesce(p_guest_name, ''),
         status = 'active',
         winner_code = null,
         accepted_at = p_accepted_at
   where room_id = p_room_id
   returning * into v_room;

  return v_room;
end;
$$;

create or replace function public.apply_pvp_chicken_finish(
  p_room_id text,
  p_host_code text,
  p_host_name text,
  p_guest_code text,
  p_guest_name text,
  p_payout_host integer,
  p_payout_guest integer
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  update public.casino_pvp_chicken_rooms
     set settled_at = now()
   where room_id = p_room_id
     and status = 'finished'
     and settled_at is null
  returning true into v_claimed;

  if coalesce(v_claimed, false) is not true then
    return false;
  end if;

  insert into public.casino(code, name, coins, spent, last_daily, last_cashback)
  values (p_host_code, coalesce(p_host_name, ''), greatest(coalesce(p_payout_host, 0), 0), 0, null, null)
  on conflict (code) do update
    set coins = greatest(coalesce(public.casino.coins, 0), 0) + excluded.coins,
        spent = greatest(coalesce(public.casino.spent, 0), 0);

  if coalesce(p_guest_code, '') <> '' then
    insert into public.casino(code, name, coins, spent, last_daily, last_cashback)
    values (p_guest_code, coalesce(p_guest_name, ''), greatest(coalesce(p_payout_guest, 0), 0), 0, null, null)
    on conflict (code) do update
      set coins = greatest(coalesce(public.casino.coins, 0), 0) + excluded.coins,
          spent = greatest(coalesce(public.casino.spent, 0), 0);
  end if;

  return true;
end;
$$;

create or replace function public.apply_pvp_chicken_cancel_refund(
  p_room_id text,
  p_host_code text,
  p_host_name text,
  p_bet integer
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  update public.casino_pvp_chicken_rooms
     set cancel_refunded_at = now()
   where room_id = p_room_id
     and status = 'cancelled'
     and cancel_refunded_at is null
  returning true into v_claimed;

  if coalesce(v_claimed, false) is not true then
    return false;
  end if;

  insert into public.casino(code, name, coins, spent, last_daily, last_cashback)
  values (p_host_code, coalesce(p_host_name, ''), greatest(coalesce(p_bet, 0), 0), 0, null, null)
  on conflict (code) do update
    set coins = greatest(coalesce(public.casino.coins, 0), 0) + excluded.coins,
        spent = greatest(coalesce(public.casino.spent, 0) - greatest(coalesce(p_bet, 0), 0), 0);

  return true;
end;
$$;

create or replace function public.claim_pvp_chicken_room(
  p_room_id text,
  p_guest_code text,
  p_guest_name text,
  p_bet integer,
  p_accepted_at timestamptz
)
returns public.casino_pvp_chicken_rooms
language plpgsql
set search_path = public
as $$
declare
  v_room public.casino_pvp_chicken_rooms%rowtype;
  v_casino public.casino%rowtype;
  v_coins integer;
  v_spent integer;
begin
  select *
    into v_room
    from public.casino_pvp_chicken_rooms
   where room_id = p_room_id
   for update;

  if not found then
    raise exception 'room not found';
  end if;

  if v_room.host_code = p_guest_code then
    raise exception 'host cannot accept own room';
  end if;

  if v_room.status <> 'waiting' or v_room.guest_code is not null then
    raise exception 'room already taken';
  end if;

  select *
    into v_casino
    from public.casino
   where code = p_guest_code
   for update;

  v_coins := greatest(coalesce(v_casino.coins, 1000), 0);
  v_spent := greatest(coalesce(v_casino.spent, 0), 0);

  if v_coins < greatest(coalesce(p_bet, 0), 0) then
    raise exception 'not enough coins';
  end if;

  insert into public.casino(code, name, coins, spent, last_daily, last_cashback)
  values (
    p_guest_code,
    coalesce(p_guest_name, ''),
    v_coins - greatest(coalesce(p_bet, 0), 0),
    v_spent + greatest(coalesce(p_bet, 0), 0),
    v_casino.last_daily,
    v_casino.last_cashback
  )
  on conflict (code) do update
    set name = excluded.name,
        coins = excluded.coins,
        spent = excluded.spent,
        last_daily = coalesce(public.casino.last_daily, excluded.last_daily),
        last_cashback = coalesce(public.casino.last_cashback, excluded.last_cashback);

  update public.casino_pvp_chicken_rooms
     set guest_code = p_guest_code,
         guest_name = coalesce(p_guest_name, ''),
         status = 'active',
         winner_code = null,
         accepted_at = p_accepted_at
   where room_id = p_room_id
   returning * into v_room;

  return v_room;
end;
$$;
