import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { guardRequest, json } from "../_shared/http-security.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function toInt(value: unknown, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

Deno.serve(async (req) => {
  const blocked = guardRequest(req, { requireProxy: true, maxBodyBytes: 4096 });
  if (blocked) return blocked;

  try {
    const body = await req.json().catch(() => ({}));

    const code = String(body?.code || "").trim();
    const name = String(body?.name || "").trim();
    const incomingCoins = Math.max(0, toInt(body?.coins, 1000));
    const incomingSpent = Math.max(0, toInt(body?.spent, 0));

    if (!code) {
      return json(req, { ok: false, error: "code is required" }, 400);
    }

    const { data: participant, error: participantError } = await sb
      .from("participants")
      .select("code, name")
      .eq("code", code)
      .maybeSingle();

    if (participantError) {
      return json(req, { ok: false, error: participantError.message }, 500);
    }

    if (!participant) {
      return json(req, { ok: false, error: "participant not found" }, 404);
    }

    const { data: currentRow, error: currentError } = await sb
      .from("casino")
      .select("code, name, coins, spent, last_daily, last_cashback")
      .eq("code", code)
      .maybeSingle();

    if (currentError) {
      return json(req, { ok: false, error: currentError.message }, 500);
    }

    const currentCoins = Math.max(0, toInt(currentRow?.coins, 1000));
    const currentSpent = Math.max(0, toInt(currentRow?.spent, 0));

    if (currentRow && (
      incomingSpent < currentSpent ||
      (incomingSpent === currentSpent && incomingCoins < currentCoins)
    )) {
      return json(req, {
        ok: true,
        stale: true,
        saved: false,
        coins: currentCoins,
        spent: currentSpent,
        last_daily: currentRow.last_daily || null,
        last_cashback: currentRow.last_cashback || null,
      });
    }

    const payload = {
      code,
      name: name || currentRow?.name || participant.name || "",
      coins: incomingCoins,
      spent: Math.max(currentSpent, incomingSpent),
      last_daily: currentRow?.last_daily || null,
      last_cashback: currentRow?.last_cashback || null,
    };

    const { error: upsertError } = await sb
      .from("casino")
      .upsert(payload, { onConflict: "code" });

    if (upsertError) {
      return json(req, { ok: false, error: upsertError.message }, 500);
    }

    return json(req, {
      ok: true,
      stale: false,
      saved: true,
      coins: payload.coins,
      spent: payload.spent,
      last_daily: payload.last_daily,
      last_cashback: payload.last_cashback,
    });
  } catch (e) {
    return json(
      req,
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      500,
    );
  }
});
