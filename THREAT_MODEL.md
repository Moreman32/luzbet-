# LuzBet 2.0 Threat Model

## Attacker capabilities
Assume player can:
- inspect all frontend source;
- alter JS/state;
- call APIs with curl/Postman;
- replay requests;
- parallelize requests;
- guess identifiers;
- open many tabs/devices;
- automate clicks;
- alter request bodies.

## Protected assets
- wallet balance
- ledger integrity
- round state
- RNG outcome
- hidden game state
- jackpot ownership
- achievement rewards
- admin privileges
- audit history

## Major threats and mitigations
### Double spend / duplicate payout
Transaction + row lock + unique idempotency key + immutable ledger.

### IDOR
All round/user references checked against authenticated user server-side.

### Replay
Per-action idempotency keys/nonces and state-machine validation.

### Outcome tampering
Outcome generated server-side and tied to immutable rule version.

### Hidden-state leakage
Keep unrevealed data in private schema and never serialize it early.

### Privilege escalation
Trusted role source only; MFA for privileged accounts; strict function grants.

### Admin tampering
Admin cannot choose RNG outcome or winner. All admin economy actions require reason + immutable audit log.
