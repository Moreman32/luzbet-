import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchCasinoEvents, summarizeEconomyRows } from "../_shared/casino-ledger.ts";
import { guardRequest, json } from "../_shared/http-security.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  const blocked = guardRequest(req, { requireProxy: true, maxBodyBytes: 2048 });
  if (blocked) return blocked;

  try {
    const body = await req.json().catch(() => ({}));
    const code = String(body?.code || "").trim();

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

    const [{ data: row, error }, events] = await Promise.all([
      sb
        .from("casino")
        .select("code, name, coins, spent, last_daily, last_cashback")
        .eq("code", participant.code)
        .maybeSingle(),
      fetchCasinoEvents(sb, { code: participant.code }),
    ]);

    if (error) {
      return json(req, { ok: false, error: error.message }, 500);
    }

    const economy = summarizeEconomyRows(events);
    const resolvedSpent = Math.max(
      Number(economy.spent_total || 0),
      Number(row?.spent || 0),
    );

    if (!row) {
      return json(req, {
        ok: true,
        code: participant.code,
        name: participant.name || "",
        coins: 1000,
        spent: resolvedSpent,
        earned: economy.earned_total || 0,
        last_daily: null,
        last_cashback: null,
      });
    }

    return json(req, {
      ok: true,
      code: row.code,
      name: row.name || participant.name || "",
      coins: Number(row.coins || 0),
      spent: resolvedSpent,
      earned: Number(economy.earned_total || 0),
      last_daily: row.last_daily || null,
      last_cashback: row.last_cashback || null,
    });
  } catch (e) {
    return json(
      req,
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      500,
    );
  }
});
