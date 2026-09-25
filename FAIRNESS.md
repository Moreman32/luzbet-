# LuzBet 2.0 Fairness

## RNG
Use cryptographically secure server-side randomness. Never Math.random for authoritative outcomes.

## Provably fair
For applicable games:
- server_seed
- server_seed_hash commitment before play
- client_seed
- nonce
- deterministic result mapping
- reveal after completion

## Verification
Completed rounds expose sufficient non-secret material to independently recompute the result.

## Rule versioning
Verification always includes the exact immutable rule version used by the round.

## UX
Fairness detail lives on dedicated screens, not in the main gameplay flow.
