# LuzBet 2.0 — Architecture

## Principle
The browser is hostile. It sends intents (bets, actions) and renders results. Every number that matters —
balance, outcome, payout, card, seed — is decided and stored by PostgreSQL.

## Layers
1. **Frontend** (`index.html`, `assets/`): static SPA, hash router, vanilla ES modules, no build step.
   supabase-js 2.116.0 is vendored (no CDN). CSP: scripts only from self; network only to the Supabase project.
2. **Supabase Auth**: identities and passwords (bcrypt). Players never see e-mails: each account has an opaque
   technical e-mail `p_<random>@players.luzbet.invalid`, looked up server-side from the username.
3. **Edge Functions**
   - `v2-login` (verify_jwt=false): rate limit → username lookup → `signInWithPassword` → session tokens. Generic errors.
   - `v2-admin` (verify_jwt=true): Auth-admin operations (create player, temporary password, ban). Authorisation is decided
     by the database through the caller's own JWT (`rpc_admin_whoami`: role + active + aal2).
4. **PostgreSQL**: all game logic lives in `SECURITY DEFINER` functions (`search_path=''`).
   - `public.rpc_*` — the player/staff API, `EXECUTE` for `authenticated` only; each function identifies the caller via `auth.uid()`.
   - `public.svc_*` — service API for Edge Functions, `EXECUTE` for `service_role` only.
   - `private.*` — engine internals and secrets; no API role has `USAGE` on the schema.

## Round lifecycle
- **Roulette**: one RPC = one transaction: validate bets → lock seed → idempotency re-check → lock wallet → outcome from
  committed seed/nonce → debit, credit, round, action. Nothing can be half-done.
- **Blackjack**: `rpc_blackjack_start` shuffles a fresh 312-card shoe from seed/nonce, stores it in `private.blackjack_games`,
  deals, handles naturals. `rpc_blackjack_action` locks the round, validates the transition, updates, settles.
  The public `state` column contains only visible cards. One active round per player; it survives refresh.

## Recovery
- Every bet/action carries an idempotency key generated once per intent and kept in `sessionStorage` until an answer arrives.
  Lost response or reload → the same key is re-sent → the database returns the already-committed result.
- Active blackjack rounds are returned by `rpc_me` and resumed.

## Legacy
LuzBet 1.0 data is archived in schema `legacy_20260925` (no API access). Its code lives in `legacy/` and is not deployed.
Six legacy/obsolete Edge Functions that could write with service_role were replaced with 410 stubs; the rest fail harmlessly
because their tables no longer exist in `public` and should be deleted (see MIGRATION_PLAN.md).
