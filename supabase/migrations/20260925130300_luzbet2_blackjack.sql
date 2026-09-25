-- =====================================================================
-- LuzBet 2.0 — Blackjack standard v1
-- 6 decks, fresh provably-fair shoe per round, dealer stands on all 17 (S17), dealer peeks,
-- blackjack pays 3:2 (rounded down), double on any first two cards, one split (any two 10-value
-- cards may be split), double after split allowed, split aces get one card each (21 after split
-- is not a blackjack), no insurance, no surrender.
-- Card id c in 0..311: rank = c % 13 + 1 (1 = Ace, 11..13 = J Q K), suit = (c / 13) % 4.
-- =====================================================================

create or replace function private.bj_val(c smallint) returns int
language sql immutable set search_path = '' as $$ select least(c % 13 + 1, 10) $$;

create or replace function private.bj_hard(cards smallint[]) returns int
language sql immutable set search_path = '' as $$
  select coalesce(sum(least(c % 13 + 1, 10)), 0)::int from unnest(cards) c
$$;

create or replace function private.bj_soft(cards smallint[]) returns boolean
language sql immutable set search_path = '' as $$
  select exists (select 1 from unnest(cards) c where c % 13 = 0) and private.bj_hard(cards) + 10 <= 21
$$;

create or replace function private.bj_total(cards smallint[]) returns int
language sql immutable set search_path = '' as $$
  select private.bj_hard(cards) + case when private.bj_soft(cards) then 10 else 0 end
$$;

create or replace function private.bj_is_bj(cards smallint[]) returns boolean
language sql immutable set search_path = '' as $$
  select cardinality(cards) = 2 and private.bj_total(cards) = 21
$$;

create or replace function private.bj_cards(h jsonb) returns smallint[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(x.v::smallint order by x.i), '{}'::smallint[])
    from jsonb_array_elements_text(h -> 'cards') with ordinality as x(v, i)
$$;

create or replace function private.bj_shuffle(p_server_seed text, p_client_seed text, p_nonce bigint)
returns smallint[] language plpgsql immutable set search_path = '' as $$
declare d smallint[]; r int[]; i int; j int; t smallint; k int := 1;
begin
  select array_agg(g::smallint order by g) into d from generate_series(0, 311) g;
  r := private.fair_ints(p_server_seed, p_client_seed, p_nonce, (select array_agg(m order by m desc) from generate_series(2, 312) m));
  -- Fisher–Yates on 0-based positions i = 311..1, j uniform in [0, i]
  for i in reverse 311..1 loop
    j := r[k]; k := k + 1;
    t := d[i+1]; d[i+1] := d[j+1]; d[j+1] := t;
  end loop;
  return d;
end $$;

create or replace function private.bj_public(g private.blackjack_games) returns jsonb
language plpgsql stable set search_path = '' as $$
declare hands jsonb := '[]'::jsonb; h jsonb; i int := 0; cards smallint[]; allowed text[] := '{}'; fin boolean := g.phase = 'FINISHED';
begin
  for h in select value from jsonb_array_elements(g.hands) loop
    cards := private.bj_cards(h);
    hands := hands || (h || jsonb_build_object('total', private.bj_total(cards), 'soft', private.bj_soft(cards)));
    if not fin and i = g.active_hand and h ->> 'status' = 'playing' then
      allowed := array['hit','stand'];
      if cardinality(cards) = 2 and not (h ->> 'splitAces')::boolean then allowed := allowed || 'double'::text; end if;
      if jsonb_array_length(g.hands) = 1 and cardinality(cards) = 2
         and private.bj_val(cards[1]) = private.bj_val(cards[2]) then allowed := allowed || 'split'::text; end if;
    end if;
    i := i + 1;
  end loop;
  return jsonb_build_object(
    'phase', g.phase,
    'dealer', case when fin then to_jsonb(g.dealer) else to_jsonb(array[g.dealer[1]]) end,
    'dealerTotal', case when fin then private.bj_total(g.dealer) else private.bj_total(array[g.dealer[1]]) end,
    'holeHidden', not fin,
    'hands', hands, 'active', g.active_hand, 'allowed', to_jsonb(allowed));
end $$;

-- Dealer play + settlement. Returns total payout. Mutates g.
create or replace function private.bj_settle(inout g private.blackjack_games, out payout bigint)
language plpgsql set search_path = '' as $$
declare h jsonb; out_hands jsonb := '[]'::jsonb; cards smallint[]; pt int; dt int; res text; p bigint; bet bigint; any_live boolean;
begin
  payout := 0;
  select bool_or(value ->> 'status' <> 'bust') into any_live from jsonb_array_elements(g.hands);
  if any_live then
    while private.bj_total(g.dealer) < 17 loop
      g.dealer := g.dealer || g.deck[g.pos]; g.pos := g.pos + 1;
    end loop;
  end if;
  dt := private.bj_total(g.dealer);
  for h in select value from jsonb_array_elements(g.hands) loop
    cards := private.bj_cards(h); pt := private.bj_total(cards); bet := (h ->> 'bet')::bigint;
    if h ->> 'status' = 'bust' then res := 'bust'; p := 0;
    elsif dt > 21 or pt > dt then res := 'win'; p := bet * 2;
    elsif pt = dt then res := 'push'; p := bet;
    else res := 'lose'; p := 0;
    end if;
    payout := payout + p;
    out_hands := out_hands || (h || jsonb_build_object('result', res, 'payout', p));
  end loop;
  g.hands := out_hands; g.phase := 'FINISHED';
end $$;

create or replace function private.bj_finish(p_round uuid, p_user uuid, g private.blackjack_games, p_payout bigint)
returns public.casino_rounds language plpgsql security definer set search_path = '' as $$
declare r public.casino_rounds;
begin
  if p_payout > 0 then
    perform private.post_tx(p_user, p_payout, 'payout', 'payout:' || p_round, p_round, jsonb_build_object('game', 'blackjack'));
  end if;
  update private.blackjack_games set deck = g.deck, pos = g.pos, dealer = g.dealer, hands = g.hands,
         active_hand = g.active_hand, phase = 'FINISHED' where round_id = p_round;
  update public.casino_rounds set status = 'finished', payout = p_payout, finished_at = now(),
         state = private.bj_public(g) where id = p_round returning * into r;
  return r;
end $$;

create or replace function public.rpc_blackjack_start(p_bet bigint, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles; rv public.game_rule_versions; s public.fair_seeds; r public.casino_rounds; g private.blackjack_games;
  bal bigint; deck smallint[]; req jsonb; req_hash text; player smallint[]; pay bigint; hand jsonb;
begin
  me := private.caller();
  if not private.valid_key(p_idempotency_key) then return private.err('invalid_idempotency_key'); end if;
  req := jsonb_build_object('bet', p_bet);
  req_hash := encode(extensions.digest(req::text, 'sha256'), 'hex');

  select * into r from public.casino_rounds where user_id = me.id and idempotency_key = p_idempotency_key;
  if found then
    if r.request_hash <> req_hash or r.game_slug <> 'blackjack' then
      perform private.log_event(me.id, 'idempotency_conflict', 'warn', jsonb_build_object('key', p_idempotency_key));
      return private.err('idempotency_conflict');
    end if;
    return jsonb_build_object('ok', true, 'replayed', true, 'round', private.round_public(r));
  end if;

  select * into rv from public.game_rule_versions where game_slug = 'blackjack' and is_current;
  if not found or not exists (select 1 from public.game_definitions where slug = 'blackjack' and status = 'enabled') then
    return private.err('game_unavailable');
  end if;
  if p_bet is null or p_bet < (rv.rules ->> 'minBet')::bigint or p_bet > (rv.rules ->> 'maxBet')::bigint then
    return private.err('bet_limits', jsonb_build_object('min', rv.rules -> 'minBet', 'max', rv.rules -> 'maxBet'));
  end if;

  s := private.lock_seed(me.id);
  select * into r from public.casino_rounds where user_id = me.id and idempotency_key = p_idempotency_key;
  if found then
    if r.request_hash <> req_hash then return private.err('idempotency_conflict'); end if;
    return jsonb_build_object('ok', true, 'replayed', true, 'round', private.round_public(r));
  end if;
  select * into r from public.casino_rounds where user_id = me.id and game_slug = 'blackjack' and status = 'active';
  if found then return private.err('round_in_progress', jsonb_build_object('round', private.round_public(r))); end if;
  select balance into bal from public.wallets where user_id = me.id for update;
  if bal < p_bet then return private.err('insufficient_funds', jsonb_build_object('balance', bal)); end if;

  deck := private.bj_shuffle(private.secret_of(s.id), s.client_seed, s.next_nonce);

  insert into public.casino_rounds(user_id, game_slug, rule_version_id, status, bet_total, seed_id, nonce,
                                   client_seed, server_seed_hash, idempotency_key, request_hash, request)
  values (me.id, 'blackjack', rv.id, 'active', p_bet, s.id, s.next_nonce, s.client_seed, s.server_seed_hash,
          p_idempotency_key, req_hash, req)
  returning * into r;
  update public.fair_seeds set next_nonce = next_nonce + 1 where id = s.id;
  perform private.post_tx(me.id, -p_bet, 'bet', 'bet:' || r.id, r.id, jsonb_build_object('game', 'blackjack'));

  player := array[deck[1], deck[3]];
  hand := jsonb_build_object('cards', to_jsonb(player), 'bet', p_bet, 'status', 'playing',
                             'doubled', false, 'split', false, 'splitAces', false);
  g := row(r.id, deck, 5, array[deck[2], deck[4]], jsonb_build_array(hand), 0, 'PLAYER_TURN')::private.blackjack_games;
  insert into private.blackjack_games values (g.*);
  insert into public.casino_actions(round_id, user_id, seq, action, idempotency_key, payload)
  values (r.id, me.id, 0, 'start', p_idempotency_key, req);

  -- dealer peek / naturals
  if private.bj_is_bj(g.dealer) or private.bj_is_bj(player) then
    if private.bj_is_bj(g.dealer) and private.bj_is_bj(player) then
      pay := p_bet; hand := hand || jsonb_build_object('status', 'stood', 'result', 'push', 'payout', pay);
    elsif private.bj_is_bj(g.dealer) then
      pay := 0; hand := hand || jsonb_build_object('status', 'stood', 'result', 'lose', 'payout', 0);
    else
      pay := p_bet + (p_bet * 3) / 2; hand := hand || jsonb_build_object('status', 'blackjack', 'result', 'blackjack', 'payout', pay);
    end if;
    g.hands := jsonb_build_array(hand); g.phase := 'FINISHED';
    r := private.bj_finish(r.id, me.id, g, pay);
  else
    update public.casino_rounds set state = private.bj_public(g) where id = r.id returning * into r;
  end if;
  return jsonb_build_object('ok', true, 'replayed', false, 'round', private.round_public(r));
end $$;

create or replace function public.rpc_blackjack_action(p_round_id uuid, p_action text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles; r public.casino_rounds; g private.blackjack_games; a public.casino_actions;
  h jsonb; cards smallint[]; n int; bet bigint; bal bigint; c1 smallint; c2 smallint; aces boolean; st record; seq_ int;
begin
  me := private.caller();
  if not private.valid_key(p_idempotency_key) then return private.err('invalid_idempotency_key'); end if;
  if p_action not in ('hit','stand','double','split') then return private.err('invalid_action'); end if;

  select * into r from public.casino_rounds where id = p_round_id and user_id = me.id for update;
  if not found then
    perform private.log_event(me.id, 'foreign_or_unknown_round', 'warn', jsonb_build_object('round', p_round_id));
    return private.err('round_not_found');
  end if;
  select * into a from public.casino_actions where round_id = r.id and idempotency_key = p_idempotency_key;
  if found then
    if a.action <> p_action then
      perform private.log_event(me.id, 'idempotency_conflict', 'warn', jsonb_build_object('round', r.id, 'key', p_idempotency_key));
      return private.err('idempotency_conflict');
    end if;
    return jsonb_build_object('ok', true, 'replayed', true, 'round', private.round_public(r));
  end if;
  if r.game_slug <> 'blackjack' then return private.err('invalid_action'); end if;
  if r.status <> 'active' then return private.err('round_finished', jsonb_build_object('round', private.round_public(r))); end if;

  select * into g from private.blackjack_games where round_id = r.id for update;
  n := g.active_hand;
  h := g.hands -> n;
  cards := private.bj_cards(h);
  bet := (h ->> 'bet')::bigint;

  if h ->> 'status' <> 'playing' or (h ->> 'splitAces')::boolean then
    perform private.log_event(me.id, 'invalid_transition', 'info', jsonb_build_object('round', r.id, 'action', p_action));
    return private.err('invalid_action');
  end if;

  if p_action = 'hit' then
    cards := cards || g.deck[g.pos]; g.pos := g.pos + 1;
    h := h || jsonb_build_object('cards', to_jsonb(cards));
    if private.bj_total(cards) > 21 then h := h || '{"status":"bust"}';
    elsif private.bj_total(cards) = 21 then h := h || '{"status":"stood"}'; end if;

  elsif p_action = 'stand' then
    h := h || '{"status":"stood"}';

  elsif p_action = 'double' then
    if cardinality(cards) <> 2 then
      perform private.log_event(me.id, 'invalid_transition', 'info', jsonb_build_object('round', r.id, 'action', p_action));
      return private.err('invalid_action');
    end if;
    select balance into bal from public.wallets where user_id = me.id for update;
    if bal < bet then return private.err('insufficient_funds', jsonb_build_object('balance', bal)); end if;
    perform private.post_tx(me.id, -bet, 'bet', 'bet:' || r.id || ':double:' || n, r.id, jsonb_build_object('game','blackjack','action','double'));
    cards := cards || g.deck[g.pos]; g.pos := g.pos + 1;
    h := h || jsonb_build_object('cards', to_jsonb(cards), 'bet', bet * 2, 'doubled', true,
                                 'status', case when private.bj_total(cards) > 21 then 'bust' else 'stood' end);
    update public.casino_rounds set bet_total = bet_total + bet where id = r.id;

  elsif p_action = 'split' then
    if jsonb_array_length(g.hands) <> 1 or cardinality(cards) <> 2 or private.bj_val(cards[1]) <> private.bj_val(cards[2]) then
      perform private.log_event(me.id, 'invalid_transition', 'info', jsonb_build_object('round', r.id, 'action', p_action));
      return private.err('invalid_action');
    end if;
    select balance into bal from public.wallets where user_id = me.id for update;
    if bal < bet then return private.err('insufficient_funds', jsonb_build_object('balance', bal)); end if;
    perform private.post_tx(me.id, -bet, 'bet', 'bet:' || r.id || ':split', r.id, jsonb_build_object('game','blackjack','action','split'));
    update public.casino_rounds set bet_total = bet_total + bet where id = r.id;
    aces := cards[1] % 13 = 0;
    c1 := g.deck[g.pos]; c2 := g.deck[g.pos + 1]; g.pos := g.pos + 2;
    g.hands := jsonb_build_array(
      jsonb_build_object('cards', to_jsonb(array[cards[1], c1]), 'bet', bet, 'doubled', false, 'split', true, 'splitAces', aces,
        'status', case when aces or private.bj_total(array[cards[1], c1]) = 21 then 'stood' else 'playing' end),
      jsonb_build_object('cards', to_jsonb(array[cards[2], c2]), 'bet', bet, 'doubled', false, 'split', true, 'splitAces', aces,
        'status', case when aces or private.bj_total(array[cards[2], c2]) = 21 then 'stood' else 'playing' end));
    h := null;
  end if;

  if h is not null then g.hands := jsonb_set(g.hands, array[n::text], h); end if;
  -- advance to next playable hand
  while g.active_hand < jsonb_array_length(g.hands) and g.hands -> g.active_hand ->> 'status' <> 'playing' loop
    g.active_hand := g.active_hand + 1;
  end loop;

  select coalesce(max(seq), -1) + 1 into seq_ from public.casino_actions where round_id = r.id;
  insert into public.casino_actions(round_id, user_id, seq, action, idempotency_key, payload)
  values (r.id, me.id, seq_, p_action, p_idempotency_key, jsonb_build_object('hand', n));

  if g.active_hand >= jsonb_array_length(g.hands) then
    select * into st from private.bj_settle(g);
    g := st.g;
    r := private.bj_finish(r.id, me.id, g, st.payout);
  else
    update private.blackjack_games set pos = g.pos, hands = g.hands, active_hand = g.active_hand where round_id = r.id;
    update public.casino_rounds set state = private.bj_public(g) where id = r.id returning * into r;
  end if;
  return jsonb_build_object('ok', true, 'replayed', false, 'round', private.round_public(r));
end $$;
