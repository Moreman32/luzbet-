create or replace function public.claim_pvp_blackjack_room(
  p_room_id text,
  p_guest_code text,
  p_guest_name text,
  p_bet integer,
  p_turn_code text,
  p_deck jsonb,
  p_host_hand jsonb,
  p_guest_hand jsonb,
  p_host_stood boolean,
  p_guest_stood boolean,
  p_host_busted boolean,
  p_guest_busted boolean,
  p_resolution jsonb,
  p_accepted_at timestamptz
)
returns public.casino_pvp_blackjack_rooms
language plpgsql
set search_path = public
as $$
declare
  v_room public.casino_pvp_blackjack_rooms%rowtype;
  v_casino public.casino%rowtype;
  v_coins integer;
  v_spent integer;
begin
  select *
    into v_room
    from public.casino_pvp_blackjack_rooms
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

  update public.casino_pvp_blackjack_rooms
     set guest_code = p_guest_code,
         guest_name = coalesce(p_guest_name, ''),
         status = 'active',
         turn_code = null,
         winner_code = null,
         deck = coalesce(p_deck, '[]'::jsonb),
         host_hand = coalesce(p_host_hand, '[]'::jsonb),
         guest_hand = coalesce(p_guest_hand, '[]'::jsonb),
         host_stood = coalesce(p_host_stood, false),
         guest_stood = coalesce(p_guest_stood, false),
         host_busted = coalesce(p_host_busted, false),
         guest_busted = coalesce(p_guest_busted, false),
         resolution = coalesce(p_resolution, '{}'::jsonb),
         accepted_at = p_accepted_at
   where room_id = p_room_id
   returning * into v_room;

  return v_room;
end;
$$;
