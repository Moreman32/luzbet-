# LuzBet 2.0 — Casino Math

## Policy
No personal RTP, dynamic odds, forced outcomes, streak/balance-based RNG. VIP/cosmetics never touch RNG.

## European Roulette (`roulette_european_v1`)
37 numbers, each 1/37. Zero loses all outside bets (no la partage).

| bet | covers | pays | RTP |
|---|---|---|---|
| straight | 1 | 35:1 | 97.297% |
| split | 2 | 17:1 | 97.297% |
| street / trio (0-1-2, 0-2-3) | 3 | 11:1 | 97.297% |
| corner / first four (0-1-2-3) | 4 | 8:1 | 97.297% |
| six line | 6 | 5:1 | 97.297% |
| column / dozen | 12 | 2:1 | 97.297% |
| red/black, odd/even, 1-18/19-36 | 18 | 1:1 | 97.297% |

House edge 1/37 = 2.7027%. Limits: 1–5 000 per position, 10 000 per spin, 60 positions.
Payout = stake × (ratio + 1) for every covered line.

Simulation (`tests/math/simulate.py`, production mapping, 10 000 000 spins): χ²(36) = 31.0 (critical 58.6 at p = 0.01),
zero frequency 0.02711 (theory 0.02703), red RTP 97.278% ± 0.063% (2σ).

## Blackjack (`blackjack_standard_v1`)
6 decks, fresh shoe per round, S17, dealer peek, BJ 3:2 (rounded down), double any two, DAS, one split
(any 10-values), split aces one card each, no insurance, no surrender. Limits 1–5 000.

Basic-strategy simulation over the reference engine (200 000 rounds): RTP 99.40% (±0.51% at 2σ), consistent with the
published ≈99.3–99.6% for these rules.
