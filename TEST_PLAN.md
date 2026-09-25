# LuzBet 2.0 — Test Plan and Results

## Engine & security (`tests/local/test_engine.py`, local Supabase-like Postgres) — 150/150
- Access matrix: anon/authenticated/service_role cannot read or write what they shouldn't (tables, private schema, svc/admin RPCs);
  RLS hides other players' rows; ledger/wallet immutable even for the owner role; TRUNCATE blocked; disabled accounts refused.
- Roulette: 24 malformed payloads rejected (illegal splits/corners, out-of-range, 0/negative/float/"1e3"/huge amounts, >limits,
  duplicates, 61 positions, non-array); every legal bet type accepted; payout arithmetic.
- Fairness: 400 spins reproduced from the revealed seed by the independent reference; nonces consecutive; reveal hashes to commitment.
- Concurrency: 10/50/100 parallel spins never overspend, balance == ledger, nonces unique and consecutive;
  50 parallel identical requests → 1 round, 1 debit, no errors; 20 parallel same-key/different-payload → 1 round, 19 conflicts.
- Blackjack: 1 500 rounds (160 splits, 368 doubles, 53 naturals) replayed exactly from the revealed seed; bet ledger == bet_total;
  hole card hidden; shoe unreadable; foreign round refused; unknown action refused; second active round refused; rotation refused
  while a round is active; 30 parallel STAND → 1 accepted; 20 parallel DOUBLE same key → 1 debit; key reuse for another action → conflict;
  double without funds → refused.
- Economy/admin: 20 parallel daily claims → 1 bonus; player → forbidden; admin without MFA → mfa_required; adjustments audited;
  self-adjust, missing reason, over-limit refused; admin cannot disable owner or change roles; owner can; audit immutable.
- Login throttling: pair limit blocks after 8; victim from another IP unaffected.
- Invariants (DATABASE_DESIGN.md) all 0.

## Browser E2E (`tests/e2e/e2e_test.py`, real UI + real Edge Function code + PostgREST) — 43/43
Login errors, forced password change, daily bonus, multi-bet roulette, hostile double-click (1 round), lost response + safe retry
(same round), reload with pending spin (same round), blackjack refresh mid-hand (restored, hole hidden), history, seed reveal,
browser verifier PASS for roulette and blackjack and FAIL on tampered data, direct REST attacks with a player token, XSS in display name,
logout, MFA enrolment gate, create player, ledger adjustment + audit, disable (profile + Auth ban), disabled login refused,
mobile 390px: no horizontal scroll on every page, touch targets ≥ 36px.

## Production smoke test (rolled back)
Spin, replay, conflict, blackjack round, private schema denied, wallet write denied, admin denied, RLS 1 profile visible,
reveal hash, ledger mismatches 0 — executed inside a transaction that was rolled back.

## Math (`tests/math/simulate.py`) — see CASINO_MATH.md

## Not covered here (needs a live browser against production)
Real GoTrue MFA TOTP with an authenticator app, real refresh-token rotation timing, Supabase gateway rate limits.
