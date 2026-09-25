-- =====================================================================
-- LuzBet 2.0 — API surface (player / staff / service), RLS, grants, seed data, legacy cleanup
-- =====================================================================

-- ---------- player ------------------------------------------------------------
create or replace function public.rpc_me() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; s public.fair_seeds; tz text := 'Europe/Nicosia';
begin
  me := private.caller();
  update public.profiles set last_seen_at = now() where id = me.id and (last_seen_at is null or last_seen_at < now() - interval '1 minute');
  select * into s from public.fair_seeds where user_id = me.id and status = 'active';
  if not found then s := private.new_seed(me.id); end if;
  return jsonb_build_object(
    'id', me.id, 'username', me.username, 'displayName', me.display_name, 'avatar', me.avatar,
    'role', me.role, 'mustChangePassword', me.must_change_password,
    'mfaRequired', me.role in ('admin','owner') and (private.setting('admin_mfa_required','true'::jsonb))::boolean,
    'aal', coalesce(auth.jwt() ->> 'aal', 'aal1'),
    'balance', (select balance from public.wallets where user_id = me.id),
    'seed', jsonb_build_object('id', s.id, 'serverSeedHash', s.server_seed_hash, 'clientSeed', s.client_seed, 'nextNonce', s.next_nonce),
    'activeRounds', coalesce((select jsonb_agg(private.round_public(r)) from public.casino_rounds r where r.user_id = me.id and r.status = 'active'), '[]'::jsonb),
    'daily', jsonb_build_object(
       'amount', private.setting('daily_bonus_amount', '500'::jsonb),
       'claimedToday', exists (select 1 from public.daily_claims where user_id = me.id and claim_date = (now() at time zone tz)::date))
  );
end $$;

create or replace function public.rpc_rotate_seed(p_new_client_seed text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; s public.fair_seeds; n public.fair_seeds; cs text := nullif(btrim(p_new_client_seed), '');
begin
  me := private.caller();
  if cs is not null and (char_length(cs) > 64 or cs ~ '[[:cntrl:]]') then return private.err('invalid_client_seed'); end if;
  s := private.lock_seed(me.id);
  if exists (select 1 from public.casino_rounds where seed_id = s.id and status = 'active') then
    return private.err('round_in_progress');
  end if;
  update public.fair_seeds set status = 'revealed', server_seed = private.secret_of(s.id), revealed_at = now()
   where id = s.id returning * into s;
  n := private.new_seed(me.id, cs);
  return jsonb_build_object('ok', true,
    'revealed', jsonb_build_object('id', s.id, 'serverSeed', s.server_seed, 'serverSeedHash', s.server_seed_hash,
                                   'clientSeed', s.client_seed, 'nonces', s.next_nonce),
    'seed', jsonb_build_object('id', n.id, 'serverSeedHash', n.server_seed_hash, 'clientSeed', n.client_seed, 'nextNonce', n.next_nonce));
end $$;

create or replace function public.rpc_claim_daily() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; d date := (now() at time zone 'Europe/Nicosia')::date; amt bigint; tx public.wallet_transactions;
begin
  me := private.caller();
  amt := (private.setting('daily_bonus_amount', '500'::jsonb))::bigint;
  perform 1 from public.wallets where user_id = me.id for update;
  if exists (select 1 from public.daily_claims where user_id = me.id and claim_date = d) then
    return private.err('already_claimed');
  end if;
  insert into public.daily_claims(user_id, claim_date, amount) values (me.id, d, amt);
  tx := private.post_tx(me.id, amt, 'bonus', 'daily:' || me.id || ':' || d, null, jsonb_build_object('kind', 'daily'));
  return jsonb_build_object('ok', true, 'amount', amt, 'balance', tx.balance_after);
end $$;

create or replace function public.rpc_mark_password_changed() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me public.profiles;
begin
  me := private.caller();
  update public.profiles set must_change_password = false where id = me.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.rpc_set_display_name(p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; v text := btrim(p_name);
begin
  me := private.caller();
  if v is null or char_length(v) not between 1 and 32 or v ~ '[[:cntrl:]<>]' then return private.err('invalid_display_name'); end if;
  update public.profiles set display_name = v where id = me.id;
  return jsonb_build_object('ok', true, 'displayName', v);
end $$;

create or replace function public.rpc_my_stats(p_period text default 'all') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles; since timestamptz;
begin
  me := private.caller();
  since := case p_period when 'today' then date_trunc('day', now() at time zone 'Europe/Nicosia') at time zone 'Europe/Nicosia'
                         when '7d' then now() - interval '7 days' when '30d' then now() - interval '30 days' else '-infinity' end;
  return (
    select jsonb_build_object(
      'rounds', count(*), 'wagered', coalesce(sum(bet_total), 0), 'won', coalesce(sum(payout), 0),
      'net', coalesce(sum(payout - bet_total), 0),
      'observedRtp', case when sum(bet_total) > 0 then round(sum(payout)::numeric / sum(bet_total) * 100, 2) end,
      'winRate', case when count(*) > 0 then round(count(*) filter (where payout > bet_total)::numeric / count(*) * 100, 1) end,
      'biggestWin', coalesce(max(payout - bet_total) filter (where payout > bet_total), 0),
      'biggestMultiplier', coalesce(max(round(payout::numeric / bet_total, 2)), 0),
      'favoriteGame', (select game_slug from public.casino_rounds where user_id = me.id and status = 'finished' and created_at >= since
                        group by 1 order by count(*) desc limit 1))
    from public.casino_rounds where user_id = me.id and status = 'finished' and created_at >= since);
end $$;

-- ---------- staff ---------------------------------------------------------------
create or replace function public.rpc_admin_whoami() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles;
begin
  p := private.require_staff('admin');
  return jsonb_build_object('ok', true, 'id', p.id, 'role', p.role);
end $$;

create or replace function public.rpc_admin_players() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff('admin');
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'username', p.username, 'displayName', p.display_name, 'role', p.role, 'status', p.status,
      'balance', w.balance, 'lastSeenAt', p.last_seen_at, 'createdAt', p.created_at,
      'rounds', (select count(*) from public.casino_rounds r where r.user_id = p.id),
      'net', (select coalesce(sum(payout - bet_total), 0) from public.casino_rounds r where r.user_id = p.id and r.status = 'finished'))
      order by p.display_name) from public.profiles p join public.wallets w on w.user_id = p.id), '[]'::jsonb);
end $$;

create or replace function public.rpc_admin_player_detail(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff('admin');
  return jsonb_build_object(
    'ledger', coalesce((select jsonb_agg(to_jsonb(t) order by t.id desc) from
                 (select id, type, amount, balance_before, balance_after, round_id, metadata, created_at
                    from public.wallet_transactions where user_id = p_user order by id desc limit 100) t), '[]'::jsonb),
    'rounds', coalesce((select jsonb_agg(private.round_public(r) order by r.created_at desc) from
                 (select * from public.casino_rounds where user_id = p_user order by created_at desc limit 50) r), '[]'::jsonb));
end $$;

create or replace function public.rpc_admin_adjust_balance(p_user uuid, p_amount bigint, p_reason text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.profiles; target public.profiles; w_before bigint; tx public.wallet_transactions; limit_ bigint;
begin
  actor := private.require_staff('admin');
  if not private.valid_key(p_idempotency_key) then return private.err('invalid_idempotency_key'); end if;
  select * into target from public.profiles where id = p_user;
  if not found then return private.err('player_not_found'); end if;
  if target.id = actor.id and actor.role <> 'owner' then return private.err('self_adjustment_forbidden'); end if;
  limit_ := (private.setting('admin_adjust_max', '1000000'::jsonb))::bigint;
  if p_amount is null or p_amount = 0 or abs(p_amount) > limit_ then return private.err('invalid_amount'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then return private.err('reason_required'); end if;
  if exists (select 1 from public.wallet_transactions where idempotency_key = 'admin:' || p_idempotency_key) then
    return jsonb_build_object('ok', true, 'replayed', true);
  end if;
  select balance into w_before from public.wallets where user_id = p_user for update;
  if w_before + p_amount < 0 then return private.err('insufficient_funds', jsonb_build_object('balance', w_before)); end if;
  tx := private.post_tx(p_user, p_amount, 'admin_adjustment', 'admin:' || p_idempotency_key, null,
                        jsonb_build_object('actor', actor.id, 'reason', btrim(p_reason)));
  insert into public.admin_audit_log(actor_id, action, entity, entity_id, before, after, reason)
  values (actor.id, 'wallet_adjustment', 'wallet', p_user::text,
          jsonb_build_object('balance', tx.balance_before), jsonb_build_object('balance', tx.balance_after, 'tx', tx.id),
          btrim(p_reason));
  return jsonb_build_object('ok', true, 'balance', tx.balance_after);
end $$;

-- status change in DB; the Edge Function additionally bans/unbans the Auth user
create or replace function public.rpc_admin_set_status(p_user uuid, p_status public.account_status, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.profiles; target public.profiles;
begin
  actor := private.require_staff('admin');
  select * into target from public.profiles where id = p_user for update;
  if not found then return private.err('player_not_found'); end if;
  if target.id = actor.id then return private.err('self_status_forbidden'); end if;
  if target.role = 'owner' or (target.role = 'admin' and actor.role <> 'owner') then return private.err('forbidden'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then return private.err('reason_required'); end if;
  update public.profiles set status = p_status where id = p_user;
  insert into public.admin_audit_log(actor_id, action, entity, entity_id, before, after, reason)
  values (actor.id, 'set_status', 'profile', p_user::text, jsonb_build_object('status', target.status),
          jsonb_build_object('status', p_status), btrim(p_reason));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.rpc_admin_set_role(p_user uuid, p_role public.app_role, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.profiles; target public.profiles;
begin
  actor := private.require_staff('owner');
  select * into target from public.profiles where id = p_user for update;
  if not found then return private.err('player_not_found'); end if;
  if target.id = actor.id or p_role = 'owner' then return private.err('forbidden'); end if;
  update public.profiles set role = p_role where id = p_user;
  insert into public.admin_audit_log(actor_id, action, entity, entity_id, before, after, reason)
  values (actor.id, 'set_role', 'profile', p_user::text, jsonb_build_object('role', target.role),
          jsonb_build_object('role', p_role), btrim(coalesce(p_reason, '')));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.rpc_admin_audit(p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff('admin');
  return coalesce((select jsonb_agg(x order by x.id desc) from (
    select a.id, a.action, a.entity, a.entity_id, a.before, a.after, a.reason, a.created_at,
           p.username as actor, t.username as target
      from public.admin_audit_log a
      left join public.profiles p on p.id = a.actor_id
      left join public.profiles t on a.entity in ('wallet','profile') and t.id::text = a.entity_id
     order by a.id desc limit least(greatest(p_limit, 1), 500)) x), '[]'::jsonb);
end $$;

create or replace function public.rpc_admin_security_events(p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff('admin');
  return coalesce((select jsonb_agg(x order by x.id desc) from (
    select e.id, e.event_type, e.severity, e.ip, e.metadata, e.created_at, p.username
      from public.security_events e left join public.profiles p on p.id = e.user_id
     order by e.id desc limit least(greatest(p_limit, 1), 500)) x), '[]'::jsonb);
end $$;

create or replace function public.rpc_admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff('admin');
  return jsonb_build_object(
    'players', (select count(*) from public.profiles),
    'activePlayers7d', (select count(*) from public.profiles where last_seen_at > now() - interval '7 days'),
    'totalBalance', (select coalesce(sum(balance), 0) from public.wallets),
    'rounds24h', (select count(*) from public.casino_rounds where created_at > now() - interval '24 hours'),
    'casinoNet', (select coalesce(sum(bet_total - payout), 0) from public.casino_rounds where status = 'finished'),
    'byGame', coalesce((select jsonb_object_agg(game_slug, jsonb_build_object('rounds', n, 'wagered', w, 'paid', p,
                 'observedRtp', case when w > 0 then round(p::numeric / w * 100, 2) end))
               from (select game_slug, count(*) n, sum(bet_total) w, sum(payout) p from public.casino_rounds where status = 'finished' group by 1) g), '{}'::jsonb),
    'securityEvents24h', (select count(*) from public.security_events where created_at > now() - interval '24 hours'));
end $$;

-- ---------- service (Edge Functions only; EXECUTE granted to service_role) -----
create or replace function public.svc_login_lookup(p_username text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('userId', p.id, 'email', u.email, 'status', p.status)
    from public.profiles p join auth.users u on u.id = p.id
   where p.username = lower(btrim(p_username))::extensions.citext
$$;

-- Returns true if the attempt may proceed. Keys: pair (username+ip), ip, username (loose global cap).
create or replace function public.svc_login_attempt(p_username text, p_ip text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare k text; lim int; ok boolean := true; r private.login_attempts;
begin
  foreach k in array array['pair:' || lower(p_username) || '|' || coalesce(p_ip, '?'), 'ip:' || coalesce(p_ip, '?'), 'user:' || lower(p_username)] loop
    lim := case when k like 'pair:%' then 8 when k like 'ip:%' then 40 else 60 end;
    insert into private.login_attempts(key) values (k) on conflict do nothing;
    select * into r from private.login_attempts where key = k for update;
    if r.blocked_until is not null and r.blocked_until > now() then ok := false; continue; end if;
    if r.window_started_at < now() - interval '15 minutes' then
      update private.login_attempts set attempts = 1, window_started_at = now(), blocked_until = null where key = k;
    elsif r.attempts + 1 > lim then
      update private.login_attempts set attempts = attempts + 1, blocked_until = now() + interval '15 minutes' where key = k;
      ok := false;
    else
      update private.login_attempts set attempts = attempts + 1 where key = k;
    end if;
  end loop;
  delete from private.login_attempts where window_started_at < now() - interval '1 day' and (blocked_until is null or blocked_until < now());
  return ok;
end $$;

create or replace function public.svc_login_result(p_username text, p_ip text, p_success boolean, p_user uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_success then
    delete from private.login_attempts where key = 'pair:' || lower(p_username) || '|' || coalesce(p_ip, '?');
    update public.profiles set last_seen_at = now() where id = p_user;
  else
    perform private.log_event(p_user, 'login_failed', 'info', jsonb_build_object('username', left(p_username, 32)), p_ip);
  end if;
end $$;

create or replace function public.svc_security_event(p_user uuid, p_type text, p_severity text, p_meta jsonb, p_ip text) returns void
language sql security definer set search_path = '' as $$
  select private.log_event(p_user, left(p_type, 64), p_severity, p_meta, p_ip)
$$;

-- Creates profile + wallet + opening transaction + first seed for an Auth user created by v2-admin.
create or replace function public.svc_create_profile(p_actor uuid, p_user uuid, p_username text, p_display_name text,
                                                     p_role public.app_role default 'player', p_opening bigint default 1000,
                                                     p_legacy_id bigint default null, p_must_change boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
  insert into public.profiles(id, username, display_name, role, must_change_password, legacy_participant_id)
  values (p_user, lower(btrim(p_username)), btrim(p_display_name), p_role, p_must_change, p_legacy_id)
  returning * into p;
  perform set_config('luzbet.ledger_write', 'on', true);
  insert into public.wallets(user_id, balance) values (p_user, 0);
  perform set_config('luzbet.ledger_write', 'off', true);
  if p_opening > 0 then
    perform private.post_tx(p_user, p_opening, 'opening', 'opening:' || p_user, null,
                            jsonb_build_object('source', case when p_legacy_id is null then 'admin' else 'legacy_migration' end,
                                               'legacyParticipantId', p_legacy_id));
  end if;
  perform private.new_seed(p_user);
  insert into public.admin_audit_log(actor_id, action, entity, entity_id, after, reason)
  values (p_actor, 'create_player', 'profile', p_user::text,
          jsonb_build_object('username', p.username, 'displayName', p.display_name, 'role', p.role, 'opening', p_opening), null);
  return jsonb_build_object('ok', true, 'id', p.id, 'username', p.username);
end $$;

-- ---------- RLS -------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.game_definitions enable row level security;
alter table public.game_rule_versions enable row level security;
alter table public.fair_seeds enable row level security;
alter table public.casino_rounds enable row level security;
alter table public.casino_actions enable row level security;
alter table public.daily_claims enable row level security;
alter table public.system_settings enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.security_events enable row level security;
alter table private.fair_seed_secrets enable row level security;
alter table private.blackjack_games enable row level security;
alter table private.login_attempts enable row level security;

create policy profiles_self on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy wallets_self on public.wallets for select to authenticated using ((select auth.uid()) = user_id);
create policy wallet_tx_self on public.wallet_transactions for select to authenticated using ((select auth.uid()) = user_id);
create policy games_read on public.game_definitions for select to authenticated using (true);
create policy rules_read on public.game_rule_versions for select to authenticated using (true);
create policy seeds_self on public.fair_seeds for select to authenticated using ((select auth.uid()) = user_id);
create policy rounds_self on public.casino_rounds for select to authenticated using ((select auth.uid()) = user_id);
create policy actions_self on public.casino_actions for select to authenticated using ((select auth.uid()) = user_id);
create policy daily_self on public.daily_claims for select to authenticated using ((select auth.uid()) = user_id);

-- ---------- grants (explicit; defaults already revoked) -----------------------------
revoke all on all tables in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;
revoke all on all functions in schema public from public, anon, authenticated, service_role;
revoke all on all tables in schema private from anon, authenticated, service_role;
revoke all on all functions in schema private from public, anon, authenticated, service_role;

grant select on public.profiles, public.wallets, public.wallet_transactions, public.game_definitions,
  public.game_rule_versions, public.fair_seeds, public.casino_rounds, public.casino_actions, public.daily_claims to authenticated;

grant execute on function
  public.rpc_me(), public.rpc_rotate_seed(text), public.rpc_claim_daily(), public.rpc_mark_password_changed(),
  public.rpc_set_display_name(text), public.rpc_my_stats(text),
  public.rpc_roulette_spin(jsonb, text), public.rpc_roulette_recent(int),
  public.rpc_blackjack_start(bigint, text), public.rpc_blackjack_action(uuid, text, text),
  public.rpc_admin_whoami(), public.rpc_admin_players(), public.rpc_admin_player_detail(uuid),
  public.rpc_admin_adjust_balance(uuid, bigint, text, text), public.rpc_admin_set_status(uuid, public.account_status, text),
  public.rpc_admin_set_role(uuid, public.app_role, text), public.rpc_admin_audit(int), public.rpc_admin_security_events(int),
  public.rpc_admin_overview()
to authenticated;

grant execute on function
  public.svc_login_lookup(text), public.svc_login_attempt(text, text), public.svc_login_result(text, text, boolean, uuid),
  public.svc_security_event(uuid, text, text, jsonb, text),
  public.svc_create_profile(uuid, uuid, text, text, public.app_role, bigint, bigint, boolean)
to service_role;

-- ---------- seed data -----------------------------------------------------------------
insert into public.game_definitions(slug, name, status, sort_order) values
  ('roulette', 'European Roulette', 'enabled', 10),
  ('blackjack', 'Blackjack', 'enabled', 20),
  ('businka_slots', 'Businka''s Fortune', 'disabled', 30),
  ('crash', 'Crash', 'disabled', 40),
  ('mines', 'Mines', 'disabled', 50),
  ('plinko', 'Plinko', 'disabled', 60),
  ('dice', 'Dice', 'disabled', 70),
  ('horse', 'Скачки', 'disabled', 80);

insert into public.game_rule_versions(id, game_slug, version, is_current, rules) values
 ('roulette_european_v1', 'roulette', 1, true, '{
   "wheel":"european","numbers":37,"minBet":1,"maxBetPerPosition":5000,"maxTotalBet":10000,"maxPositions":60,
   "payouts":{"straight":35,"split":17,"street":11,"corner":8,"sixline":5,"column":2,"dozen":2,"color":1,"parity":1,"half":1},
   "notes":"Trio (0-1-2, 0-2-3) is a street, first four (0-1-2-3) is a corner. Zero loses all outside bets. No la partage.",
   "rng":"HMAC_SHA256(key=serverSeed, msg=clientSeed:nonce:cursor) -> uint32 BE, rejection sampling, result = u mod 37"}'::jsonb),
 ('blackjack_standard_v1', 'blackjack', 1, true, '{
   "decks":6,"freshShoeEachRound":true,"dealerStandsSoft17":true,"dealerPeek":true,"blackjackPays":"3:2 (rounded down)",
   "doubleOn":"any first two cards","doubleAfterSplit":true,"maxSplits":1,"splitTenValueCards":true,"splitAcesOneCard":true,
   "insurance":false,"surrender":false,"minBet":1,"maxBet":5000,
   "rng":"Fisher-Yates over 312 cards, j = fairInt(i+1) for i = 311..1 from the HMAC stream; card c: rank = c%13+1, suit = floor(c/13)%4",
   "deal":"player, dealer(up), player, dealer(hole), then shoe order"}'::jsonb);

insert into public.system_settings(key, value) values
  ('admin_mfa_required', 'true'), ('daily_bonus_amount', '500'), ('admin_adjust_max', '1000000');

-- ---------- legacy cleanup (non-destructive) --------------------------------------------
-- PostgREST pre-request hook pointed at a function that moved to legacy_20260925.
alter role authenticator reset pgrst.db_pre_request;
do $$ begin
  if exists (select 1 from cron.job where command ilike '%refresh_rating_snapshots%') then
    perform cron.unschedule(jobid) from cron.job where command ilike '%refresh_rating_snapshots%';
  end if;
end $$;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
