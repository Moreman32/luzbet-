import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchCasinoEvents, summarizeEconomyRows } from "../_shared/casino-ledger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const code = String(body?.code || "").trim();

    if (!code) {
      return json({ ok: false, error: "code is required" }, 400);
    }

    const { data: participant, error: participantError } = await sb
      .from("participants")
      .select("code, name")
      .eq("code", code)
      .maybeSingle();

    if (participantError) {
      return json({ ok: false, error: participantError.message }, 500);
    }

    if (!participant) {
      return json({ ok: false, error: "participant not found" }, 404);
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
      return json({ ok: false, error: error.message }, 500);
    }

    const economy = summarizeEconomyRows(events);

    if (!row) {
      return json({
        ok: true,
        code: participant.code,
        name: participant.name || "",
        coins: 1000,
        spent: economy.spent_total || 0,
        earned: economy.earned_total || 0,
        last_daily: null,
        last_cashback: null,
      });
    }

    return json({
      ok: true,
      code: row.code,
      name: row.name || participant.name || "",
      coins: Number(row.coins || 0),
      spent: Number(economy.spent_total || row.spent || 0),
      earned: Number(economy.earned_total || 0),
      last_daily: row.last_daily || null,
      last_cashback: row.last_cashback || null,
    });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      500,
    );
  }
});
