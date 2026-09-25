# LuzBet 2.0 Architecture

## Status
Design baseline. No production cutover performed.

## Goals
- Server-authoritative casino core.
- Supabase Auth for identity.
- PostgreSQL as source of truth for balances, game state, payouts, achievements, jackpots, and statistics.
- Hostile-client assumption.
- Private schemas for sensitive state.
- Immutable game rule versions.

## Target layers
1. **Frontend**
   - Input, rendering, animation, sound only.
   - Never computes authoritative outcomes or balances.

2. **Edge/API layer**
   - Auth/session validation.
   - Request validation.
   - Idempotency keys.
   - Calls transactional database functions.
   - No client-supplied outcome/payout acceptance.

3. **Database**
   - `auth.users` for identity.
   - `public.profiles` for usernames/display names.
   - `public.wallets` current state.
   - `public.wallet_transactions` append-only ledger.
   - `public.casino_rounds`, `public.casino_actions`.
   - `public.game_definitions`, `public.game_rule_versions`.
   - `private.*` for unrevealed seeds, hidden cards/mines, internal rate limits, privileged state.
   - `public.admin_audit_log`, `public.security_events`.

4. **Game engines**
   - Pure deterministic domain logic where possible.
   - Secure server-side RNG.
   - Versioned rules.
   - Recovery from refresh/network loss.

## Legacy decision
Legacy production remains read-only until cutover. Its code, tables, functions and Edge Functions are treated as reference material only.

## Initial audit findings
- Current repository is mostly a single large static `index.html` with ad-hoc Supabase integration.
- Current Supabase project has no Auth users but has legacy participants/casino accounts.
- Current `start-casino-round` Edge Function has JWT verification disabled.
- Current wallet update + round insert is not one database transaction; it performs a compensating write on failure.
- Several legacy tables are directly exposed in `public`, and some casino tables have RLS disabled.
- Several SECURITY DEFINER functions are callable by anonymous/authenticated roles.

## Proposed delivery model
- Build 2.0 on branch `luzbet-2-rebuild`.
- Do not reuse the legacy browser write model.
- Introduce a clean application frontend under a modern build tool only after the architecture documents are accepted.
