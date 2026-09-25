-- =====================================================================
-- LuzBet 2.0 — core schema (identity, wallet, ledger, fairness, casino core)
-- Replaces the empty 2026-09-25 v2 scaffolding (guarded: aborts if it holds data).
-- Legacy data in schema legacy_20260925 is NOT touched.
-- =====================================================================

-- ---------- 0. Guard + remove empty v2 scaffolding --------------------------
do $$
begin
  if to_regclass('public.wallet_transactions') is not null
     and exists (select 1 from public.wallet_transactions) then
    raise exception 'refusing to rebuild: public.wallet_transactions is not empty';
  end if;
  if to_regclass('public.profiles') is not null and exists (select 1 from public.profiles) then
    raise exception 'refusing to rebuild: public.profiles is not empty';
  end if;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists private.handle_new_user() cascade;
drop function if exists private.start_round(uuid,text,bigint,text,text) cascade;
drop function if exists private.prepare_round_secret(uuid,text,text,jsonb) cascade;
drop function if exists private.finish_roulette_round(uuid,uuid,integer,text,jsonb) cascade;
drop function if exists private.set_player_balance_adjustment(uuid,uuid,bigint,text,text) cascade;
drop function if exists private.post_wallet_transaction(uuid,bigint,public.wallet_transaction_type,text,uuid,jsonb) cascade;
drop function if exists private.check_login_rate_limit(text) cascade;
drop table if exists private.round_secrets, private.login_rate_limits cascade;
drop table if exists public.casino_actions, public.wallet_transactions, public.casino_rounds, public.wallets,
  public.game_rule_versions, public.game_definitions, public.admin_audit_log, public.security_events, public.profiles cascade;
drop type if exists public.wallet_transaction_type, public.round_status, public.game_status, public.app_role, public.account_status cascade;

-- ---------- 1. Deny-by-default for everything created from now on ------------
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated, public;
alter default privileges for role postgres in schema private revoke execute on functions from public;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

-- ---------- 2. Types --------------------------------------------------------
create type public.app_role as enum ('player','moderator','admin','owner');
create type public.account_status as enum ('active','disabled');
create type public.game_status as enum ('enabled','disabled');
create type public.round_status as enum ('active','finished','cancelled');
create type public.wallet_tx_type as enum
  ('opening','bet','payout','refund','bonus','cashback','jackpot','achievement','admin_adjustment');

-- ---------- 3. Identity -----------------------------------------------------
create table public.profiles (
  id                    uuid primary key references auth.users(id) on delete restrict,
  username              extensions.citext not null unique
                        check (username::text ~ '^[a-z0-9_]{3,24}$'),
  display_name          text not null
                        check (char_length(btrim(display_name)) between 1 and 32
                               and display_name !~ '[[:cntrl:]<>]'),
  avatar                text check (avatar is null or char_length(avatar) <= 16),
  role                  public.app_role not null default 'player',
  status                public.account_status not null default 'active',
  must_change_password  boolean not null default false,
  legacy_participant_id bigint unique,
  created_at            timestamptz not null default now(),
  last_seen_at          timestamptz
);

-- ---------- 4. Wallet + append-only ledger ---------------------------------
create table public.wallets (
  user_id    uuid primary key references public.profiles(id) on delete restrict,
  balance    bigint not null check (balance >= 0 and balance <= 1000000000000),
  version    bigint not null default 0 check (version >= 0),
  updated_at timestamptz not null default now()
);

create table public.game_definitions (
  slug       text primary key check (slug ~ '^[a-z0-9_]{2,32}$'),
  name       text not null,
  status     public.game_status not null default 'disabled',
  sort_order int not null default 100
);

create table public.game_rule_versions (
  id           text primary key check (id ~ '^[a-z0-9_]{3,64}$'),
  game_slug    text not null references public.game_definitions(slug) on delete restrict,
  version      int not null check (version > 0),
  rules        jsonb not null,
  is_current   boolean not null default false,
  published_at timestamptz not null default now(),
  unique (game_slug, version)
);
create unique index game_rule_versions_one_current on public.game_rule_versions(game_slug) where is_current;

-- Provably-fair seed pairs. The hash is committed (visible) BEFORE any bet uses the seed;
-- the seed itself stays in private.fair_seed_secrets until the player rotates the pair.
create table public.fair_seeds (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete restrict,
  server_seed_hash text not null check (server_seed_hash ~ '^[0-9a-f]{64}$'),
  client_seed      text not null check (char_length(client_seed) between 1 and 64 and client_seed !~ '[[:cntrl:]]'),
  next_nonce       bigint not null default 0 check (next_nonce >= 0),
  status           text not null default 'active' check (status in ('active','revealed')),
  server_seed      text check (server_seed is null or server_seed ~ '^[0-9a-f]{64}$'),
  created_at       timestamptz not null default now(),
  revealed_at      timestamptz,
  check ((status = 'active') = (server_seed is null)),
  check ((status = 'revealed') = (revealed_at is not null))
);
create unique index fair_seeds_one_active on public.fair_seeds(user_id) where status = 'active';
create index fair_seeds_user_idx on public.fair_seeds(user_id, created_at desc);

create table private.fair_seed_secrets (
  seed_id     uuid primary key references public.fair_seeds(id) on delete restrict,
  server_seed text not null check (server_seed ~ '^[0-9a-f]{64}$')
);

create table public.casino_rounds (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete restrict,
  game_slug        text not null references public.game_definitions(slug) on delete restrict,
  rule_version_id  text not null references public.game_rule_versions(id) on delete restrict,
  status           public.round_status not null default 'active',
  bet_total        bigint not null check (bet_total > 0 and bet_total <= 1000000000),
  payout           bigint not null default 0 check (payout >= 0),
  seed_id          uuid not null references public.fair_seeds(id) on delete restrict,
  nonce            bigint not null check (nonce >= 0),
  client_seed      text not null,
  server_seed_hash text not null,
  idempotency_key  text not null check (char_length(idempotency_key) between 8 and 128),
  request_hash     text not null,
  request          jsonb not null,
  state            jsonb not null default '{}'::jsonb,   -- ONLY public/visible state
  created_at       timestamptz not null default now(),
  finished_at      timestamptz,
  unique (user_id, idempotency_key),
  unique (seed_id, nonce),
  check ((status = 'active') = (finished_at is null))
);
create index casino_rounds_user_idx on public.casino_rounds(user_id, created_at desc);
create index casino_rounds_game_idx on public.casino_rounds(game_slug, created_at desc);
create unique index casino_rounds_one_active_bj on public.casino_rounds(user_id)
  where status = 'active' and game_slug = 'blackjack';

create table public.casino_actions (
  id              bigint generated always as identity primary key,
  round_id        uuid not null references public.casino_rounds(id) on delete restrict,
  user_id         uuid not null references public.profiles(id) on delete restrict,
  seq             int not null check (seq >= 0),
  action          text not null check (action in ('start','hit','stand','double','split','settle')),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  unique (round_id, idempotency_key),
  unique (round_id, seq)
);
create index casino_actions_user_idx on public.casino_actions(user_id);

create table public.wallet_transactions (
  id              bigint generated always as identity primary key,  -- strict order per user
  user_id         uuid not null references public.profiles(id) on delete restrict,
  round_id        uuid references public.casino_rounds(id) on delete restrict,
  type            public.wallet_tx_type not null,
  amount          bigint not null check (amount <> 0),
  balance_before  bigint not null check (balance_before >= 0),
  balance_after   bigint not null check (balance_after >= 0),
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  constraint wallet_tx_math check (balance_after = balance_before + amount),
  constraint wallet_tx_sign check (
    (type = 'bet' and amount < 0) or
    (type in ('opening','payout','refund','bonus','cashback','jackpot','achievement') and amount > 0) or
    (type = 'admin_adjustment'))
);
create index wallet_transactions_user_idx on public.wallet_transactions(user_id, id desc);
create index wallet_transactions_round_idx on public.wallet_transactions(round_id);

-- Hidden blackjack state (the shuffled shoe never leaves the database until the seed is revealed).
create table private.blackjack_games (
  round_id    uuid primary key references public.casino_rounds(id) on delete restrict,
  deck        smallint[] not null,
  pos         int not null,
  dealer      smallint[] not null,
  hands       jsonb not null,
  active_hand int not null default 0,
  phase       text not null check (phase in ('PLAYER_TURN','FINISHED'))
);

create table public.daily_claims (
  user_id    uuid not null references public.profiles(id) on delete restrict,
  claim_date date not null,
  amount     bigint not null check (amount > 0),
  created_at timestamptz not null default now(),
  primary key (user_id, claim_date)
);

create table public.system_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.admin_audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references public.profiles(id) on delete restrict,
  action     text not null,
  entity     text not null,
  entity_id  text,
  before     jsonb,
  after      jsonb,
  reason     text,
  created_at timestamptz not null default now()
);
create index admin_audit_log_created_idx on public.admin_audit_log(created_at desc);

create table public.security_events (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.profiles(id) on delete restrict,
  event_type text not null,
  severity   text not null default 'info' check (severity in ('info','warn','critical')),
  ip         text,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index security_events_created_idx on public.security_events(created_at desc);
create index security_events_user_idx on public.security_events(user_id);

create table private.login_attempts (
  key               text primary key,
  attempts          int not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until     timestamptz
);

-- ---------- 5. Immutability / write guards ---------------------------------
create or replace function private.forbid_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'immutable_table: % on %', tg_op, tg_table_name;
end $$;

create trigger wallet_tx_no_update before update or delete on public.wallet_transactions
  for each row execute function private.forbid_mutation();
create trigger wallet_tx_no_truncate before truncate on public.wallet_transactions
  for each statement execute function private.forbid_mutation();
create trigger audit_no_update before update or delete on public.admin_audit_log
  for each row execute function private.forbid_mutation();
create trigger audit_no_truncate before truncate on public.admin_audit_log
  for each statement execute function private.forbid_mutation();
create trigger rules_no_update before update of rules, game_slug, version, id or delete on public.game_rule_versions
  for each row execute function private.forbid_mutation();
create trigger actions_no_update before update or delete on public.casino_actions
  for each row execute function private.forbid_mutation();

-- wallets may only change inside private.post_tx (which sets a tx-local flag)
create or replace function private.guard_wallet_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('luzbet.ledger_write', true), '') <> 'on' then
    raise exception 'wallet_write_outside_ledger';
  end if;
  return coalesce(new, old);
end $$;
create trigger wallets_guard before insert or update or delete on public.wallets
  for each row execute function private.guard_wallet_write();

-- finished rounds are frozen
create or replace function private.guard_round_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'rounds_are_append_only'; end if;
  if old.status <> 'active' then raise exception 'round_is_final'; end if;
  if new.user_id <> old.user_id or new.seed_id <> old.seed_id or new.nonce <> old.nonce
     or new.game_slug <> old.game_slug or new.rule_version_id <> old.rule_version_id
     or new.server_seed_hash <> old.server_seed_hash or new.client_seed <> old.client_seed
     or new.idempotency_key <> old.idempotency_key or new.request_hash <> old.request_hash then
    raise exception 'round_identity_is_immutable';
  end if;
  return new;
end $$;
create trigger casino_rounds_guard before update or delete on public.casino_rounds
  for each row execute function private.guard_round_update();

-- revealed seeds are frozen; active seeds may only advance nonce or be revealed
create or replace function private.guard_seed_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'seeds_are_append_only'; end if;
  if old.status = 'revealed' then raise exception 'seed_is_final'; end if;
  if new.server_seed_hash <> old.server_seed_hash or new.client_seed <> old.client_seed
     or new.user_id <> old.user_id or new.next_nonce < old.next_nonce then
    raise exception 'seed_commitment_is_immutable';
  end if;
  if new.status = 'revealed' and
     encode(extensions.digest(new.server_seed, 'sha256'), 'hex') <> old.server_seed_hash then
    raise exception 'reveal_does_not_match_commitment';
  end if;
  return new;
end $$;
create trigger fair_seeds_guard before update or delete on public.fair_seeds
  for each row execute function private.guard_seed_update();
create trigger fair_secrets_no_update before update or delete on private.fair_seed_secrets
  for each row execute function private.forbid_mutation();
