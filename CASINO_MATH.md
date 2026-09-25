# LuzBet 2.0 Casino Math

## Policy
No personal RTP, forced wins/losses, dynamic odds, streak-based or balance-based RNG.

## Roulette
European 0-36, each number 1/37, standard payouts. House edge derives only from the zero.

## Blackjack
Target baseline:
- 6 decks
- dealer stands on soft 17
- blackjack 3:2
- double and split supported
- DAS/insurance/surrender to be frozen explicitly before release

## Slots
Each published slot version defines:
- reel strips / symbol weights
- paylines or ways
- paytable
- wild/scatter
- free spins/bonus
- jackpot eligibility
Expected RTP and variance are properties of the version and are tested offline.

## Crash/Mines/Plinko/Dice
Published deterministic mapping from secure random input to outcome and payout.
Provably-fair commitment where appropriate.

## Validation
Large offline simulations never write to production.
