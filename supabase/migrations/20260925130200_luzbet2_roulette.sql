-- =====================================================================
-- LuzBet 2.0 — European Roulette v1 (single atomic transaction per spin)
-- =====================================================================

create or replace function private.roulette_red() returns int[]
language sql immutable set search_path = '' as $$
  select array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]
$$;

-- Validates one bet and returns covered numbers + payout ratio (X:1). Returns covered = null when invalid.
create or replace function private.roulette_bet(p_bet jsonb, out covered int[], out ratio int, out amount bigint, out kind text)
language plpgsql immutable set search_path = '' as $$
declare n int[]; v text; a int; k int;
begin
  covered := null; ratio := null; amount := null;
  kind := p_bet ->> 't';
  if jsonb_typeof(p_bet) <> 'object' or (p_bet ->> 'a') is null or (p_bet ->> 'a') !~ '^[0-9]{1,9}$' then return; end if;
  amount := (p_bet ->> 'a')::bigint;
  if amount < 1 then covered := null; return; end if;

  if kind in ('straight','split','street','corner','sixline') then
    if jsonb_typeof(p_bet -> 'n') <> 'array' then return; end if;
    begin
      select array_agg(x::int order by x::int) into n from jsonb_array_elements_text(p_bet -> 'n') x;
    exception when others then return;
    end;
    if n is null or exists (select 1 from unnest(n) z where z < 0 or z > 36)
       or (select count(distinct z) from unnest(n) z) <> cardinality(n) then return; end if;
    a := n[1];
    if kind = 'straight' and cardinality(n) = 1 then
      covered := n; ratio := 35;
    elsif kind = 'split' and cardinality(n) = 2 then
      if (a = 0 and n[2] in (1,2,3))
         or (a >= 1 and n[2] = a + 3)
         or (a >= 1 and n[2] = a + 1 and a % 3 <> 0) then covered := n; ratio := 17; end if;
    elsif kind = 'street' and cardinality(n) = 3 then
      if (a >= 1 and a % 3 = 1 and n = array[a, a+1, a+2]) or n = array[0,1,2] or n = array[0,2,3] then
        covered := n; ratio := 11; end if;
    elsif kind = 'corner' and cardinality(n) = 4 then
      if n = array[0,1,2,3] or (a >= 1 and a % 3 <> 0 and a <= 32 and n = array[a, a+1, a+3, a+4]) then
        covered := n; ratio := 8; end if;
    elsif kind = 'sixline' and cardinality(n) = 6 then
      if a >= 1 and a % 3 = 1 and a <= 31 and n = array[a, a+1, a+2, a+3, a+4, a+5] then
        covered := n; ratio := 5; end if;
    end if;
    return;
  end if;

  v := p_bet ->> 'v';
  if kind = 'column' and v in ('1','2','3') then
    k := v::int; select array_agg(z order by z) into covered from generate_series(1,36) z where (z - k) % 3 = 0; ratio := 2;
  elsif kind = 'dozen' and v in ('1','2','3') then
    k := v::int; select array_agg(z) into covered from generate_series((k-1)*12+1, k*12) z; ratio := 2;
  elsif kind = 'color' and v in ('red','black') then
    select array_agg(z order by z) into covered from generate_series(1,36) z
     where (z = any(private.roulette_red())) = (v = 'red');
    ratio := 1;
  elsif kind = 'parity' and v in ('odd','even') then
    select array_agg(z order by z) into covered from generate_series(1,36) z where (z % 2 = 1) = (v = 'odd'); ratio := 1;
  elsif kind = 'half' and v in ('low','high') then
    select array_agg(z order by z) into covered from generate_series(case when v='low' then 1 else 19 end, case when v='low' then 18 else 36 end) z;
    ratio := 1;
  end if;
end $$;

-- Public RPC. p_bets = [{"t":"straight","n":[17],"a":100}, {"t":"color","v":"red","a":50}, ...]
create or replace function public.rpc_roulette_spin(p_bets jsonb, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles; rules jsonb; rv public.game_rule_versions; s public.fair_seeds; r public.casino_rounds;
  b jsonb; parsed record; total bigint := 0; nbets int; req_hash text; bal bigint;
  num int; win bigint := 0; lines jsonb := '[]'::jsonb; line_win bigint;
begin
  me := private.caller();
  if not private.valid_key(p_idempotency_key) then return private.err('invalid_idempotency_key'); end if;
  if jsonb_typeof(p_bets) <> 'array' then return private.err('invalid_bets'); end if;
  req_hash := encode(extensions.digest(p_bets::text, 'sha256'), 'hex');

  -- fast replay path
  select * into r from public.casino_rounds where user_id = me.id and idempotency_key = p_idempotency_key;
  if found then
    if r.request_hash <> req_hash or r.game_slug <> 'roulette' then
      perform private.log_event(me.id, 'idempotency_conflict', 'warn', jsonb_build_object('key', p_idempotency_key));
      return private.err('idempotency_conflict');
    end if;
    return jsonb_build_object('ok', true, 'replayed', true, 'round', private.round_public(r));
  end if;

  select * into rv from public.game_rule_versions where game_slug = 'roulette' and is_current;
  if not found or not exists (select 1 from public.game_definitions where slug = 'roulette' and status = 'enabled') then
    return private.err('game_unavailable');
  end if;
  rules := rv.rules;
  nbets := jsonb_array_length(p_bets);
  if nbets < 1 or nbets > (rules ->> 'maxPositions')::int then return private.err('invalid_bets'); end if;

  for b in select * from jsonb_array_elements(p_bets) loop
    select * into parsed from private.roulette_bet(b);
    if parsed.covered is null then
      perform private.log_event(me.id, 'invalid_bet_payload', 'info', jsonb_build_object('bet', b));
      return private.err('invalid_bets');
    end if;
    if parsed.amount < (rules ->> 'minBet')::bigint or parsed.amount > (rules ->> 'maxBetPerPosition')::bigint then
      return private.err('bet_limits', jsonb_build_object('min', rules -> 'minBet', 'maxPerPosition', rules -> 'maxBetPerPosition'));
    end if;
    total := total + parsed.amount;
  end loop;
  if total > (rules ->> 'maxTotalBet')::bigint then
    return private.err('bet_limits', jsonb_build_object('maxTotal', rules -> 'maxTotalBet'));
  end if;

  -- locks: seed -> wallet
  s := private.lock_seed(me.id);
  -- re-check idempotency under the seed lock (serialises same-key races)
  select * into r from public.casino_rounds where user_id = me.id and idempotency_key = p_idempotency_key;
  if found then
    if r.request_hash <> req_hash then return private.err('idempotency_conflict'); end if;
    return jsonb_build_object('ok', true, 'replayed', true, 'round', private.round_public(r));
  end if;
  select balance into bal from public.wallets where user_id = me.id for update;
  if bal < total then return private.err('insufficient_funds', jsonb_build_object('balance', bal)); end if;

  num := (private.fair_ints(private.secret_of(s.id), s.client_seed, s.next_nonce, array[37]))[1];

  for b in select * from jsonb_array_elements(p_bets) loop
    select * into parsed from private.roulette_bet(b);
    line_win := case when num = any(parsed.covered) then parsed.amount * (parsed.ratio + 1) else 0 end;
    win := win + line_win;
    lines := lines || jsonb_build_object('t', parsed.kind, 'n', to_jsonb(parsed.covered), 'a', parsed.amount,
                                         'ratio', parsed.ratio, 'win', line_win);
  end loop;

  insert into public.casino_rounds(user_id, game_slug, rule_version_id, status, bet_total, payout, seed_id, nonce,
                                   client_seed, server_seed_hash, idempotency_key, request_hash, request, state, finished_at)
  values (me.id, 'roulette', rv.id, 'active', total, 0, s.id, s.next_nonce, s.client_seed, s.server_seed_hash,
          p_idempotency_key, req_hash, p_bets, '{}'::jsonb, null)
  returning * into r;
  update public.fair_seeds set next_nonce = next_nonce + 1 where id = s.id;

  perform private.post_tx(me.id, -total, 'bet', 'bet:' || r.id, r.id, jsonb_build_object('game', 'roulette'));
  if win > 0 then
    perform private.post_tx(me.id, win, 'payout', 'payout:' || r.id, r.id, jsonb_build_object('game', 'roulette', 'number', num));
  end if;
  update public.casino_rounds
     set status = 'finished', payout = win, finished_at = now(),
         state = jsonb_build_object('number', num,
                                    'color', case when num = 0 then 'green' when num = any(private.roulette_red()) then 'red' else 'black' end,
                                    'lines', lines)
   where id = r.id returning * into r;
  insert into public.casino_actions(round_id, user_id, seq, action, idempotency_key, payload)
  values (r.id, me.id, 0, 'settle', p_idempotency_key, jsonb_build_object('number', num, 'payout', win));

  return jsonb_build_object('ok', true, 'replayed', false, 'round', private.round_public(r));
end $$;

-- Last winning numbers across the table (no user data), for the "recent numbers" strip.
create or replace function public.rpc_roulette_recent(p_limit int default 18)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.n order by x.finished_at desc), '[]'::jsonb)
    from (select (state ->> 'number')::int n, finished_at from public.casino_rounds
           where game_slug = 'roulette' and status = 'finished'
           order by finished_at desc limit least(greatest(p_limit, 1), 100)) x
$$;
