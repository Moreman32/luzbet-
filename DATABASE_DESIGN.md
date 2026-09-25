# LuzBet 2.0 — Database Design (as implemented)

Source of truth: `supabase/migrations/20260925130*.sql`.

## Schemas
| schema | purpose | API access |
|---|---|---|
| `public` | client-readable tables (RLS: own rows only) + RPC API | `authenticated`: SELECT on player tables, EXECUTE on `rpc_*`; `anon`: nothing |
| `private` | secrets and engine: seed secrets, blackjack shoes, login throttling, internal functions | none (no USAGE) |
| `legacy_20260925` | LuzBet 1.0 archive | none |

## Tables
| table | key constraints | notes |
|---|---|---|
| profiles | PK→auth.users, username citext UNIQUE `^[a-z0-9_]{3,24}$`, display_name 1–32 no `<>`/control | role player/moderator/admin/owner, status active/disabled |
| wallets | PK user, `0 ≤ balance ≤ 1e12` | writes only inside `private.post_tx` (trigger guard) |
| wallet_transactions | identity PK (strict order), `balance_after = balance_before + amount`, both ≥ 0, sign per type, idempotency_key UNIQUE NOT NULL | UPDATE/DELETE/TRUNCATE blocked by triggers, no grants |
| game_definitions / game_rule_versions | rule versions immutable (trigger), one `is_current` per game | rounds pin `rule_version_id` |
| fair_seeds | one active per user, hash `^[0-9a-f]{64}$`, seed NULL until revealed, reveal must hash to commitment (trigger) | nonce only grows |
| private.fair_seed_secrets | seed_id PK | never exposed until rotation |
| casino_rounds | UNIQUE (user_id, idempotency_key), UNIQUE (seed_id, nonce), one active blackjack per user, finished rounds frozen (trigger) | `request` = what the player sent, `state` = public outcome |
| casino_actions | UNIQUE (round_id, idempotency_key), UNIQUE (round_id, seq), append-only | |
| private.blackjack_games | shoe, position, dealer, hands | hidden state |
| daily_claims | PK (user_id, claim_date) | Europe/Nicosia day |
| admin_audit_log | append-only | before/after/reason/actor |
| security_events | | written by DB functions and Edge Functions |
| system_settings | | `admin_mfa_required`, `daily_bonus_amount`, `admin_adjust_max` |

## Integrity invariants (all must return 0)
```sql
select count(*) from wallets w where balance <> (select coalesce(sum(amount),0) from wallet_transactions t where t.user_id=w.user_id);
select count(*) from (select balance_before, lag(balance_after) over (partition by user_id order by id) prev from wallet_transactions) x where prev is not null and balance_before <> prev;
select count(*) from casino_rounds r where r.bet_total <> (select coalesce(-sum(amount),0) from wallet_transactions t where t.round_id=r.id and t.type='bet');
select count(*) from casino_rounds r where r.status='finished' and r.payout <> (select coalesce(sum(amount),0) from wallet_transactions t where t.round_id=r.id and t.type='payout');
select count(*) from fair_seeds where status='revealed' and encode(extensions.digest(server_seed,'sha256'),'hex') <> server_seed_hash;
select count(*) from wallet_transactions t join casino_rounds r on r.id=t.round_id where t.user_id <> r.user_id;
```
