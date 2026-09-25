# LuzBet 2.0 — Migration (executed 2026-09-25)

## Decisions
- Legacy data preserved untouched in schema `legacy_20260925` (no API access).
- Players: all 24 real legacy participants recreated as 2.0 accounts (test account "Тест тестович" skipped).
  Balance for everyone = 1 000 ЛК (owner decision); legacy balances remain in the archive only.
- Owner: `dima` (legacy participant 2). Everyone gets a temporary password and must change it at first login.
- Mapping: `profiles.legacy_participant_id` = `legacy_20260925.participants.id`; opening ledger entry metadata
  `{"source":"legacy_migration","legacyParticipantId":…}`.

## Done
1. v2 scaffolding (empty, guarded) replaced by migrations `20260925130000…130500`.
2. PostgREST `db_pre_request` hook pointing to a moved legacy function removed; failing legacy cron job unscheduled.
3. 24 Auth users + identities + profiles + wallets + opening transactions + seed pairs created; password hashes verified by fingerprint.
4. Edge Functions `v2-login`, `v2-admin` deployed. Retired endpoints stubbed with 410:
   `v2-play-roulette`, `v2-start-roulette`, `v2-admin-create-player`, `start-casino-round`, `finish-casino-round`, `save-casino`.
5. Old site preserved in Git branch `legacy-main`; `main` serves 2.0.

## Remaining clean-up (safe, optional)
Delete the ~40 legacy Edge Functions that now fail harmlessly:
```
supabase functions list --project-ref kdsowktuirtkxnmtyoaz
supabase functions delete <slug> --project-ref kdsowktuirtkxnmtyoaz
```

## Rollback
- Frontend: point `main` back to `legacy-main` (the legacy backend is no longer wired, so this only restores the page).
- Database: 2.0 tables are independent of `legacy_20260925`; the archive can be moved back to `public` if ever needed.
