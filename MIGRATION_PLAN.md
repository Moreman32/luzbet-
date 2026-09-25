# LuzBet 2.0 Migration Plan

## User decision
No legacy LuzBet business data is required for 2.0.

## Therefore
We will treat legacy as an archive, not as a migration source.

## Preserve before cutover
- Git main commit SHA: eafaca981b5e81d54987ed4bfa0c85815a4ddceb
- full database schema snapshot
- functions, triggers, RLS policies and grants snapshot
- Edge Function sources
- optional full table data dump for insurance

## Cutover strategy
1. Build 2.0 separately.
2. Test against clean 2.0 schema.
3. Create final archive backup.
4. Freeze old writes.
5. Deploy new schema/API/frontend.
6. Validate auth, wallet, game core and RLS.
7. Only then retire legacy objects.

No DROP/TRUNCATE during design/build phase.
