#!/bin/bash
# Starts the local E2E stack: PostgREST :3000, Deno functions :8001/:8002, gateway+static :8080.
set -e
cd "$(dirname "$0")"
REPO=$(cd ../.. && pwd)
SECRET="local-test-secret-local-test-secret-000"
LOG=/tmp/lb2-stack; mkdir -p $LOG
pkill -f "postgrest /tmp/lb2-pgrst.conf" 2>/dev/null || true
pkill -f "gateway.mjs" 2>/dev/null || true
pkill -f "DENO_LB2" 2>/dev/null || true
[ -d node_modules/pg ] || npm i --silent --no-save pg >/dev/null
cat > /tmp/lb2-pgrst.conf <<EOF
db-uri = "postgres://authenticator:authenticator@localhost:5499/lb2?host=/tmp"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-port = 3000
EOF
nohup /tmp/postgrest /tmp/lb2-pgrst.conf > $LOG/pgrst.log 2>&1 &
nohup env PORT=8080 JWT_SECRET=$SECRET node gateway.mjs "$REPO" > $LOG/gw.log 2>&1 &
sleep 1.5
ANON=$(grep ^ANON= $LOG/gw.log | cut -d= -f2)
SERVICE=$(grep ^SERVICE= $LOG/gw.log | cut -d= -f2)
FN=/tmp/lb2-fn; rm -rf $FN; mkdir -p $FN; cp -r $REPO/supabase/functions/* $FN/; echo '{}' > $FN/deno.json
for pair in "v2-login:8001" "v2-admin:8002"; do
  name=${pair%%:*}; port=${pair##*:}
  (cd $FN && nohup env DENO_LB2=1 DENO_SERVE_ADDRESS=tcp:127.0.0.1:$port SUPABASE_URL=http://localhost:8080 SUPABASE_ANON_KEY=$ANON SUPABASE_SERVICE_ROLE_KEY=$SERVICE \
     deno run -A $name/index.ts > $LOG/$name.log 2>&1 &)
done
sleep 4
curl -s -o /dev/null -w "pgrst %{http_code}\n" localhost:3000/ || true
curl -s -o /dev/null -w "gateway %{http_code}\n" localhost:8080/ || true
echo "ANON=$ANON"
