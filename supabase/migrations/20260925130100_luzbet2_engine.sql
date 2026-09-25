-- =====================================================================
-- LuzBet 2.0 — internal engine: ledger, seeds, provably-fair RNG, helpers
-- Everything here lives in schema `private` (not exposed, no API role has USAGE).
-- =====================================================================

-- ---------- errors / events --------------------------------------------------
create or replace function private.err(p_code text, p_extra jsonb default '{}'::jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('ok', false, 'error', p_code) || coalesce(p_extra, '{}'::jsonb)
$$;

create or replace function private.log_event(p_user uuid, p_type text, p_severity text, p_meta jsonb default '{}'::jsonb, p_ip text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.security_events(user_id, event_type, severity, ip, metadata)
  values (p_user, p_type, p_severity, p_ip, coalesce(p_meta, '{}'::jsonb));
$$;

-- ---------- caller identity --------------------------------------------------
create or replace function private.caller() returns public.profiles
language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into p from public.profiles where id = auth.uid();
  if not found then raise exception 'no_profile' using errcode = '28000'; end if;
  if p.status <> 'active' then raise exception 'account_disabled' using errcode = '28000'; end if;
  return p;
end $$;

create or replace function private.setting(p_key text, p_default jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select value from public.system_settings where key = p_key), p_default)
$$;

-- admin gate: role + active + MFA (aal2) unless explicitly disabled in system_settings
create or replace function private.require_staff(p_min public.app_role default 'admin') returns public.profiles
language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles; rank_have int; rank_need int;
begin
  p := private.caller();
  rank_have := array_position(array['player','moderator','admin','owner']::text[], p.role::text);
  rank_need := array_position(array['player','moderator','admin','owner']::text[], p_min::text);
  if rank_have is null or rank_have < rank_need then raise exception 'forbidden' using errcode = '42501'; end if;
  if (private.setting('admin_mfa_required', 'true'::jsonb))::boolean
     and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'mfa_required' using errcode = '42501';
  end if;
  return p;
end $$;

-- ---------- ledger -----------------------------------------------------------
-- The ONLY code path that changes a balance. Caller must already hold (or will take) the wallet lock.
create or replace function private.post_tx(
  p_user uuid, p_amount bigint, p_type public.wallet_tx_type, p_key text,
  p_round uuid default null, p_meta jsonb default '{}'::jsonb)
returns public.wallet_transactions
language plpgsql security definer set search_path = '' as $$
declare w public.wallets; tx public.wallet_transactions;
begin
  if p_amount is null or p_amount = 0 then raise exception 'amount_must_not_be_zero'; end if;
  select * into tx from public.wallet_transactions where idempotency_key = p_key;
  if found then
    if tx.user_id <> p_user or tx.amount <> p_amount or tx.type <> p_type or tx.round_id is distinct from p_round then
      raise exception 'ledger_idempotency_conflict';
    end if;
    return tx;
  end if;
  select * into w from public.wallets where user_id = p_user for update;
  if not found then raise exception 'wallet_not_found'; end if;
  if w.balance + p_amount < 0 then raise exception 'insufficient_funds' using errcode = 'P0001'; end if;
  perform set_config('luzbet.ledger_write', 'on', true);
  update public.wallets set balance = w.balance + p_amount, version = version + 1, updated_at = now()
   where user_id = p_user;
  perform set_config('luzbet.ledger_write', 'off', true);
  insert into public.wallet_transactions(user_id, round_id, type, amount, balance_before, balance_after, idempotency_key, metadata)
  values (p_user, p_round, p_type, p_amount, w.balance, w.balance + p_amount, p_key, coalesce(p_meta, '{}'::jsonb))
  returning * into tx;
  return tx;
end $$;

-- ---------- seeds ------------------------------------------------------------
create or replace function private.new_seed(p_user uuid, p_client_seed text default null) returns public.fair_seeds
language plpgsql security definer set search_path = '' as $$
declare s public.fair_seeds; ss text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into public.fair_seeds(user_id, server_seed_hash, client_seed)
  values (p_user, encode(extensions.digest(ss, 'sha256'), 'hex'),
          coalesce(nullif(btrim(p_client_seed), ''), encode(extensions.gen_random_bytes(8), 'hex')))
  returning * into s;
  insert into private.fair_seed_secrets(seed_id, server_seed) values (s.id, ss);
  return s;
end $$;

-- Locks the caller's active seed row and allocates the next nonce. Seed lock is ALWAYS taken before the wallet lock.
create or replace function private.lock_seed(p_user uuid) returns public.fair_seeds
language plpgsql security definer set search_path = '' as $$
declare s public.fair_seeds;
begin
  select * into s from public.fair_seeds where user_id = p_user and status = 'active' for update;
  if not found then
    s := private.new_seed(p_user);
    select * into s from public.fair_seeds where id = s.id for update;
  end if;
  return s;
end $$;

-- ---------- provably-fair RNG -----------------------------------------------
-- block(cursor) = HMAC_SHA256(key = serverSeed(hex string, UTF-8), msg = clientSeed || ':' || nonce || ':' || cursor)
-- Stream of big-endian uint32 words, 8 per block. Uniform ints in [0,m) by rejection sampling:
--   accept u if u < floor(2^32 / m) * m, result = u mod m.
-- For a list of moduli the draws are consumed sequentially from the same stream.
create or replace function private.fair_ints(p_server_seed text, p_client_seed text, p_nonce bigint, p_moduli int[])
returns int[] language plpgsql immutable set search_path = '' as $$
declare
  out_ int[] := '{}';
  blk bytea; cur int := 0; off int := 32;
  m int; u bigint; lim bigint;
  two32 constant bigint := 4294967296;
begin
  foreach m in array p_moduli loop
    if m < 1 then raise exception 'bad_modulus'; end if;
    lim := (two32 / m) * m;
    loop
      if off >= 32 then
        blk := extensions.hmac(convert_to(p_client_seed || ':' || p_nonce::text || ':' || cur::text, 'UTF8'),
                               convert_to(p_server_seed, 'UTF8'), 'sha256');
        cur := cur + 1; off := 0;
      end if;
      u := (get_byte(blk, off)::bigint << 24) | (get_byte(blk, off+1)::bigint << 16)
         | (get_byte(blk, off+2)::bigint << 8) | get_byte(blk, off+3)::bigint;
      off := off + 4;
      exit when u < lim;
    end loop;
    out_ := out_ || (u % m)::int;
  end loop;
  return out_;
end $$;

create or replace function private.secret_of(p_seed uuid) returns text
language sql stable security definer set search_path = '' as $$
  select server_seed from private.fair_seed_secrets where seed_id = p_seed
$$;

-- ---------- idempotency helpers ----------------------------------------------
create or replace function private.valid_key(p_key text) returns boolean
language sql immutable set search_path = '' as $$
  select p_key is not null and p_key ~ '^[A-Za-z0-9_\-:.]{8,128}$'
$$;

create or replace function private.round_public(r public.casino_rounds) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'game', r.game_slug, 'rules', r.rule_version_id, 'status', r.status,
    'bet', r.bet_total, 'payout', r.payout, 'state', r.state,
    'seedId', r.seed_id, 'nonce', r.nonce, 'clientSeed', r.client_seed, 'serverSeedHash', r.server_seed_hash,
    'createdAt', r.created_at, 'finishedAt', r.finished_at,
    'balance', (select balance from public.wallets where user_id = r.user_id))
$$;
