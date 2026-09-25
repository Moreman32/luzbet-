// LuzBet 2.0 — staff operations that need the Auth admin API.
// verify_jwt = true. Authorisation is decided by the database (role + aal2) through the caller's own JWT.
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { clientIp, corsHeaders, env, json, readJson, USERNAME_RE } from "../_shared/http.ts";

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);
  const auth = req.headers.get("Authorization");
  if (!auth) return json(req, { error: "unauthorized" }, 401);

  const url = env("SUPABASE_URL");
  const user = createClient(url, env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const svc = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const who = await user.rpc("rpc_admin_whoami");
  if (who.error || !who.data?.ok) {
    const msg = who.error?.message ?? "forbidden";
    await svc.rpc("svc_security_event", {
      p_user: null, p_type: "admin_endpoint_denied", p_severity: "warn", p_meta: { reason: msg.slice(0, 80) }, p_ip: clientIp(req),
    });
    return json(req, { error: msg.includes("mfa_required") ? "mfa_required" : "forbidden" }, 403);
  }
  const actorId = who.data.id as string;

  const body = await readJson(req);
  const action = String(body?.action ?? "");

  try {
    if (action === "create_player") {
      const username = String(body?.username ?? "").trim().toLowerCase();
      const displayName = String(body?.displayName ?? "").trim() || username;
      const password = String(body?.password ?? "");
      if (!USERNAME_RE.test(username)) return json(req, { error: "invalid_username" }, 400);
      if (displayName.length < 1 || displayName.length > 32 || /[<>\p{Cc}]/u.test(displayName)) {
        return json(req, { error: "invalid_display_name" }, 400);
      }
      if (password.length < 8 || password.length > 72) return json(req, { error: "weak_password" }, 400);
      const free = await user.rpc("rpc_admin_username_free", { p_username: username });
      if (free.error || !free.data?.free) return json(req, { error: "username_taken" }, 409);

      const email = `p_${randomHex(8)}@players.luzbet.invalid`;
      const created = await svc.auth.admin.createUser({
        email, password, email_confirm: true, app_metadata: { luzbet: "v2" },
      });
      if (created.error || !created.data.user) {
        console.error("createUser failed", created.error?.message);
        return json(req, { error: "auth_create_failed" }, 500);
      }
      const uid = created.data.user.id;
      const prof = await svc.rpc("svc_create_profile", {
        p_actor: actorId, p_user: uid, p_username: username, p_display_name: displayName,
        p_role: "player", p_opening: 1000, p_legacy_id: null, p_must_change: true,
      });
      if (prof.error || !prof.data?.ok) {
        await svc.auth.admin.deleteUser(uid); // no profile/ledger rows exist yet -> safe rollback
        const taken = (prof.error?.message ?? "").includes("duplicate");
        return json(req, { error: taken ? "username_taken" : "profile_create_failed" }, taken ? 409 : 500);
      }
      return json(req, { ok: true, id: uid, username });
    }

    if (action === "set_password") {
      const userId = String(body?.userId ?? "");
      const password = String(body?.password ?? "");
      if (password.length < 8 || password.length > 72) return json(req, { error: "weak_password" }, 400);
      const prep = await user.rpc("rpc_admin_prepare_password_reset", { p_user: userId });
      if (prep.error || !prep.data?.ok) return json(req, { error: prep.data?.error ?? "forbidden" }, 403);
      const upd = await svc.auth.admin.updateUserById(userId, { password });
      if (upd.error) return json(req, { error: "auth_update_failed" }, 500);
      return json(req, { ok: true });
    }

    if (action === "set_status") {
      const userId = String(body?.userId ?? "");
      const status = String(body?.status ?? "");
      if (status !== "active" && status !== "disabled") return json(req, { error: "invalid_status" }, 400);
      const res = await user.rpc("rpc_admin_set_status", { p_user: userId, p_status: status, p_reason: String(body?.reason ?? "") });
      if (res.error || !res.data?.ok) return json(req, { error: res.data?.error ?? "forbidden" }, 403);
      const upd = await svc.auth.admin.updateUserById(userId, { ban_duration: status === "disabled" ? "876000h" : "none" });
      if (upd.error) return json(req, { error: "auth_update_failed", dbUpdated: true }, 500);
      return json(req, { ok: true });
    }

    return json(req, { error: "unknown_action" }, 400);
  } catch (e) {
    console.error("v2-admin", action, e);
    return json(req, { error: "internal_error" }, 500);
  }
});
