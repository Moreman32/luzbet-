# LuzBet 2.0 Database Design

## Schemas
- `public`: client-readable safe data and controlled RPC surface.
- `private`: hidden casino state, seeds, rate limits, internal ledgers/helpers not exposed through Data API.
- `auth`: Supabase-managed identities.

## Core identity
### profiles
- id uuid PK references auth.users(id)
- username citext UNIQUE NOT NULL
- display_name text NOT NULL
- avatar text
- role enum/player_role NOT NULL
- status enum/account_status NOT NULL
- created_at timestamptz
- last_seen_at timestamptz

## Wallet
### wallets
- user_id uuid PK references profiles(id)
- balance bigint NOT NULL CHECK (balance >= 0)
- version bigint NOT NULL
- updated_at timestamptz

### wallet_transactions
- id uuid PK
- user_id uuid NOT NULL
- round_id uuid NULL
- type wallet_tx_type NOT NULL
- amount bigint NOT NULL
- balance_before bigint NOT NULL
- balance_after bigint NOT NULL
- idempotency_key text NULL
- metadata jsonb NOT NULL default '{}'
- created_at timestamptz NOT NULL
- CHECK(balance_after = balance_before + amount)
- UNIQUE(idempotency_key) WHERE idempotency_key IS NOT NULL

Wallet mutations occur only inside transactional database functions with row locks.

## Casino core
### game_definitions
Catalog of games.

### game_rule_versions
Immutable published versions. Active rounds pin one version forever.

### casino_rounds
- id uuid PK
- user_id uuid
- game_id
- rule_version_id
- bet bigint
- status
- payout bigint
- client_seed text nullable
- nonce bigint nullable
- created_at/finished_at
- UNIQUE user/idempotency protection as required

### casino_actions
Append-only action history for HIT/STAND/SPIN/CASHOUT/etc.

## Hidden state
Use `private` tables for:
- server seeds prior to reveal
- blackjack shoe/deck
- mines locations
- crash point commitments
- internal locks/rate limit counters

## Progression/economy
- achievements
- user_achievements UNIQUE(user_id, achievement_id)
- vip_levels
- user_progress
- daily_rewards
- cashback_claims

## Jackpot
- jackpots
- jackpot_cycles
- jackpot_transactions
- jackpot_winners

## Stats/social
- user_stats
- user_game_stats
- casino_stats_daily
- leaderboard_snapshots
- live_feed

## Admin/security
- admin_audit_log append-only
- security_events
- system_settings

## Legacy backup/cutover
Before destructive cutover, preserve:
1. full schema/functions/policies/triggers snapshot;
2. Edge Function source snapshot;
3. optional CSV/SQL archive of legacy tables;
4. current Git main commit SHA.
