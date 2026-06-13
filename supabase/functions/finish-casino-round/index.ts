import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function toInt(value: unknown, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
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
    const round_id = String(body?.round_id || "").trim();
    const payout = Math.max(0, toInt(body?.payout, 0));
    const meta = isPlainObject(body?.meta) ? body.meta : {};

    if (!code) return json({ ok: false, error: "code is required" }, 400);
    if (!round_id) return json({ ok: false, error: "round_id is required" }, 400);
    if (payout > 100000) return json({ ok: false, error: "payout is too large" }, 400);

    const { data: round, error: roundError } = await sb
      .from("casino_rounds")
      .select("round_id, code, game, bet, status, payout, meta")
      .eq("round_id", round_id)
      .maybeSingle();

    if (roundError) return json({ ok: false, error: roundError.message }, 500);
    if (!round) return json({ ok: false, error: "round not found" }, 404);
    if (String(round.code) !== code) return json({ ok: false, error: "round belongs to another player" }, 403);

    const bet = Math.max(0, Number(round.bet || 0));

    if (round.status === "finished") {
      const { data: casinoRow } = await sb
        .from("casino")
        .select("coins, spent")
        .eq("code", code)
        .maybeSingle();

      return json({
        ok: true,
        duplicate: true,
        round_id,
        game: round.game,
        bet,
        payout: Number(round.payout || 0),
        delta: Number(round.payout || 0) - bet,
        coins: Number(casinoRow?.coins || 0),
        spent: Number(casinoRow?.spent || 0),
      });
    }

    if (round.status !== "started") {
      return json({ ok: false, error: "round is not active" }, 400);
    }

    const { data: casinoRow, error: casinoError } = await sb
      .from("casino")
      .select("code, name, coins, spent, last_daily, last_cashback")
      .eq("code", code)
      .maybeSingle();

    if (casinoError) return json({ ok: false, error: casinoError.message }, 500);
    if (!casinoRow) return json({ ok: false, error: "casino row not found" }, 404);

    const currentCoins = Math.max(0, Number(casinoRow.coins || 0));
    const currentSpent = Math.max(0, Number(casinoRow.spent || 0));
    const nextCoins = currentCoins + payout;

    const result =
      payout > bet ? "win" :
      payout === bet ? "push" :
      "loss";

    const finalMeta = {
      ...(isPlainObject(round.meta) ? round.meta : {}),
      ...meta,
      status: "finished",
      result,
    };

    const { error: casinoUpdateError } = await sb
      .from("casino")
      .update({
        coins: nextCoins,
        spent: currentSpent,
      })
      .eq("code", code);

    if (casinoUpdateError) {
      return json({ ok: false, error: casinoUpdateError.message }, 500);
    }

    const { error: roundUpdateError } = await sb
      .from("casino_rounds")
      .update({
        status: "finished",
        payout,
        meta: finalMeta,
        finished_at: new Date().toISOString(),
      })
      .eq("round_id", round_id)
      .eq("status", "started");

    if (roundUpdateError) {
      return json({ ok: false, error: roundUpdateError.message }, 500);
    }

    const { error: eventError } = await sb
      .from("casino_events")
      .upsert({
        code,
        round_id,
        game: round.game,
        event_type: "round",
        bet,
        payout,
        delta: payout - bet,
        meta: finalMeta,
      }, { onConflict: "round_id" });

    if (eventError) {
      return json({ ok: false, error: eventError.message }, 500);
    }

    return json({
      ok: true,
      round_id,
      game: round.game,
      bet,
      payout,
      delta: payout - bet,
      result,
      coins: nextCoins,
      spent: currentSpent,
    });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "finish-casino-round failed" },
      500,
    );
  }
});