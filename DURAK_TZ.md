# Durak: Product + Tech Spec

## Goal

Add a full bet-based `Durak` mode to LuzBet with:

- one whole match per bet;
- resume after refresh / broken connection;
- server-side state as the source of truth;
- two casino-friendly bot profiles;
- normal integration with `casino_rounds`, `casino_events`, stats, RTP and achievements.

## Product Decisions

### Rules for MVP

- 36-card deck
- 1 player vs 1 bot
- one active game per player
- one bet for the whole match
- game resumes if page reloads
- two bot profiles:
  - `regular`
  - `pro`

### Bot Profiles

- `regular`
  - friendlier decisions
  - lower payout
  - recommended payout: `x1.75`
- `pro`
  - stronger defense, better trump economy
  - higher payout
  - recommended payout: `x2.20`

### Economy

- start of match:
  - create normal casino round with `game = 'durak'`
  - bet is deducted immediately
- end of match:
  - `player win` -> payout by selected profile
  - `player lose` -> payout `0`

## Why Separate State Table

`Durak` is not a one-click game like slots or dice.

It needs persistent state:

- deck order
- trump suit
- player hand
- bot hand
- cards on the table
- discard pile
- whose turn it is
- difficulty
- winner

Without a dedicated table:

- refresh kills the match
- flaky internet kills the match
- client state becomes easy to fake

## Database Design

Migration added locally:

- [20260613_casino_durak.sql](/Users/moreman32/Documents/GitHub/luzbet-/supabase/migrations/20260613_casino_durak.sql)

Table:

- `public.casino_durak_games`

Core fields:

- `game_id`
- `round_id`
- `code`
- `status`
- `difficulty`
- `bet`
- `winner`
- `trump_suit`
- `attacker`
- `defender`
- `talon`
- `player_hand`
- `bot_hand`
- `table_pairs`
- `discard_pile`
- `turn_state`
- `created_at`
- `updated_at`
- `finished_at`

Important constraints:

- only one active match per player
- linked to `casino_rounds`
- RLS enabled

## Server Architecture

### Existing Functions To Reuse

- `start-casino-round`
- `finish-casino-round`
- `log-casino-event`
- `get-my-casino-stats`

### New Functions Recommended

1. `start-durak-game`
- creates the casino round
- creates initial match state
- returns active game snapshot

2. `get-durak-game`
- returns active match for player
- used on page load and reconnect

3. `play-durak-turn`
- accepts one player action
- validates the move on server
- updates game state
- makes bot move
- finishes round if match is over

4. `abandon-durak-game`
- optional
- marks game as abandoned if needed by admin / recovery flow

## Security Rules

- browser must never be the source of truth for match state
- bot move and final winner must be calculated on server
- client sends only action intent
- payout must be derived from difficulty + winner on server
- one active game per player prevents duplicate round abuse

## Frontend UX

Recommended card layout:

- title: `🃏 Дурак`
- difficulty chips:
  - `Обычный`
  - `Опытный`
- bet chips
- CTA:
  - `Начать партию`
  - if active game exists -> `Продолжить партию`

Board section:

- trump badge
- cards left in talon
- bot hand count
- player hand cards
- table attack/defense
- action buttons:
  - `Атаковать`
  - `Побить`
  - `Взять`
  - `Бито`

Status line:

- whose turn
- what action is expected
- current difficulty
- current bet

## What Was Added Locally Now

1. Durak added to server allowlists:
- [start-casino-round](/Users/moreman32/Documents/GitHub/luzbet-/supabase/functions/start-casino-round/index.ts)
- [log-casino-event](/Users/moreman32/Documents/GitHub/luzbet-/supabase/functions/log-casino-event/index.ts)

2. Durak added to stats labels:
- [index.html](/Users/moreman32/Documents/GitHub/luzbet-/index.html)

3. Shared state engine foundation added:
- [_shared/durak.ts](/Users/moreman32/Documents/GitHub/luzbet-/supabase/functions/_shared/durak.ts)

4. SQL migration for persistent game state added:
- [20260613_casino_durak.sql](/Users/moreman32/Documents/GitHub/luzbet-/supabase/migrations/20260613_casino_durak.sql)

## Concrete Next Steps For You

### If you want to apply the DB now

1. Open Supabase project
2. Open `SQL Editor`
3. Run the SQL from:
   - [20260613_casino_durak.sql](/Users/moreman32/Documents/GitHub/luzbet-/supabase/migrations/20260613_casino_durak.sql)
4. Confirm table exists:
   - `public.casino_durak_games`

### If you want to deploy prepared backend compatibility changes

Deploy at least:

- `start-casino-round`
- `log-casino-event`

### What still needs implementation after this foundation

1. actual `start-durak-game`
2. actual `get-durak-game`
3. actual `play-durak-turn`
4. frontend card + board UI
5. achievements for durak

## Recommended Build Order

1. DB migration
2. `start-durak-game`
3. `get-durak-game`
4. `play-durak-turn`
5. frontend resume flow
6. balancing
7. achievements

## Notes

The shared engine file added locally is a safe foundation:

- deck generation
- shuffle
- hand sorting
- first attacker selection
- initial game dealing
- basic bot heuristics

It is not yet wired into live Edge Functions. That is the next implementation layer.
