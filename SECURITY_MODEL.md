# LuzBet 2.0 Security Model

## Principle
The browser is untrusted. Client state is never authoritative.

## Authorization
- Supabase Auth sessions.
- App roles stored in server-controlled app metadata and/or trusted profile tables, never user-editable metadata.
- ADMIN/OWNER require MFA.
- Every privileged request validates user and role server-side.

## Database
- RLS enabled on every exposed table.
- DENY BY DEFAULT.
- No direct client writes to wallets, ledger, jackpots, achievement unlocks, hidden game state or audit tables.
- Sensitive tables live outside exposed schemas.
- SECURITY DEFINER only when unavoidable, in non-exposed schema, explicit search_path, explicit auth checks, EXECUTE revoked from PUBLIC by default.

## API
- JWT verification enabled for user-facing functions unless an endpoint has a separately designed authentication mechanism.
- Idempotency key on all balance-affecting actions.
- Request body never accepts authoritative outcome or payout.
- Generic authentication errors.
- Rate limiting is supplementary, not a correctness mechanism.

## Current legacy risks identified
- `start-casino-round` has `verify_jwt=false`.
- It identifies a player from a supplied participant code rather than Auth identity.
- It uses service-role access to mutate balances.
- Balance debit and round creation are separate requests rather than one database transaction.
- Several public tables currently have RLS disabled.
- Legacy grants/security-definer RPC exposure is broader than a 2.0 hostile-client model permits.
