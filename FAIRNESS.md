# LuzBet 2.0 — Fairness (provably fair protocol)

## Commitment before the bet
Each player has one active seed pair: a secret `server_seed` (32 random bytes from `gen_random_bytes`, hex) and a
player-chosen `client_seed`. The SHA-256 of the server seed is stored in `fair_seeds.server_seed_hash` and shown to the
player **before** any bet uses it. The hash, client seed and nonce are also copied into every round.

## Outcome
```
block(cursor) = HMAC_SHA256(key = server_seed (UTF-8 hex string), message = client_seed + ":" + nonce + ":" + cursor)
words         = big-endian uint32, 8 per block, cursor = 0, 1, 2 …
fairInt(m)    = next word u with u < floor(2^32 / m) * m  →  u mod m      (rejection sampling, no modulo bias)
```
- Roulette (`roulette_european_v1`): number = fairInt(37).
- Blackjack (`blackjack_standard_v1`): deck = [0..311]; for i = 311 … 1: j = fairInt(i+1); swap(i, j).
  Card c → rank c mod 13 (0 = A), suit ⌊c/13⌋ mod 4. Deal: player, dealer up, player, dealer hole, then shoe order.
- Nonce starts at 0 and increases by exactly 1 per round (UNIQUE (seed_id, nonce)).

## Reveal
`rpc_rotate_seed` publishes the old server seed (trigger checks it hashes to the commitment) and creates a new pair.
Rotation is refused while a round on that seed is active (otherwise the player could learn future cards).

## Why the house cannot cheat after the bet
The server seed is fixed and committed before the bet; the client seed is the player's; the nonce is sequential.
Changing any outcome would require a different server seed, which would not match the published hash.

## Verification
`#/fairness/verify?round=<id>` recomputes in the browser (WebCrypto, independent code in `assets/js/fair.js`):
hash(seed) = commitment, outcome from seeds, and payout from the submitted bets / recorded actions.
`tests/local/reference.py` is a third independent implementation used by the test suite.
