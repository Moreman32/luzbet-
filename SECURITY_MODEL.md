# LuzBet 2.0 — Security Model (as implemented)

## Identity
- Supabase Auth stores passwords (bcrypt). Login UX is username + password via `v2-login`.
- Technical e-mails are random (`p_<16 hex>@players.luzbet.invalid`), so a username cannot be turned into a GoTrue login
  and brute-forced directly against `/auth/v1/token`.
- No Auth trigger creates profiles or money: a self-signed-up or anonymous Auth user has no profile and every RPC refuses it.
- Roles live only in `profiles.role` (never in user_metadata). Disabled accounts are refused by every RPC and banned in Auth.

## Authorisation
- Player RPCs: `private.caller()` → `auth.uid()` must map to an active profile. All object lookups are scoped to the caller.
- Staff RPCs: `private.require_staff()` → role ≥ admin, active, **and JWT `aal = aal2` (TOTP MFA)** unless `admin_mfa_required` is set to false.
- Owner-only: role changes. Admins cannot adjust their own balance, disable owners/admins, or change roles.
- There is no API to choose outcomes, cards, numbers, seeds or winners.

## Database surface
- `anon`: no table grants, no function EXECUTE.
- `authenticated`: SELECT on player tables under RLS (own rows), EXECUTE on `rpc_*`.
- `service_role`: EXECUTE on `svc_*` only — no direct table writes.
- Default privileges in `public` revoked, so future tables/functions start closed.
- `private` schema: no USAGE for any API role.
- All functions: `SECURITY DEFINER`, `search_path = ''`, fully-qualified names.
- Ledger/audit/rule versions/actions immutable by trigger (even for the owner role); wallets writable only through `post_tx`.

## Throttling
`svc_login_attempt`: 8 attempts / 15 min per (username, IP), 40 per IP, 60 per username; then 15 min block.
A remote attacker cannot lock a player out from the player's own IP. Failed logins and blocks are logged.

## Frontend
- No `innerHTML` with data; all text via `textContent`. CSP forbids inline and third-party scripts.
- No secrets in the client (only the publishable key).

## Operator checklist (Dashboard → Authentication)
- Disable "Allow new users to sign up" and anonymous sign-ins (defence in depth; the DB already ignores such users).
- Enable Leaked Password Protection.
- Keep TOTP MFA enabled (required for the back-office).
