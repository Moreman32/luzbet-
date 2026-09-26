-- =====================================================================
-- LuzBet 2.0 — Games pack v1
--   * brings prod-only Dice / Leaderboard into version control (same behaviour, adds enabled check)
--   * Higher/Lower v3: idempotent guesses, recorded actions, exact fractions, payout cap, single-nonce shuffle
--   * new: Mines, Crash, Plinko, Horse racing, Businka's Fortune slots
--   * rescue fund ("Фонд поддержки пострадавших от собственных решений")
-- All outcomes: private.fair_ints / HMAC stream of the player's committed seed pair. One nonce per round.
-- =====================================================================

-- ---------- 0. shared plumbing ------------------------------------------------
alter table public.casino_actions drop constraint if exists casino_actions_action_check;
alter table public.casino_actions add constraint casino_actions_action_check
  check (action in ('start','hit','stand','double','split','settle','reveal','cashout','higher','lower'));

create unique index if not exists casino_rounds_one_active_multi on public.casino_rounds(user_id, game_slug)
  where status = 'active' and game_slug in ('mines','crash','higher_lower');

create or replace function private.cap_payout(p bigint) returns bigint
language sql immutable set search_path = '' as $$ select least(greatest(p, 0), 5000000) $$;

create or replace function private.jints(j jsonb) returns int[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(x.v::int order by x.i), '{}'::int[]) from jsonb_array_elements_text(j) with ordinality x(v, i)
$$;

-- Opens a round: idempotency (user,key)+request hash, rule version, bet limits, seed lock, optional single-active,
-- wallet lock, debit. Returns the new (or replayed) round, the server secret, or an error payload.
create or replace function private.begin_round(p_user uuid, p_game text, p_bet bigint, p_key text, p_req jsonb, p_single boolean,
  out r public.casino_rounds, out err jsonb, out replayed boolean, out secret text, out rules jsonb)
language plpgsql security definer set search_path = '' as $$
declare rv public.game_rule_versions; s public.fair_seeds; req_hash text; bal bigint; other public.casino_rounds;
begin
  replayed := false; err := null;
  if not private.valid_key(p_key) then err := private.err('invalid_idempotency_key'); return; end if;
  req_hash := encode(extensions.digest(p_req::text, 'sha256'), 'hex');
  select * into r from public.casino_rounds where user_id = p_user and idempotency_key = p_key;
  if found then
    if r.request_hash <> req_hash or r.game_slug <> p_game then
      perform private.log_event(p_user, 'idempotency_conflict', 'warn', jsonb_build_object('key', p_key, 'game', p_game));
      err := private.err('idempotency_conflict'); r := null; return;
    end if;
    replayed := true; return;
  end if;
  select * into rv from public.game_rule_versions where game_slug = p_game and is_current;
  if not found or not exists (select 1 from public.game_definitions where slug = p_game and status = 'enabled') then
    err := private.err('game_unavailable'); return;
  end if;
  rules := rv.rules;
  if p_bet is null or p_bet < coalesce((rules ->> 'minBet')::bigint, 1) or p_bet > coalesce((rules ->> 'maxBet')::bigint, 5000) then
    err := private.err('bet_limits', jsonb_build_object('min', rules -> 'minBet', 'max', rules -> 'maxBet')); return;
  end if;
  s := private.lock_seed(p_user);
  select * into r from public.casino_rounds where user_id = p_user and idempotency_key = p_key;
  if found then
    if r.request_hash <> req_hash then err := private.err('idempotency_conflict'); r := null; return; end if;
    replayed := true; return;
  end if;
  if p_single then
    select * into other from public.casino_rounds where user_id = p_user and game_slug = p_game and status = 'active';
    if found then err := private.err('round_in_progress', jsonb_build_object('round', private.round_public(other))); return; end if;
  end if;
  select balance into bal from public.wallets where user_id = p_user for update;
  if bal < p_bet then err := private.err('insufficient_funds', jsonb_build_object('balance', bal)); return; end if;
  insert into public.casino_rounds(user_id, game_slug, rule_version_id, status, bet_total, seed_id, nonce,
                                   client_seed, server_seed_hash, idempotency_key, request_hash, request)
  values (p_user, p_game, rv.id, 'active', p_bet, s.id, s.next_nonce, s.client_seed, s.server_seed_hash, p_key, req_hash, p_req)
  returning * into r;
  update public.fair_seeds set next_nonce = next_nonce + 1 where id = s.id;
  perform private.post_tx(p_user, -p_bet, 'bet', 'bet:' || r.id, r.id, jsonb_build_object('game', p_game));
  secret := private.secret_of(s.id);
end $$;

create or replace function private.finish_round(p_round uuid, p_payout bigint, p_state jsonb) returns public.casino_rounds
language plpgsql security definer set search_path = '' as $$
declare r public.casino_rounds; pay bigint := private.cap_payout(p_payout);
begin
  select * into r from public.casino_rounds where id = p_round;
  if pay > 0 then
    perform private.post_tx(r.user_id, pay, 'payout', 'payout:' || r.id, r.id, jsonb_build_object('game', r.game_slug));
  end if;
  update public.casino_rounds set status = 'finished', payout = pay, finished_at = now(), state = p_state
   where id = p_round returning * into r;
  return r;
end $$;

create or replace function private.add_action(p_round uuid, p_user uuid, p_action text, p_key text, p_payload jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.casino_actions(round_id, user_id, seq, action, idempotency_key, payload)
  select p_round, p_user, coalesce(max(seq), -1) + 1, p_action, p_key, coalesce(p_payload, '{}'::jsonb)
    from public.casino_actions where round_id = p_round
$$;

-- Locks the caller's round of a game and handles action idempotency. Returns error payload, or replayed round, or null to proceed.
create or replace function private.lock_action(p_user uuid, p_round uuid, p_game text, p_action text, p_key text, out r public.casino_rounds, out result jsonb)
language plpgsql security definer set search_path = '' as $$
declare a public.casino_actions;
begin
  result := null;
  if not private.valid_key(p_key) then result := private.err('invalid_idempotency_key'); return; end if;
  select * into r from public.casino_rounds where id = p_round and user_id = p_user and game_slug = p_game for update;
  if not found then
    perform private.log_event(p_user, 'foreign_or_unknown_round', 'warn', jsonb_build_object('round', p_round, 'game', p_game));
    result := private.err('round_not_found'); return;
  end if;
  select * into a from public.casino_actions where round_id = r.id and idempotency_key = p_key;
  if found then
    if a.action <> p_action then
      perform private.log_event(p_user, 'idempotency_conflict', 'warn', jsonb_build_object('round', r.id, 'key', p_key));
      result := private.err('idempotency_conflict'); return;
    end if;
    result := jsonb_build_object('ok', true, 'replayed', true, 'round', private.round_public(r)); return;
  end if;
  if r.status <> 'active' then result := private.err('round_finished', jsonb_build_object('round', private.round_public(r))); end if;
end $$;

-- ---------- 1. catalogue ------------------------------------------------------------
insert into public.game_definitions(slug, name, status, sort_order) values
  ('roulette', 'Европейская рулетка', 'enabled', 10),
  ('blackjack', 'Блэкджек', 'enabled', 20),
  ('businka_slots', 'Бусинка: Кошачья фортуна', 'enabled', 25),
  ('crash', 'Crash: Курс ЛК', 'enabled', 30),
  ('dice', 'Dice', 'enabled', 35),
  ('mines', 'Минное поле бухгалтерии', 'enabled', 40),
  ('higher_lower', 'Больше / Меньше', 'enabled', 45),
  ('plinko', 'Plinko: Кредитная воронка', 'enabled', 50),
  ('horse', 'Скачки', 'enabled', 60)
on conflict (slug) do update set name = excluded.name, status = excluded.status, sort_order = excluded.sort_order;

update public.game_rule_versions set is_current = false where game_slug = 'higher_lower' and id <> 'higher_lower_standard_v3';

insert into public.game_rule_versions(id, game_slug, version, is_current, rules) values
 ('dice_standard_v1', 'dice', 1, true, '{"rng":"fair_ints mod 10000; rejection sampled HMAC stream","maxBet":7500,"minBet":1,"houseEdge":0.03,"maxChance":95,"minChance":2}'::jsonb),
 ('higher_lower_standard_v3', 'higher_lower', 3, true, '{
   "cards":52,"decks":1,"aceHigh":true,"sameRankExcluded":true,"houseEdge":0.03,"minBet":1,"maxBet":5000,
   "multiplier":"0.97 / product(winning cards / eligible cards) at cash-out, capped at 10000x","maxPayout":5000000,
   "rng":"Fisher-Yates over 52 cards (j = fairInt(i+1), i = 51..1); card c: rank = c%13+2 (14 = ace), suit = [S,H,D,C][c/13]; next card = next card in shoe order with a different rank"}'::jsonb),
 ('mines_v1', 'mines', 1, true, '{
   "tiles":25,"minMines":1,"maxMines":24,"houseEdge":0.03,"minBet":1,"maxBet":5000,"maxPayout":5000000,
   "multiplier":"0.97 * prod_{i<k} (25-i)/(25-m-i) after k safe tiles",
   "rng":"Fisher-Yates over tiles 0..24 (j = fairInt(i+1), i = 24..1); mines = first m tiles"}'::jsonb),
 ('crash_v1', 'crash', 1, true, '{
   "houseEdge":0.03,"minBet":1,"maxBet":5000,"maxPayout":5000000,"minCashout":1.01,"maxAuto":10000,"maxCrash":10000,
   "crash":"r = fairInt(2147483647); crash = max(1.00, min(10000, floor(97*N/(N-r))/100)), N = 2147483647",
   "curve":"multiplier(t) = floor(100 * e^(0.00006 * t_ms)) / 100, server clock",
   "win":"cash-out multiplier <= crash point (auto cash-out wins if auto <= crash)"}'::jsonb),
 ('plinko_v1', 'plinko', 1, true, '{
   "rows":12,"minBet":1,"maxBet":5000,"maxPayout":5000000,
   "tables":{"low":[10,3,1.6,1.4,1.1,0.95,0.5,0.95,1.1,1.4,1.6,3,10],
             "medium":[33,11,4,2,1.1,0.55,0.3,0.55,1.1,2,4,11,33],
             "high":[170,24,8,2,0.63,0.2,0.2,0.2,0.63,2,8,24,170]},
   "rtp":{"low":97.046,"medium":97.056,"high":97.102},
   "rng":"12 draws fairInt(2): 1 = right; bucket = number of rights"}'::jsonb),
 ('horse_v1', 'horse', 1, true, '{
   "minBet":1,"maxBet":10000,"maxPerHorse":5000,"margin":0.05,
   "horses":[{"name":"Кэф 1.01","w":300},{"name":"Конь Депозита","w":200},{"name":"Последняя Зарплата","w":150},
             {"name":"Бусинка","w":120},{"name":"Финансовый Советник","w":90},{"name":"Маржин Колл","w":70},
             {"name":"Ипотека","w":45},{"name":"Ждун","w":25}],
   "odds":"floor(95000 / w) / 100 (5% bookmaker margin, published)",
   "rng":"finishing order by sequential weighted draws u = fairInt(sum of remaining weights) from one HMAC stream; winner = first"}'::jsonb),
 ('businka_slots_v1', 'businka_slots', 1, true, '{
   "minBet":10,"maxBet":5000,"maxPayout":5000000,"lines":10,
   "symbols":["WILD","SCATTER","BUSINKA","CROWN","SEVEN","BAG","BOWL","FISH"],
   "strips":[[7,7,5,3,7,2,4,5,7,7,5,1,3,7,6,7,5,7,2,4,5,7,3,7,5],
             [6,7,6,7,4,7,6,2,3,5,7,6,4,7,0,1,6,7,6,7,4,7,6,2,3,5,7,6,4,7],
             [6,7,5,6,7,4,7,6,2,5,3,7,6,5,4,7,0,1,6,7,5,6,7,4,5,7,6,2,3,7,5,6,4,7,5],
             [6,7,6,7,5,4,3,7,6,2,5,7,6,4,7,5,0,1,6,3,7,6,7,5,4,7,6,2,5,7,3,6,4,7,5],
             [7,7,5,4,6,3,0,7,2,5,7,6,4,7,5,1,3,6,7,5,4,7,0,2,6,7,5,3,7,4,6,5]],
   "paylines":[[1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],[0,0,1,2,2],[2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[0,1,1,1,0]],
   "pay":{"2":{"3":50,"4":250,"5":1000},"3":{"3":25,"4":100,"5":500},"4":{"3":20,"4":75,"5":300},
          "5":{"3":10,"4":40,"5":150},"6":{"3":5,"4":20,"5":80},"7":{"3":4,"4":15,"5":50}},
   "payUnit":"line pay x (total bet / 10); leading wilds pay as BUSINKA",
   "scatterPay":{"3":2,"4":10,"5":50},"freeSpins":{"3":8,"4":10,"5":12},"retrigger":5,"maxFreeSpins":50,"freeSpinMultiplier":2,
   "rtp":96.23,
   "rng":"stops = fairInt(len(strip_r)) for r = 0..4, repeated for up to 51 spins from one draw list; window row j = strip[(stop+j) mod len]"}'::jsonb)
on conflict (id) do nothing;

-- ---------- 2. Dice (prod behaviour, now versioned) ------------------------------------
create or replace function public.rpc_dice_roll(p_bet bigint, p_chance integer, p_direction text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me public.profiles; b record; roll int; win bigint := 0; mult numeric; won boolean; r public.casino_rounds;
begin
  me := private.caller();
  if p_chance is null or p_chance < 2 or p_chance > 95 or p_direction is null or p_direction not in ('under','over') then
    return private.err('invalid_bet');
  end if;
  select * into b from private.begin_round(me.id, 'dice', p_bet, p_idempotency_key,
    jsonb_build_object('bet', p_bet, 'chance', p_chance, 'direction', p_direction), false);
  if b.err is not null then return b.err; end if;
  if b.replayed then return jsonb_build_object('ok', true, 'replayed', true, 'round', private.round_public(b.r)); end if;
  roll := (private.fair_ints(b.secret, (b.r).client_seed, (b.r).nonce, array[10000]))[1];
  mult := 97.0 / p_chance;
  won := case when p_direction = 'under' then roll < p_chance * 100 else roll >= (100 - p_chance) * 100 end;
  if won then win := div(p_bet * 97, p_chance)::bigint; end if;   -- exact floor(bet * 97 / chance)
  r := private.finish_round((b.r).id, win, jsonb_build_object('roll', roll, 'chance', p_chance, 'direction', p_direction,
                                                            'multiplier', round(mult, 4), 'won', won));
  perform private.add_action(r.id, me.id, 'settle', p_idempotency_key, jsonb_build_object('roll', roll, 'payout', r.payout));
  return jsonb_build_object('ok', true, 'replayed', false, 'round', private.round_public(r));
end $$;

-- ---------- 3. Leaderboard (prod behaviour, now versioned) ------------------------------
create or replace function public.rpc_leaderboard(p_period text default 'all')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles; since_ts timestamptz; rows_json jsonb;
begin
  me := private.caller();
  since_ts := case p_period
    when 'today' then date_trunc('day', now() at time zone 'Europe/Nicosia') at time zone 'Europe/Nicosia'
    when '7d' then now() - interval '7 days' when '30d' then now() - interval '30 days' else '-infinity'::timestamptz end;
  with round_stats as (
    select r.user_id, count(*)::bigint rounds, coalesce(sum(r.bet_total),0)::bigint wagered, coalesce(sum(r.payout),0)::bigint won,
           coalesce(sum(r.payout-r.bet_total),0)::bigint net,
           coalesce(max(r.payout-r.bet_total) filter (where r.payout>r.bet_total),0)::bigint biggest_win
      from public.casino_rounds r where r.status='finished' and r.created_at >= since_ts group by r.user_id
  ), ranked as (
    select p.id, p.display_name, p.username, p.avatar, w.balance,
           coalesce(s.rounds,0) rounds, coalesce(s.wagered,0) wagered, coalesce(s.won,0) won, coalesce(s.net,0) net,
           coalesce(s.biggest_win,0) biggest_win,
           row_number() over(order by w.balance desc, coalesce(s.wagered,0) desc, p.created_at asc) balance_rank,
           row_number() over(order by coalesce(s.net,0) desc, coalesce(s.wagered,0) desc, p.created_at asc) profit_rank
      from public.profiles p join public.wallets w on w.user_id=p.id left join round_stats s on s.user_id=p.id
     where p.status='active')
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'displayName',display_name,'username',username,'avatar',avatar,'balance',balance,
    'rounds',rounds,'wagered',wagered,'won',won,'net',net,'biggestWin',biggest_win,'balanceRank',balance_rank,'profitRank',profit_rank,
    'title', case when balance_rank=1 then 'Председатель совета директоров' when net <= -5000 then 'Генеральный спонсор заведения'
      when net >= 5000 then 'Ошибка финансового планирования' when wagered >= 25000 then 'Почётный клиент кассы'
      when rounds=0 then 'Финансово осторожный гражданин' else 'Квалифицированный инвестор в ЛК' end
  ) order by balance_rank), '[]'::jsonb) into rows_json from ranked;
  return jsonb_build_object('ok',true,'period',p_period,'players',rows_json);
end $$;

-- ---------- 4. Higher / Lower v3 ----------------------------------------------------------
-- Non-destructive: the v2 prototype table private.higher_lower_games and its private.hl_* helpers are left in place
-- (unused, EXECUTE revoked below). v3 uses its own table private.hl_games and private.hl3_* helpers.


create table if not exists private.hl_games (
  round_id uuid primary key references public.casino_rounds(id) on delete restrict,
  deck     smallint[] not null,
  pos      int not null,          -- 1-based index of the next undealt card
  current  smallint not null,
  path_num numeric not null default 1,   -- probability of the winning path = path_num / path_den (exact)
  path_den numeric not null default 1,
  wins     int not null default 0
);
alter table private.hl_games enable row level security;

create or replace function private.hl3_card(c int) returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', c, 'rank', c % 13 + 2, 'suit', (array['S','H','D','C'])[c / 13 + 1])
$$;
create or replace function private.hl3_options(g private.hl_games) returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('higher', count(*) filter (where x % 13 > g.current % 13),
                            'lower',  count(*) filter (where x % 13 < g.current % 13),
                            'total',  count(*) filter (where x % 13 <> g.current % 13))
    from unnest(g.deck[g.pos:]) x
$$;
create or replace function private.hl3_mult(g private.hl_games) returns numeric language sql immutable set search_path = '' as $$
  select least(97 * g.path_den / (100 * g.path_num), 10000)
$$;
create or replace function private.hl3_state(g private.hl_games, hist jsonb, extra jsonb default '{}'::jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('current', private.hl3_card(g.current), 'history', hist, 'wins', g.wins,
    'multiplier', case when g.wins = 0 then 1 else round(private.hl3_mult(g), 4) end,
    'pathProbability', round(g.path_num / g.path_den, 10),
    'remaining', coalesce(cardinality(g.deck) - g.pos + 1, 0), 'options', private.hl3_options(g)) || coalesce(extra, '{}'::jsonb)
$$;

create or replace function public.rpc_higher_lower_start(p_bet bigint, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me public.profiles; b record; d smallint[]; r int[]; i int; j int; t smallint; k int := 1; g private.hl_games; st jsonb;
begin
  me := private.caller();
  select * into b from private.begin_round(me.id, 'higher_lower', p_bet, p_idempotency_key, jsonb_build_object('bet', p_bet), true);
  if b.err is not null then return b.err; end if;
  if b.replayed then return jsonb_build_object('ok', true, 'replayed', true, 'round', private.round_public(b.r)); end if;
  select array_agg(x::smallint order by x) into d from generate_series(0, 51) x;
  r := private.fair_ints(b.secret, (b.r).client_seed, (b.r).nonce, (select array_agg(m order by m desc) from generate_series(2, 52) m));
  for i in reverse 51..1 loop j := r[k]; k := k + 1; t := d[i+1]; d[i+1] := d[j+1]; d[j+1] := t; end loop;
  g := row((b.r).id, d, 2, d[1], 1, 1, 0)::private.hl_games;
  insert into private.hl_games values (g.*);
  st := private.hl3_state(g, jsonb_build_array(private.hl3_card(d[1])));
  update public.casino_rounds set state = st where id = (b.r).id;
  perform private.add_action((b.r).id, me.id, 'start', p_idempotency_key, jsonb_build_object('bet', p_bet));
  return jsonb_build_object('ok', true, 'replayed', false, 'round', private.round_public((select x from public.casino_rounds x where x.id = (b.r).id)));
end $$;

create or replace function public.rpc_higher_lower_guess(p_round_id uuid, p_guess text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me public.profiles; l record; g private.hl_games; opt jsonb; w int; tot int; nxt smallint; ok boolean; hist jsonb; r public.casino_rounds;
begin
  me := private.caller();
  if p_guess is null or p_guess not in ('higher','lower') then return private.err('invalid_guess'); end if;
  select * into l from private.lock_action(me.id, p_round_id, 'higher_lower', p_guess, p_idempotency_key);
  if l.result is not null then return l.result; end if;
  select * into g from private.hl_games where round_id = (l.r).id for update;
  opt := private.hl3_options(g); w := (opt ->> p_guess)::int; tot := (opt ->> 'total')::int;
  if w is null or w <= 0 or tot <= 0 then return private.err('choice_unavailable'); end if;
  while g.deck[g.pos] % 13 = g.current % 13 loop g.pos := g.pos + 1; end loop;   -- burn same-rank cards
  nxt := g.deck[g.pos]; g.pos := g.pos + 1;
  ok := case when p_guess = 'higher' then nxt % 13 > g.current % 13 else nxt % 13 < g.current % 13 end;
  hist := coalesce((l.r).state -> 'history', '[]'::jsonb) || jsonb_build_array(private.hl3_card(nxt));
  g.current := nxt;
  perform private.add_action((l.r).id, me.id, p_guess, p_idempotency_key, jsonb_build_object('card', nxt, 'won', ok));
  if not ok then
    update private.hl_games set pos = g.pos, current = g.current where round_id = g.round_id;
    r := private.finish_round((l.r).id, 0, private.hl3_state(g, hist, jsonb_build_object('lastGuess', p_guess, 'won', false, 'phase', 'LOST')));
  else
    g.path_num := g.path_num * w; g.path_den := g.path_den * tot; g.wins := g.wins + 1;
    update private.hl_games set pos = g.pos, current = g.current, path_num = g.path_num, path_den = g.path_den, wins = g.wins
     where round_id = g.round_id;
    update public.casino_rounds set state = private.hl3_state(g, hist, jsonb_build_object('lastGuess', p_guess, 'won', true, 'phase', 'PLAYING'))
     where id = (l.r).id returning * into r;
  end if;
  return jsonb_build_object('ok', true, 'replayed', false, 'round', private.round_public(r));
end $$;

create or replace function public.rpc_higher_lower_cashout(p_round_id uuid, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me public.profiles; l record; g private.hl_games; pay bigint; r public.casino_rounds;
begin
  me := private.caller();
  select * into l from private.lock_action(me.id, p_round_id, 'higher_lower', 'cashout', p_idempotency_key);
  if l.result is not null then return l.result; end if;
  select * into g from private.hl_games where round_id = (l.r).id for update;
  if g.wins < 1 then return private.err('cashout_unavailable'); end if;
  pay := least(div((l.r).bet_total * 97 * g.path_den, 100 * g.path_num), (l.r).bet_total * 10000)::bigint;
  perform private.add_action((l.r).id, me.id, 'cashout', p_idempotency_key, jsonb_build_object('multiplier', private.hl3_mult(g)));
  r := private.finish_round((l.r).id, pay, private.hl3_state(g, (l.r).state -> 'history', jsonb_build_object('cashed', true, 'phase', 'CASHED')));
  return jsonb_build_object('ok', true, 'replayed', false, 'round', private.round_public(r));
end $$;

-- ---------- 5. Mines ----------------------------------------------------------------------
create table if not exists private.mines_games (
  round_id uuid primary key references public.casino_rounds(id) on delete restrict,
  mines    smallint[] not null,
  mine_count int not null check (mine_count between 1 and 24),
  revealed smallint[] not null default '{}'
);
alter table private.mines_games enable row level security;

-- exact multiplier numerator/denominator after k safe tiles
create or replace function private.mines_frac(m int, k int, out num numeric, out den numeric)
language plpgsql immutable set search_path = '' as $$
declare i int;
begin
  if k = 0 then num := 1; den := 1; return; end if;
  num := 97; den := 100;
  for i in 0..k-1 loop num := num * (25 - i); den := den * (25 - m - i); end loop;
end $$;
create or replace function private.mines_mult(m int, k int) returns numeric language sql immutable set search_path = '' as $$
  select round(f.num / f.den, 4) from private.mines_frac(m, k) f
$$;
create or replace function private.mines_pay(bet bigint, m int, k int) returns bigint language sql immutable set search_path = '' as $$
  select private.cap_payout(div(bet * f.num, f.den)::bigint) from private.mines_frac(m, k) f
$$;
create or replace function private.mines_state(g private.mines_games, bet bigint, reveal_all boolean, extra jsonb default '{}'::jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('mines', g.mine_count, 'revealed', to_jsonb(g.revealed),
    'safeLeft', 25 - g.mine_count - coalesce(cardinality(g.revealed), 0),
    'multiplier', private.mines_mult(g.mine_count, coalesce(cardinality(g.revealed), 0)),
    'next', case when coalesce(cardinality(g.revealed), 0) < 25 - g.mine_count then private.mines_mult(g.mine_count, coalesce(cardinality(g.revealed), 0) + 1) end,
    'cashoutValue', case when coalesce(cardinality(g.revealed), 0) > 0 then private.mines_pay(bet, g.mine_count, cardinality(g.revealed)) else 0 end,
    'minePositions', case when reveal_all then to_jsonb(g.mines) end) || coalesce(extra, '{}'::jsonb)
$$;

create or replace function public.rpc_mines_start(p_bet bigint, p_mines int, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me public.profiles; b record; d smallint[]; r int[]; i int; j int; t smallint; k int := 1; g private.mines_games; mines smallint[];
begin
  me := private.caller();
  if p_mines is null or p_mines < 1 or p_mines > 24 then return private.err('invalid_bet'); end if;
  select * into b from private.begin_round(me.id, 'mines', p_bet, p_idempotency_key, jsonb_build_object('bet', p_bet, 'mines', p_mines), true);
  if b.err is not null then return b.err; end if;
  if b.replayed then return jsonb_build_object('ok', true, 'replayed', true, 'round', private.round_public(b.r)); end if;
  select array_agg(x::smallint order by x) into d from generate_series(0, 24) x;
  r := private.fair_ints(b.secret, (b.r).client_seed, (b.r).nonce, (select array_agg(m order by m desc) from generate_series(2, 25) m));
  for i in reverse 24..1 loop j := r[k]; k := k + 1; t := d[i+1]; d[i+1] := d[j+1]; d[j+1] := t; end loop;
  select array_agg(x order by x) into mines from unnest(d[1:p_mines]) x;
  g := row((b.r).id, mines, p_mines, '{}'::smallint[])::private.mines_games;
  insert into private.mines_games values (g.*);
  update public.casino_rounds set state = private.mines_state(g, p_bet, false, '{"phase":"PLAYING"}') where id = (b.r).id;
  perform private.add_action((b.r).id, me.id, 'start', p_idempotency_key, jsonb_build_object('bet', p_bet, 'mines', p_mines));
  return jsonb_build_object('ok', true, 'replayed', false, 'round', private.round_public((select x from public.casino_rounds x where x.id = (b.r).id)));
end $$;

create or replace function public.rpc_mines_reveal(p_round_id uuid, p_tile int, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me public.profiles; l record; g private.mines_games; r public.casino_rounds; k int;
begin
  me := private.caller();
  if p_tile is null or p_tile < 0 or p_tile > 24 then return private.err('invalid_action'); end if;
  select * into l from private.lock_action(me.id, p_round_id, 'mines', 'reveal', p_idempotency_key);
  if l.result is not null then return l.result; end if;
  select * into g from private.mines_games where round_id = (l.r).id for update;
  if p_tile = any(g.revealed) then return private.err('invalid_action'); end if;
  perform private.add_action((l.r).id, me.id, 'reveal', p_idempotency_key, jsonb_build_object('tile', p_tile));
  if p_tile = any(g.mines) then
    r := private.finish_round((l.r).id, 0, private.mines_state(g, (l.r).bet_total, true, jsonb_build_object('phase', 'BOOM', 'hit', p_tile)));
    return jsonb_build_object('ok', true, 'replayed', false, 'round', private.round_public(r));
  end if;
  g.revealed := g.revealed || p_tile::smallint;
  update private.mines_games set revealed = g.revealed where round_id = g.round_id;
  k := cardinality(g.revealed);
  if k = 25 - g.mine_count then
    r := private.finish_round((l.r).id, private.mines_pay((l.r).bet_total, g.mine_count, k),
                              private.mines_state(g, (l.r).bet_total, true, '{"phase":"CLEARED"}'));
  else
    update public.casino_rounds set state = private.mines_state(g, (l.r).bet_total, false, '{"phase":"PLAYING"}')
     where id = (l.r).id returning * into r;
  end if;
  return jsonb_build_object('ok', true, 'replayed', false, 'round', private.round_public(r));
end $$;

create or replace function public.rpc_mines_cashout(p_round_id uuid, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me public.profiles; l record; g private.mines_games; r public.casino_rounds;
begin
  me := private.caller();
  select * into l from private.lock_action(me.id, p_round_id, 'mines', 'cashout', p_idempotency_key);
  if l.result is not null then return l.result; end if;
  select * into g from private.mines_games where round_id = (l.r).id for update;
  if coalesce(cardinality(g.revealed), 0) = 0 then return private.err('cashout_unavailable'); end if;
  perform private.add_action((l.r).id, me.id, 'cashout', p_idempotency_key, jsonb_build_object('safe', cardinality(g.revealed)));
  r := private.finish_round((l.r).id, private.mines_pay((l.r).bet_total, g.mine_count, cardinality(g.revealed)),
                            private.mines_state(g, (l.r).bet_total, true, '{"phase":"CASHED"}'));
  return jsonb_build_object('ok', true, 'replayed', false, 'round', private.round_public(r));
end $$;

-- ---------- 6. Crash ----------------------------------------------------------------------
create table if not exists private.crash_games (
  round_id   uuid primary key references public.casino_rounds(id) on delete restrict,
  crash_x100 int not null check (crash_x100 between 100 and 1000000),
  auto_x100  int check (auto_x100 is null or auto_x100 between 101 and 1000000),
  started_at timestamptz not null
);
alter table private.crash_games enable row level security;

create or replace function private.crash_point(p_secret text, p_client text, p_nonce bigint) returns int
language sql immutable set search_path = '' as $$
  select greatest(100, least(1000000, ((97::bigint * 2147483647) / (2147483647 - (private.fair_ints(p_secret, p_client, p_nonce, array[2147483647]))[1]))::int))
$$;
create or replace function private.crash_ms_to_reach(x100 int) returns double precision language sql immutable set search_path = '' as $$
  select ln(x100 / 100.0) / 0.00006
$$;
create or replace function private.crash_mult_at(ms double precision) returns int language sql immutable set search_path = '' as $$
  select floor(100 * exp(0.00006 * greatest(ms, 0)))::int
$$;

-- Settles a locked active crash round if its outcome is already determined by the clock. Returns the (possibly updated) round.
create or replace function private.crash_settle(r public.casino_rounds) returns public.casino_rounds
language plpgsql security definer set search_path = '' as $$
declare g private.crash_games; ms double precision;
begin
  if r.status <> 'active' then return r; end if;
  select * into g from private.crash_games where round_id = r.id for update;
  ms := extract(epoch from clock_timestamp() - g.started_at) * 1000;
  if g.auto_x100 is not null and g.auto_x100 <= g.crash_x100 and ms >= private.crash_ms_to_reach(g.auto_x100) then
    return private.finish_round(r.id, div(r.bet_total * g.auto_x100, 100)::bigint,
      jsonb_build_object('phase', 'CASHED', 'auto', g.auto_x100 / 100.0, 'cashout', g.auto_x100 / 100.0, 'crash', g.crash_x100 / 100.0,
                         'startedAt', g.started_at));
  end if;
  if ms >= private.crash_ms_to_reach(g.crash_x100 + 1) then
    return private.finish_round(r.id, 0, jsonb_build_object('phase', 'CRASHED', 'auto', g.auto_x100 / 100.0, 'crash', g.crash_x100 / 100.0,
                                                           'startedAt', g.started_at));
  end if;
  return r;
end $$;

create or replace function public.rpc_crash_start(p_bet bigint, p_auto numeric, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me public.profiles; b record; auto int; prev public.casino_rounds; g private.crash_games; st jsonb;
begin
  me := private.caller();
  if p_auto is not null and (p_auto < 1.01 or p_auto > 10000) then return private.err('invalid_bet'); end if;
  auto := case when p_auto is null then null else floor(p_auto * 100)::int end;
  -- a previous round whose outcome is already decided by the clock is settled first
  select * into prev from public.casino_rounds where user_id = me.id and game_slug = 'crash' and status = 'active' for update;
  if found then perform private.crash_settle(prev); end if;
  select * into b from private.begin_round(me.id, 'crash', p_bet, p_idempotency_key, jsonb_build_object('bet', p_bet, 'auto', auto), true);
  if b.err is not null then return b.err; end if;
  if b.replayed then return jsonb_build_object('ok', true, 'replayed', true, 'round', private.round_public(b.r), 'serverNow', clock_timestamp()); end if;
  g := row((b.r).id, private.crash_point(b.secret, (b.r).client_seed, (b.r).nonce), auto, clock_timestamp())::private.crash_games;
  insert into private.crash_games values (g.*);
  st := jsonb_build_object('phase', 'RUNNING', 'auto', auto / 100.0, 'startedAt', g.started_at);
  update public.casino_rounds set state = st where id = (b.r).id;
  perform private.add_action((b.r).id, me.id, 'start', p_idempotency_key, jsonb_build_object('bet', p_bet, 'auto', auto));
  return jsonb_build_object('ok', true, 'replayed', false, 'serverNow', clock_timestamp(),
                            'round', private.round_public((select x from public.casino_rounds x where x.id = (b.r).id)));
end $$;

create or replace function public.rpc_crash_status(p_round_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.casino_rounds;
begin
  me := private.caller();
  select * into r from public.casino_rounds where id = p_round_id and user_id = me.id and game_slug = 'crash' for update;
  if not found then return private.err('round_not_found'); end if;
  r := private.crash_settle(r);
  return jsonb_build_object('ok', true, 'serverNow', clock_timestamp(), 'round', private.round_public(r));
end $$;

create or replace function public.rpc_crash_cashout(p_round_id uuid, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me public.profiles; l record; g private.crash_games; ms double precision; m int; r public.casino_rounds;
begin
  me := private.caller();
  select * into l from private.lock_action(me.id, p_round_id, 'crash', 'cashout', p_idempotency_key);
  if l.result is not null then return l.result; end if;
  r := private.crash_settle(l.r);
  if r.status <> 'active' then
    perform private.add_action(r.id, me.id, 'cashout', p_idempotency_key, jsonb_build_object('late', true));
    return jsonb_build_object('ok', true, 'replayed', false, 'late', true, 'round', private.round_public(r));
  end if;
  select * into g from private.crash_games where round_id = r.id;
  ms := extract(epoch from clock_timestamp() - g.started_at) * 1000;
  m := private.crash_mult_at(ms);
  if m < 101 then return private.err('too_early'); end if;
  if g.auto_x100 is not null and g.auto_x100 <= g.crash_x100 and m >= g.auto_x100 then
    m := g.auto_x100;                                   -- auto cash-out fired first
  elsif m > g.crash_x100 then                           -- crashed between the settle check and now
    perform private.add_action(r.id, me.id, 'cashout', p_idempotency_key, jsonb_build_object('late', true));
    r := private.finish_round(r.id, 0, jsonb_build_object('phase', 'CRASHED', 'auto', g.auto_x100 / 100.0, 'crash', g.crash_x100 / 100.0, 'startedAt', g.started_at));
    return jsonb_build_object('ok', true, 'replayed', false, 'late', true, 'round', private.round_public(r));
  end if;
  perform private.add_action(r.id, me.id, 'cashout', p_idempotency_key, jsonb_build_object('multiplier', m / 100.0, 'ms', round(ms::numeric, 1)));
  r := private.finish_round(r.id, div(r.bet_total * m, 100)::bigint,
         jsonb_build_object('phase', 'CASHED', 'auto', g.auto_x100 / 100.0, 'cashout', m / 100.0, 'crash', g.crash_x100 / 100.0, 'startedAt', g.started_at));
  return jsonb_build_object('ok', true, 'replayed', false, 'round', private.round_public(r));
end $$;

-- ---------- 7. Plinko ---------------------------------------------------------------------
create or replace function public.rpc_plinko_drop(p_bet bigint, p_risk text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me public.profiles; b record; path int[]; bucket int; mult numeric; r public.casino_rounds;
begin
  me := private.caller();
  if p_risk is null or p_risk not in ('low','medium','high') then return private.err('invalid_bet'); end if;
  select * into b from private.begin_round(me.id, 'plinko', p_bet, p_idempotency_key, jsonb_build_object('bet', p_bet, 'risk', p_risk), false);
  if b.err is not null then return b.err; end if;
  if b.replayed then return jsonb_build_object('ok', true, 'replayed', true, 'round', private.round_public(b.r)); end if;
  path := private.fair_ints(b.secret, (b.r).client_seed, (b.r).nonce, array_fill(2, array[12]));
  select sum(x) into bucket from unnest(path) x;
  mult := (b.rules -> 'tables' -> p_risk ->> bucket)::numeric;
  r := private.finish_round((b.r).id, floor(p_bet * mult)::bigint,
         jsonb_build_object('risk', p_risk, 'path', to_jsonb(path), 'bucket', bucket, 'multiplier', mult));
  perform private.add_action(r.id, me.id, 'settle', p_idempotency_key, jsonb_build_object('bucket', bucket));
  return jsonb_build_object('ok', true, 'replayed', false, 'round', private.round_public(r));
end $$;

-- ---------- 8. Horse racing ---------------------------------------------------------------
-- Weighted finishing order from one HMAC stream (moduli depend on previous draws).
create or replace function private.horse_order(p_secret text, p_client text, p_nonce bigint, p_weights int[]) returns int[]
language plpgsql immutable set search_path = '' as $$
declare rem int[] := array(select generate_series(0, cardinality(p_weights) - 1)); ord int[] := '{}';
  blk bytea; cur int := 0; off int := 32; m int; u bigint; lim bigint; acc int; i int; h int;
begin
  while cardinality(rem) > 1 loop
    select sum(p_weights[x + 1]) into m from unnest(rem) x;
    lim := (4294967296 / m) * m;
    loop
      if off >= 32 then
        blk := extensions.hmac(convert_to(p_client || ':' || p_nonce::text || ':' || cur::text, 'UTF8'), convert_to(p_secret, 'UTF8'), 'sha256');
        cur := cur + 1; off := 0;
      end if;
      u := (get_byte(blk, off)::bigint << 24) | (get_byte(blk, off+1)::bigint << 16) | (get_byte(blk, off+2)::bigint << 8) | get_byte(blk, off+3)::bigint;
      off := off + 4;
      exit when u < lim;
    end loop;
    u := u % m; acc := 0;
    foreach h in array rem loop
      acc := acc + p_weights[h + 1];
      if u < acc then ord := ord || h; rem := array_remove(rem, h); exit; end if;
    end loop;
  end loop;
  return ord || rem[1];
end $$;

create or replace function public.rpc_horse_bet(p_bets jsonb, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me public.profiles; rv public.game_rule_versions; b record; x jsonb; total bigint := 0; weights int[]; odds numeric[];
  ord int[]; winner int; win bigint := 0; lines jsonb := '[]'::jsonb; h int; a bigint; seen int[] := '{}'; lw bigint; r public.casino_rounds;
begin
  me := private.caller();
  select * into rv from public.game_rule_versions where game_slug = 'horse' and is_current;
  if not found then return private.err('game_unavailable'); end if;
  if jsonb_typeof(p_bets) <> 'array' or jsonb_array_length(p_bets) < 1 or jsonb_array_length(p_bets) > 8 then return private.err('invalid_bets'); end if;
  for x in select * from jsonb_array_elements(p_bets) loop
    if jsonb_typeof(x) <> 'object' or coalesce(x ->> 'h', '') !~ '^[0-7]$' or coalesce(x ->> 'a', '') !~ '^[0-9]{1,9}$' then return private.err('invalid_bets'); end if;
    h := (x ->> 'h')::int; a := (x ->> 'a')::bigint;
    if a < 1 or a > (rv.rules ->> 'maxPerHorse')::bigint or h = any(seen) then return private.err('invalid_bets'); end if;
    seen := seen || h; total := total + a;
  end loop;
  select * into b from private.begin_round(me.id, 'horse', total, p_idempotency_key, p_bets, false);
  if b.err is not null then return b.err; end if;
  if b.replayed then return jsonb_build_object('ok', true, 'replayed', true, 'round', private.round_public(b.r)); end if;
  select array_agg((e ->> 'w')::int order by i) into weights from jsonb_array_elements(b.rules -> 'horses') with ordinality t(e, i);
  select array_agg(floor(95000.0 / w) / 100 order by i) into odds from unnest(weights) with ordinality t(w, i);
  ord := private.horse_order(b.secret, (b.r).client_seed, (b.r).nonce, weights);
  winner := ord[1];
  for x in select * from jsonb_array_elements(p_bets) loop
    h := (x ->> 'h')::int; a := (x ->> 'a')::bigint;
    lw := case when h = winner then floor(a * odds[h + 1])::bigint else 0 end;
    win := win + lw;
    lines := lines || jsonb_build_object('h', h, 'a', a, 'odds', odds[h + 1], 'win', lw);
  end loop;
  r := private.finish_round((b.r).id, win, jsonb_build_object('order', to_jsonb(ord), 'winner', winner, 'lines', lines));
  perform private.add_action(r.id, me.id, 'settle', p_idempotency_key, jsonb_build_object('winner', winner));
  return jsonb_build_object('ok', true, 'replayed', false, 'round', private.round_public(r));
end $$;

-- ---------- 9. Businka's Fortune slots ----------------------------------------------------
create or replace function private.slot_line(syms int[], pay jsonb) returns int[]
language plpgsql immutable set search_path = '' as $$
declare lead int := 0; base int := null; n int := 0; best int := 0; bsym int := 2; bn int := 0; p int; i int;
begin
  for i in 1..5 loop exit when syms[i] <> 0; lead := lead + 1; end loop;
  if lead >= 3 then best := coalesce((pay -> '2' ->> lead::text)::int, 0); bn := lead; end if;
  for i in 1..5 loop if syms[i] <> 0 then base := syms[i]; exit; end if; end loop;
  if base is not null and base <> 1 then
    for i in 1..5 loop exit when not (syms[i] = base or syms[i] = 0); n := n + 1; end loop;
    p := coalesce((pay -> base::text ->> n::text)::int, 0);
    if p > best then best := p; bsym := base; bn := n; end if;
  end if;
  return array[best, bsym, bn];
end $$;

create or replace function public.rpc_slots_spin(p_bet bigint, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me public.profiles; b record; rules jsonb; strips jsonb; lines jsonb; pay jsonb; lens int[]; moduli int[] := '{}';
  draws int[]; k int := 1; spins jsonb := '[]'::jsonb; total numeric := 0; free_left int := 0; awarded int := 0; spin_no int := 0;
  mult int; win int[]; stops int[]; li int; rr int; row_ int; syms int[]; lr int[]; units int; sc int; hits jsonb; u numeric;
  add_ int; r public.casino_rounds; maxfree int; retr int;
begin
  me := private.caller();
  select * into b from private.begin_round(me.id, 'businka_slots', p_bet, p_idempotency_key, jsonb_build_object('bet', p_bet), false);
  if b.err is not null then return b.err; end if;
  if b.replayed then return jsonb_build_object('ok', true, 'replayed', true, 'round', private.round_public(b.r)); end if;
  rules := b.rules; strips := rules -> 'strips'; lines := rules -> 'paylines'; pay := rules -> 'pay';
  maxfree := (rules ->> 'maxFreeSpins')::int; retr := (rules ->> 'retrigger')::int;
  select array_agg(jsonb_array_length(e) order by i) into lens from jsonb_array_elements(strips) with ordinality t(e, i);
  for rr in 1..(1 + maxfree) loop moduli := moduli || lens; end loop;
  draws := private.fair_ints(b.secret, (b.r).client_seed, (b.r).nonce, moduli);
  loop
    mult := case when spin_no = 0 then 1 else (rules ->> 'freeSpinMultiplier')::int end;
    stops := draws[k:k + 4]; k := k + 5;
    win := '{}';
    for rr in 0..4 loop
      for row_ in 0..2 loop
        win := win || ((strips -> rr ->> ((stops[rr + 1] + row_) % lens[rr + 1]))::int);
      end loop;
    end loop;
    units := 0; hits := '[]'::jsonb;
    for li in 0..9 loop
      syms := '{}';
      for rr in 0..4 loop syms := syms || win[rr * 3 + (lines -> li ->> rr)::int + 1]; end loop;
      lr := private.slot_line(syms, pay);
      if lr[1] > 0 then units := units + lr[1]; hits := hits || jsonb_build_array(jsonb_build_array(li, lr[2], lr[3], lr[1])); end if;
    end loop;
    select count(*) into sc from unnest(win) x where x = 1;
    u := units::numeric / 10 + case when sc >= 3 then (rules -> 'scatterPay' ->> least(sc, 5)::text)::numeric else 0 end;
    u := u * mult;
    total := total + u;
    spins := spins || jsonb_build_object('stops', to_jsonb(stops), 'window', to_jsonb(win), 'scatters', sc, 'lines', hits, 'units', u, 'mult', mult);
    if spin_no = 0 then
      if sc >= 3 then free_left := (rules -> 'freeSpins' ->> least(sc, 5)::text)::int; awarded := free_left; end if;
    else
      if sc >= 3 and awarded < maxfree then add_ := least(retr, maxfree - awarded); free_left := free_left + add_; awarded := awarded + add_; end if;
    end if;
    exit when free_left = 0;
    free_left := free_left - 1; spin_no := spin_no + 1;
  end loop;
  r := private.finish_round((b.r).id, floor(p_bet * total)::bigint,
         jsonb_build_object('spins', spins, 'freeSpins', awarded, 'totalUnits', total));
  perform private.add_action(r.id, me.id, 'settle', p_idempotency_key, jsonb_build_object('spins', jsonb_array_length(spins)));
  return jsonb_build_object('ok', true, 'replayed', false, 'round', private.round_public(r));
end $$;

-- ---------- 10. Rescue fund ---------------------------------------------------------------
insert into public.system_settings(key, value) values ('rescue_amount', '500'), ('rescue_threshold', '100'), ('rescue_cooldown_hours', '20')
on conflict (key) do nothing;

create or replace function private.rescue_info(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with last as (select max(created_at) t from public.wallet_transactions where user_id = p_user and type = 'bonus' and metadata ->> 'kind' = 'rescue'),
       cfg as (select (private.setting('rescue_amount','500'))::bigint amt, (private.setting('rescue_threshold','100'))::bigint thr,
                      (private.setting('rescue_cooldown_hours','20'))::int hrs)
  select jsonb_build_object('amount', cfg.amt, 'threshold', cfg.thr,
    'nextAt', case when last.t is not null then last.t + make_interval(hours => cfg.hrs) end,
    'eligible', (select balance from public.wallets where user_id = p_user) < cfg.thr
                and (last.t is null or last.t < now() - make_interval(hours => cfg.hrs))
                and not exists (select 1 from public.casino_rounds where user_id = p_user and status = 'active'))
  from last, cfg
$$;

create or replace function public.rpc_claim_rescue() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; info jsonb; tx public.wallet_transactions;
begin
  me := private.caller();
  perform 1 from public.wallets where user_id = me.id for update;
  info := private.rescue_info(me.id);
  if not (info ->> 'eligible')::boolean then return private.err('not_eligible', jsonb_build_object('rescue', info)); end if;
  tx := private.post_tx(me.id, (info ->> 'amount')::bigint, 'bonus', 'rescue:' || me.id || ':' || floor(extract(epoch from now()))::bigint,
                        null, jsonb_build_object('kind', 'rescue'));
  return jsonb_build_object('ok', true, 'amount', (info ->> 'amount')::bigint, 'balance', tx.balance_after, 'rescue', private.rescue_info(me.id));
end $$;

create or replace function public.rpc_me() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; s public.fair_seeds; tz text := 'Europe/Nicosia'; r public.casino_rounds;
begin
  me := private.caller();
  update public.profiles set last_seen_at = now() where id = me.id and (last_seen_at is null or last_seen_at < now() - interval '1 minute');
  -- settle crash rounds that the clock has already decided
  for r in select * from public.casino_rounds where user_id = me.id and game_slug = 'crash' and status = 'active' for update loop
    perform private.crash_settle(r);
  end loop;
  select * into s from public.fair_seeds where user_id = me.id and status = 'active';
  if not found then s := private.new_seed(me.id); end if;
  return jsonb_build_object(
    'id', me.id, 'username', me.username, 'displayName', me.display_name, 'avatar', me.avatar,
    'role', me.role, 'mustChangePassword', me.must_change_password,
    'mfaRequired', me.role in ('admin','owner') and (private.setting('admin_mfa_required','true'::jsonb))::boolean,
    'aal', coalesce(auth.jwt() ->> 'aal', 'aal1'),
    'balance', (select balance from public.wallets where user_id = me.id),
    'seed', jsonb_build_object('id', s.id, 'serverSeedHash', s.server_seed_hash, 'clientSeed', s.client_seed, 'nextNonce', s.next_nonce),
    'activeRounds', coalesce((select jsonb_agg(private.round_public(x)) from public.casino_rounds x where x.user_id = me.id and x.status = 'active'), '[]'::jsonb),
    'daily', jsonb_build_object(
       'amount', private.setting('daily_bonus_amount', '500'::jsonb),
       'claimedToday', exists (select 1 from public.daily_claims where user_id = me.id and claim_date = (now() at time zone tz)::date)),
    'rescue', private.rescue_info(me.id));
end $$;

-- ---------- 11. grants -------------------------------------------------------------------
revoke all on all functions in schema private from public, anon, authenticated, service_role;
revoke all on all tables in schema private from anon, authenticated, service_role;
revoke all on function public.rpc_dice_roll(bigint, integer, text, text), public.rpc_leaderboard(text),
  public.rpc_higher_lower_start(bigint, text), public.rpc_higher_lower_guess(uuid, text, text), public.rpc_higher_lower_cashout(uuid, text)
  from public, anon, service_role;
grant execute on function
  public.rpc_dice_roll(bigint, integer, text, text), public.rpc_leaderboard(text),
  public.rpc_higher_lower_start(bigint, text), public.rpc_higher_lower_guess(uuid, text, text), public.rpc_higher_lower_cashout(uuid, text),
  public.rpc_mines_start(bigint, int, text), public.rpc_mines_reveal(uuid, int, text), public.rpc_mines_cashout(uuid, text),
  public.rpc_crash_start(bigint, numeric, text), public.rpc_crash_status(uuid), public.rpc_crash_cashout(uuid, text),
  public.rpc_plinko_drop(bigint, text, text), public.rpc_horse_bet(jsonb, text), public.rpc_slots_spin(bigint, text),
  public.rpc_claim_rescue(), public.rpc_me()
to authenticated;
revoke execute on function public.rpc_mines_start(bigint, int, text), public.rpc_mines_reveal(uuid, int, text), public.rpc_mines_cashout(uuid, text),
  public.rpc_crash_start(bigint, numeric, text), public.rpc_crash_status(uuid), public.rpc_crash_cashout(uuid, text),
  public.rpc_plinko_drop(bigint, text, text), public.rpc_horse_bet(jsonb, text), public.rpc_slots_spin(bigint, text),
  public.rpc_claim_rescue() from public, anon, service_role;
notify pgrst, 'reload schema';
