# LuzBet 2.0 — Implementation Plan

| phase | scope | status |
|---|---|---|
| 1 | Audit + architecture | done |
| 2 | Database / Auth / Security | done |
| 3 | Wallet / casino core / RNG / fairness | done |
| 4 | European Roulette | done |
| 5 | Blackjack | done |
| — | Quality gate (security, mobile, wallet, fairness, concurrency, recovery) | passed — see TEST_PLAN.md |
| 6 | Businka's Fortune slot (reel strips, paytable, free spins, Monte Carlo RTP) | next |
| 7 | Crash + Mines | |
| 8 | Plinko + Dice + Horse | |
| 9 | Luz Originals (10 concepts → 5) | |
| 10 | Progressive jackpots (MINI/MINOR/MAJOR/LUZPOT) | |
| 11 | Achievements / VIP / economy (rescue fund) | |
| 12 | Lobby / profile / leaderboards / live feed | |
| 13 | Admin / security centre extensions | |
| 14 | Meme engine to 200+ lines | |
| 15 | Visual / sound polish | |
| 16 | Full QA / load / fairness | |

Every new game must reuse: `private.lock_seed` → `private.fair_ints` → `private.post_tx`, one rule version row,
idempotency on (user, key) and (round, key), public `state` without hidden data, a browser verifier and a reference
implementation in `tests/local/reference.py`.
