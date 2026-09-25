# LuzBet 2.0 Implementation Plan

## Phase 1 — completed baseline
- Repository and Supabase audit started.
- Legacy risk list established.
- 2.0 branch created.
- Architecture documentation created.

## Phase 2 — clean foundation
- Introduce modern frontend structure.
- Add Supabase Auth username/password UX backed by internal email identity if required.
- Add profiles and roles.
- Add private schema and strict grants.
- Add wallets + append-only ledger.

## Phase 3 — casino core
- Transactional start/action/finish RPCs.
- Idempotency framework.
- secure RNG service.
- rule versioning.
- fairness commitments.
- recovery endpoints.

## Phase 4 — Roulette
Implement end-to-end, including mobile and tests.

## Phase 5 — Blackjack
Implement end-to-end, including hidden deck state and recovery.

## Quality gate
Stop and validate security, concurrency, wallet integrity, mobile UX and fairness.

## Later phases
Businka Slots -> Crash/Mines -> Plinko/Dice/Horse -> Originals -> Jackpots -> Achievements/VIP -> Lobby/Stats -> Admin/Security Center -> Meme engine -> polish -> full QA.

## Production rule
No destructive legacy operation until the 2.0 quality gate is passed and a final archive backup exists.
