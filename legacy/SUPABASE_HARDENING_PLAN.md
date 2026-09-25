# Supabase Hardening Plan

## Goal

Bring the project to a state where:

- player data is not silently lost;
- duplicate rows do not break reads;
- client-side tampering cannot rewrite the database;
- leaderboard and casino stats stay consistent;
- admin actions are protected properly.

## What was fixed in this repo

- Latest prediction/playoff rows are now read deterministically by explicit ordering.
- Leaderboard/admin views now deduplicate duplicate prediction rows by `code`.
- Casino delayed sync now treats `{ ok: false }` as a failed write and retries later.
- Achievement sync now also restores the dirty flag on failed writes.
- Logout now flushes pending casino/achievement writes before clearing the session.
- XSS-prone `innerHTML` insertions for names and database-backed text were escaped.
- Casino spending is now counted consistently for slots, blackjack, and wheel.

These changes reduce risk, but they do **not** fully secure the system on their own.

## Highest-priority external fixes

1. Remove direct write access from the browser.
2. Add uniqueness constraints so one logical entity always has one row.
3. Enable RLS and move write operations to Edge Functions / server endpoints.
4. Stop using front-end-only admin auth.

Without these four, a motivated user can still tamper with data.

## Recommended migration order

1. Make a backup of the current database.
2. Deduplicate existing rows.
3. Add unique constraints and foreign keys.
4. Update write paths to use `upsert` or RPC transactions.
5. Enable RLS.
6. Move admin and user writes behind server-side checks.

## SQL to run after backup

### 1. Deduplicate before adding constraints

```sql
-- Keep the newest prediction per code
delete from public.predictions p
using public.predictions newer
where lower(p.code) = lower(newer.code)
  and p.id < newer.id;

-- Keep the newest playoff row per code
delete from public.playoff p
using public.playoff newer
where lower(p.code) = lower(newer.code)
  and p.id < newer.id;

-- Keep the newest results row per group
delete from public.results r
using public.results newer
where r.group_code = newer.group_code
  and r.id < newer.id;

-- Remove duplicate achievements
delete from public.achievements a
using public.achievements newer
where lower(a.code) = lower(newer.code)
  and a.achievement = newer.achievement
  and a.id < newer.id;
```

### 2. Add constraints

```sql
alter table public.predictions
  add constraint predictions_code_key unique (code);

alter table public.playoff
  add constraint playoff_code_key unique (code);

alter table public.results
  add constraint results_group_code_key unique (group_code);

alter table public.achievements
  add constraint achievements_code_achievement_key unique (code, achievement);

alter table public.predictions
  add constraint predictions_code_fkey
  foreign key (code) references public.participants(code);

alter table public.casino
  add constraint casino_code_fkey
  foreign key (code) references public.participants(code);

alter table public.achievements
  add constraint achievements_code_fkey
  foreign key (code) references public.participants(code);

alter table public.playoff
  add constraint playoff_code_fkey
  foreign key (code) references public.participants(code);

alter table public.casino
  add constraint casino_coins_nonnegative check (coins >= 0),
  add constraint casino_spent_nonnegative check (spent >= 0);
```

### 3. Add timestamps that help deterministic reads and auditing

```sql
alter table public.playoff
  add column if not exists updated_at timestamp with time zone default now();

alter table public.results
  add column if not exists updated_at timestamp with time zone default now();

alter table public.playoff_results
  add column if not exists updated_at timestamp with time zone default now();
```

### 4. Keep `updated_at` fresh automatically

```sql
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_predictions_updated_at on public.predictions;
create trigger set_predictions_updated_at
before update on public.predictions
for each row execute function public.set_updated_at();

drop trigger if exists set_playoff_updated_at on public.playoff;
create trigger set_playoff_updated_at
before update on public.playoff
for each row execute function public.set_updated_at();

drop trigger if exists set_results_updated_at on public.results;
create trigger set_results_updated_at
before update on public.results
for each row execute function public.set_updated_at();

drop trigger if exists set_playoff_results_updated_at on public.playoff_results;
create trigger set_playoff_results_updated_at
before update on public.playoff_results
for each row execute function public.set_updated_at();
```

## Security architecture to switch to

### User-facing writes

Move these writes off the client:

- save prediction
- save casino
- sync achievements
- save playoff

Recommended approach:

- client calls an Edge Function;
- function validates payload;
- function checks participant code;
- function performs one transactional write;
- function returns the canonical saved row.

### Admin writes

Move these writes off the static `admin.html` page:

- save results
- delete results
- playoff results editing if added later

Recommended approach:

- protect admin with Supabase Auth or another real auth layer;
- verify admin role in Edge Function;
- only then allow results writes.

## RLS checklist

Once writes move server-side:

1. Enable RLS on all tables.
2. Deny anonymous direct writes to `predictions`, `casino`, `achievements`, `playoff`, `results`, `playoff_results`.
3. Keep read access only where truly needed.
4. Let Edge Functions use the service role key privately on the server.

## Code follow-ups after DB changes

After the constraints above are live:

1. Replace `DELETE + POST` with `upsert` for predictions.
2. Replace `DELETE + POST` with either:
   - per-achievement upserts, or
   - one RPC function that replaces the set transactionally.
3. For playoff, either:
   - use `insert ... on conflict do nothing`, or
   - enforce a server-side “save once” rule in one transaction.
4. For results, rely on `on_conflict=group_code` only after the unique constraint exists.

## Reliability extras

If you want users to lose even less work:

1. Add local draft autosave for the prediction form before final submit.
2. Add local draft autosave for playoff picks before final submit.
3. Show a small sync status badge:
   - `saved`
   - `saving`
   - `retrying`
4. Log failed writes to a lightweight audit table or error tracker.

## Important reality check

No static front-end can guarantee "users never lose anything" while it writes directly to the database with a public key.

The repo changes reduce accidental loss and UI-level issues.
The database and architecture changes above are what make the system actually robust.
