// LuzBet 2.0 — username/password login facade over Supabase Auth.
// verify_jwt = false (this IS the login). Technical emails are opaque (p_<random>@players.luzbet.invalid),
// so they cannot be derived from a username and brute-forced directly against GoTrue.
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { clientIp, env, json, readJson, USERNAME_RE, corsHeaders } from "../_shared/http.ts";

const GENERIC = { error: "invalid_credentials" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  const ip = clientIp(req);
  const body = await readJson(req);
  const username = String(body?.username ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  if (!USERNAME_RE.test(username) || password.length < 1 || password.length > 128) return json(req, GENERIC, 401);

  const svc = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: allowed, error: rlErr } = await svc.rpc("svc_login_attempt", { p_username: username, p_ip: ip });
  if (rlErr) {
    console.error("rate limiter failed", rlErr.message);
    return json(req, { error: "service_unavailable" }, 503);
  }
  if (allowed !== true) {
    await svc.rpc("svc_security_event", {
      p_user: null, p_type: "login_rate_limited", p_severity: "warn", p_meta: { username }, p_ip: ip,
    });
    return json(req, { error: "too_many_attempts" }, 429);
  }

  const { data: who, error: lookupErr } = await svc.rpc("svc_login_lookup", { p_username: username });
  if (lookupErr) {
    console.error("lookup failed", lookupErr.message);
    return json(req, { error: "service_unavailable" }, 503);
  }
  const email = who?.email as string | undefined;
  const userId = (who?.userId as string | undefined) ?? null;

  let session = null;
  if (email && who?.status === "active") {
    const anon = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    if (!error && data.session) session = data.session;
  }

  await svc.rpc("svc_login_result", { p_username: username, p_ip: ip, p_success: !!session, p_user: userId });
  if (!session) return json(req, GENERIC, 401);

  return json(req, {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
  });
});
