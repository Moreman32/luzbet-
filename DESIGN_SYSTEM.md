# LuzBet 2.0 Design System

## Direction
Luxury dark casino with restrained absurd corporate humor.

## Palette
- deep black
- charcoal
- warm gold
- champagne
- restrained burgundy/red

## Rules
- Gold is an accent, not the background.
- Primary UI is serious.
- Meme copy is secondary feedback.
- One primary joke focal point per screen at most.
- Avoid generic purple SaaS gradients, cheap neon and excessive glassmorphism.

## Motion hierarchy
microinteraction < game action < win < big win < jackpot

## Accessibility
Contrast, focus states, keyboard support where sensible, reduced motion, visual outcome feedback independent of sound.

## Implemented tokens (`assets/css/app.css`)
- Colours: `--bg #0a0907`, `--surface #15130f`, `--line #2e281e`, `--text #f2ede3`, `--gold #d2ad62` (accent only), `--champagne`, `--burgundy #7a1c26`, felt `#0f3b2c`.
- Type: Cormorant Garamond (display), Inter (UI, tabular numbers), JetBrains Mono (hashes/seeds).
- Radius 6/10/14/20/28; spacing 4-8-12-16-24-32-48-64; two shadow levels; gold focus ring.
- Components: header + mobile tab bar, cards, buttons (primary = gold gradient, one per screen), seg controls, tables, chips, toasts, modal, drawer.
- Motion: chip placement < card deal < wheel spin (4.8 s ease-out) < big-win overlay (rare). `prefers-reduced-motion` disables all.
- Humour: `assets/js/memes.js` — one line after an event, never on controls; recent-history dedup.
