# LuzBet 2.0 Build Status

## 2026-09-25 — Core + Roulette + Blackjack (quality gate reached)

### Done (phases 2–5)
- Auth: username/password, opaque technical e-mails, throttling, password change, logout / logout everywhere, disable, TOTP MFA for staff.
- Wallet: append-only ledger, idempotent `post_tx`, DB-level immutability, invariants.
- Provably fair: commit-before-bet seed pairs, client seed, nonce, rotation/reveal, browser verifier.
- European Roulette: every table bet, one-transaction spin, recovery.
- Blackjack: full state machine, hidden shoe, split/double/DAS, recovery.
- Daily bonus, history, personal statistics.
- Back-office: overview, players, create/disable/temporary password/roles, ledger adjustments with reason, audit, security events.
- 24 legacy players migrated with 1 000 ЛК each; owner = dima.
- Tests: 150 engine/security, 43 browser E2E, production smoke (rolled back), math simulations.

### Not yet (next phases per IMPLEMENTATION_PLAN.md)
Businka slots, Crash, Mines, Plinko, Dice, Horse, Luz Originals, progressive jackpots (LUZPOT), achievements, VIP,
leaderboards, live feed, bankrupt rescue, casino personality, full 200-line meme catalogue (80 lines now), sound design polish.
