# LuzBet 2.0 Test Plan

## Unit
- payout math
- rule validation
- state machines
- RNG mapping
- idempotency behavior

## Integration
- auth
- round lifecycle
- wallet/ledger
- RLS
- jackpot
- achievements

## Concurrency
- 100 parallel bets
- duplicate action keys
- parallel cashback/bonus claims
- parallel cashout
- jackpot race

## Security
- tampered payload
- fake payout
- foreign round ID
- replay
- direct RPC calls
- unauthorized admin
- client state manipulation

## E2E
Player: login -> play -> history -> fairness verify -> logout.
Admin: MFA login -> player lookup -> audited adjustment -> disable user -> audit review.

## Statistical
Roulette/slots/dice/mines/plinko simulations and distribution sanity checks.
