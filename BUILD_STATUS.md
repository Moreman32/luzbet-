# LuzBet 2.0 Build Status

## 2026-09-25

### Completed
- Created Git branch `luzbet-2-rebuild`.
- Archived the legacy database into non-public schema `legacy_20260925`.
- Revoked anon/authenticated access to the legacy schema.
- Preserved all 20 legacy tables in-place instead of deleting them.
- Created clean `public` LuzBet 2.0 foundation.
- Created `private` schema for unrevealed casino state.
- Added profiles, wallets, append-only wallet transactions, game catalog, immutable game-rule versions, casino rounds/actions, audit/security tables.
- Enabled RLS on every new exposed table.
- Added self-read policies for player-owned data.
- Removed direct anonymous table access.
- Added Auth signup trigger that creates profile + 1000 LK opening wallet transaction atomically.
- Seeded 8 game definitions, all disabled until their engines are ready.
- Re-ran Supabase security advisor.

### Verification
- Legacy tables preserved: 20
- New public tables: 9
- Seeded games: 8
- New RLS policies: 7
- Auth users: 0 (expected before new registration flow)
- Security advisor has no RLS-disabled findings for the new public schema.
- Remaining advisor notices are either intentionally policy-less server-only audit tables or archived legacy objects.

### Next
1. Implement authenticated wallet RPC primitives with idempotency and row locking.
2. Implement rule publishing and European Roulette v1.
3. Add server-side round start/finish API.
4. Build new frontend/auth shell.
5. Add integration/concurrency/security tests.


## 2026-09-25 — Auth & Roulette iteration
- Added username/password login facade backed by Supabase Auth.
- Added server-side login throttling.
- Added admin-only player creation Edge Function (requires authenticated admin/owner).
- Added cryptographic roulette execution and atomic ledger payout.
- Added missing foreign-key indexes reported by Supabase performance advisor.
- Frontend v2 now logs in by username and plays the live Roulette v1 API.
