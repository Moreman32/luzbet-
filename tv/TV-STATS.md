# LuzBet TV — Live Analytics 2.0

## API and data contract

`GET https://kdsowktuirtkxnmtyoaz.supabase.co/functions/v1/tv-stats-v2`

Public response: `ok`, `version: 2`, `data_version`, `generated_at`, `timezone`, `today`, `last_24h`, `week`, `month`, `all_time`, `hourly`, `daily`, `games`, `participants: null`, `personal_data: false`, `editorial_events`, `limitations`. Each period includes completed rounds, distinct active players, wagered, paid, player_net, house_net, financial_complete and legacy_rounds. Games contains arrays for each period, sorted by completed rounds. Hourly has 24 local hour buckets; daily has 14 local calendar days.

All boundaries use `Asia/Nicosia`; weeks start Monday. Today starts at local midnight; last_24h is a separate rolling interval. Completion time attributes modern rounds to periods. This differs intentionally from the older leaderboard's created_at filter for rounds crossing midnight. Repeated local hours during autumn DST are combined into the same numbered hourly bucket; the day still has 24 display buckets. Future hours show zero.

The existing `tv-stats` endpoint and `tv_stats_snapshot()` v1 contract are unchanged.

## Financial correctness

Modern data uses finished `casino_rounds.bet_total` and `payout`, as the existing leaderboard and personal stats do. The complete observed set of 553 finished rounds reconciled against round-linked ledger bets and payouts: 285,511 wagered, 271,404 paid, -14,107 player net, +14,107 house net. Administrative credits, openings, bonuses and refunds are not included in completed-round payouts. The two observed refunds (110 LK total) belong to excluded rounds. No game data is changed.

Legacy rounds retain v1 canonicalization: normalized code + round ID, finished event preferred, highest event ID; excluded administrative sources and non-game events. Only explicit finished events before the 2026-09-25 cutover are included. Observed legacy timestamps end on 2026-09-24; modern timestamps start on 2026-09-25. Legacy identities map through participants and profiles when available; unmapped legacy codes remain distinct internal identities and are never returned to clients.

Legacy financial values have not been independently reconciled to a trustworthy ledger. Periods containing legacy rounds return **null financial totals**, not zero or partial sums. The TV explicitly states this limitation. Legacy games use distinct `legacy:` identifiers in the API and Russian “архив” labels on screen, avoiding accidental consolidation with modern mechanics. Historical slots and modern Businka slots are separate.

Observed aggregate: 21,065 finished rounds (20,512 legacy, 553 modern), matching v1. Aggregates are dynamic; these are verification values from 2026-11-28, not fixtures.

## Office privacy

`GET .../tv-stats-v2?office=1` requires a Supabase access token in `Authorization: Bearer ...`. Each request validates the user with Auth and checks enabled `tv_office_viewers` plus an active profile in SQL. Participants require enabled `tv_participant_consent` and active profiles. Names and avatars come only from `profiles.display_name` and `profiles.avatar`. The response contains participants for today and the last 24 hours; no balances, usernames, raw ledger, seeds or raw event payloads are returned.

Office responses use `private, no-store`. Shared server caching contains anonymous aggregates only. Browser storage persists only a sanitized anonymous projection with `participants: null`; office participant results exist only in memory. Sign-out, session expiry, auth rejection, connectivity loss and reappearance after hiding remove personal results and return to the anonymous feed. Preview does not bypass authorization. All new SQL functions are revoked from PUBLIC, anon and authenticated and granted only to service_role; the normalized view is private.

Public editorial events are allowlisted aggregate counts of confirmed round-completion and activity-digest events. Private event payloads, identities and loss-oriented stories are never exposed. These are counts of collected events, not an assertion that every round has an editorial event. Existing news stories remain explicitly fictional satire; this work does not change the editorial collector or generate AI articles.

## Runtime and rotation

Refresh: once per 60 seconds, deduplicated and time-limited, plus online/visibility recovery. The Edge Function coalesces public snapshot requests and caches for 60 seconds per isolate, invalidating on a Cyprus date change. This is best-effort per-isolate caching/rate limiting, not a globally shared cache. Last anonymous data survives temporary failure; stale indicators use generated_at, not just the last successful HTTP request. Old “today” data is discarded on local midnight.

Analytical pages rotate every 25 seconds: overview, games, office participants, history and events. Lists contain five rows, with page counts. Categories interleave, so large lists cannot postpone every event/history screen until after the news break. The pagination cursor survives news/replay interruptions so later pages remain reachable across 8-minute analytical windows. Existing news and replay timing stays at 480 seconds of analytical pause and 16 seconds per replay. Preview adds “Экран аналитики”; default broadcast controls remain hidden. Reduced-motion settings are respected. Number transitions run only on changed values; unchanged snapshots do not rebuild the content.

## Verification

- `node --test tests/tv/*.test.mjs`: formatting, missing values, zero-height bars, large financial charts, complete pagination, public/office separation, office data purge, two stable dashboard timers, and cache sanitization.
- `tests/tv/analytics.sql`: read-only ledger reconciliation, v1 counts, game/hour sums, empty/nonempty buckets, access checks, balanced net and Cyprus calendar/DST boundaries. All 13 checks passed against production.
- Live HTTP: public 200; missing office token 401; forbidden origin and invalid token checks recorded in completion report.
- Browser: real anonymous data, five page types, 1920×1080 and 3840×2160, zero activity, synthetic large values/26 participants/long names/missing avatars, sign-out/offline fallback, and return to news. Screenshots are local QA artifacts, not production data.
- `python3 tests/tv/preview-server.py`: localhost-only stress fixture server on port 4174. Fixture pages are prominently labeled as fictional; this server must never be used as production hosting.

Remaining limits: legacy financial reconstruction; actual office login on the physical TV; continuous 24-hour soak/hardware suspend testing. Browser stress fixtures prove layout and fallback behavior but are not a production Auth session. Optional previous-period comparisons are not implemented.
