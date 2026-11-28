# LuzBet TV Statistics API v1

Deployed function: `tv-stats` in project `kdsowktuirtkxnmtyoaz`. Endpoint: `https://kdsowktuirtkxnmtyoaz.supabase.co/functions/v1/tv-stats` (GET). Edge function has `verify_jwt=false` by design: the response includes **only anonymous global aggregates**. Do not extend it with names, balances, user IDs, seeds or personal outcomes. Allowed origins are restricted for browsers, but CORS is not authentication. There is a best-effort per-isolate request limiter and 60s response cache. For stronger rate limits use shared infrastructure.

Database migration applied using Supabase migration API on 2026-11-28, name `tv_stats_snapshot_anonymous`. Created `public.tv_stats_snapshot()` (STABLE, SECURITY DEFINER, empty search_path). EXECUTE explicitly revoked from PUBLIC, anon and authenticated; only service_role granted. Function reads `public.casino_rounds` and `legacy_20260925.casino_events`, never writes to game-related data. No existing RLS policies changed.

Historical legacy rounds are canonicalized using lowercased code + round_id, preferring finished events and highest ID; administrative sources and non-game events excluded. Only finished events counted. Modern finished_at and legacy created_at are assigned to Asia/Nicosia for local calendar days/weeks/months. Weeks begin Monday. Both datasets have non-overlapping time ranges in the observed records; if old data is imported again into modern rounds, add cross-source reconciliation to avoid duplicates.

Payload: `ok`, `version`, `generated_at`, `timezone`, `periods`, `hours`, `days`, `games`, `active_players_30d_modern`, `sources`, `scope`, `personal_data`. The distinct-participant count is **modern 30-day only**, not total historical participants. The dashboard currently omits it to avoid confusion. Achievements omitted because a verified cross-era source is not yet available. Historical stats are not represented as today's activity.

Client refresh: 60s plus browser localStorage of the last valid anonymous snapshot (24h limit), stale label on connectivity loss. Preview has Dashboard button. No personal rankings are implemented.

Verification performed: SQL snapshot returned 21,065 total (20,512 legacy and 553 modern) on 2026-11-28. Supabase deployment succeeded. External HTTP/browser runtime verification was not possible from the available environment; check HTTP status/CORS and appearance from office browser before marking full end-to-end QA complete.
