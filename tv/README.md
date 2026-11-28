# LuzBet TV
Standalone prototype at /tv/ on deployments that include this branch. All current stories are explicitly fictional demo content. No production reads, wallet mutations or AI requests.

## Presenter assets
Upload paired WebP images under tv/assets/ and configure host.json, e.g.
```json
{"desk":{"idle":"assets/desk-idle.webp","talk":"assets/desk-talk.webp"},"newspaper":{"idle":"assets/newspaper-idle.webp","talk":"assets/newspaper-talk.webp"}}
```
Use identical framing, dimensions and background in each pair. Suggested poses: desk, newspaper, analyst, coffee, reporter, shocked, awards, weather, detective, sleeping. Prefer same-origin paths. Images absent initially.

## Next implementation
- Authenticated office-only aggregated feed; use existing Supabase session; server-side authorization and allowlisted fields. Personal names, avatars and losses require opt-in. Do not send identity or balance data to AI.
- Persistent event queue with deduplication; factual reporting of completed rounds, large net outcomes and balance transitions, no fabricated events. Replay only from recorded outcomes, label reconstructed animations.
- Server-side OpenRouter adapter, provider/model configurable, secrets never in client. Verify available model IDs and rates at runtime. Cheap model for routine satire, stronger model for selected scripts; compare blind on fixed fictional test cases with token/price logs. JSON validation, fallback stories, no direct database access by model.
- AI generation window 09:00 inclusive to 18:00 exclusive Asia/Nicosia checked on server, DST-aware. Persist queued events outside hours. No AI requests from TV.
- Stable dashboard 5–10 min, full segments 45–180 sec, hourly news, readable headlines, archive, muted default. Current prototype rotates sample articles every 8 min and supports manual navigation.
- Fictional newsroom canon: Businka, Department of Financial Catastrophes, Institute of Applied Variance; humor aimed at fictional institutions, not humiliating colleagues or encouraging gambling.
- Test offline recovery, long-running display, accessibility, browser TV compatibility, authorization and server scheduling before production merge.
