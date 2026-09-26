#!/bin/bash
# Recreate local lb2 database from bootstrap + all LuzBet 2.0 migrations (fails loudly on any SQL error)
set -e
cd "$(dirname "$0")/../.."
PSQL="psql -h /tmp -p 5499 -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "drop database if exists lb2 with (force)" -c "create database lb2" 2>&1 | grep -v NOTICE || true
for r in authenticator anon authenticated service_role; do $PSQL -d postgres -c "drop owned by $r cascade" 2>/dev/null || true; $PSQL -d postgres -c "drop role if exists $r" 2>/dev/null || true; done
$PSQL -d lb2 -f tests/local/bootstrap_supabase_like.sql >/dev/null 2>/tmp/lb2_err.txt || { cat /tmp/lb2_err.txt; exit 1; }
for f in supabase/migrations/2026*.sql; do
  $PSQL -d lb2 -f "$f" >/dev/null 2>/tmp/lb2_err.txt || { echo "FAILED: $f"; grep -v NOTICE /tmp/lb2_err.txt; exit 1; }
done
echo "db ready"
