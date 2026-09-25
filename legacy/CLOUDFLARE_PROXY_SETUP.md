# Cloudflare Proxy Setup

## What changed in this repo

- Browser requests now default to `/api/<function-name>` instead of direct `supabase.co/functions/v1`.
- Critical Supabase functions now reject direct access unless they receive `x-luzbet-proxy-secret`.
- Admin endpoints now require both the admin password and the trusted proxy secret.
- `public-site-data` is ready to be cached at the Worker layer.

## Files added

- [cloudflare/worker.js](/Users/moreman32/Documents/GitHub/luzbet-/cloudflare/worker.js)
- [cloudflare/wrangler.toml.example](/Users/moreman32/Documents/GitHub/luzbet-/cloudflare/wrangler.toml.example)

## Secrets to create

### In Cloudflare Worker

Run:

```bash
wrangler secret put SUPABASE_PUBLISHABLE_KEY
wrangler secret put LUZBET_PROXY_SHARED_SECRET
```

Suggested `LUZBET_PROXY_SHARED_SECRET`: a long random string, 32+ chars.

### In Supabase Edge Functions

Set environment variable:

```text
LUZBET_PROXY_SHARED_SECRET=<the same secret as in Cloudflare>
```

Optional:

```text
ALLOWED_ORIGINS=https://luzbet.lol,https://www.luzbet.lol
```

## Worker vars

Copy `cloudflare/wrangler.toml.example` to `cloudflare/wrangler.toml` and set:

- `SUPABASE_FUNCTIONS_BASE_URL`
- `ALLOWED_ORIGINS`

## Deploy order

1. Add `LUZBET_PROXY_SHARED_SECRET` to Supabase functions.
2. Deploy updated Supabase functions.
3. Configure Worker secrets and vars.
4. Deploy the Worker.
5. Route `/api/*` on `luzbet.lol` to that Worker.

## What to verify

1. `https://luzbet.lol/` still loads and login works.
2. `https://luzbet.lol/admin.html` still opens and admin auth works.
3. A direct call to `https://YOUR_PROJECT_REF.supabase.co/functions/v1/public-site-data` now returns `403`.
4. A call to `https://luzbet.lol/api/public-site-data` returns `200`.

## Important note

Only the patched endpoints are hard-blocked by proxy secret in this commit. That already closes the highest-risk holes, but the remaining functions should be migrated to the same helper in the next pass.
