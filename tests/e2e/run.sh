#!/bin/bash
# Fresh DB + seed + stack, then browser E2E
set -e
cd "$(dirname "$0")/.."
local/reset_db.sh >/dev/null && psql -h /tmp -p 5499 -U postgres -d lb2 -q -f local/seed_local.sql && local/stack.sh >/dev/null 2>&1
python3 e2e/e2e_test.py
