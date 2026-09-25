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

const EXACT_PAYOUT_RULES: Record<string, (bet: number) => number[]> = {
  blackjack: (bet) => [0, bet, Math.round(bet * 1.9)],
  coinflip: (bet) => [0, bet * 2],
  dice: (bet) => [0, bet * 3.5, bet * 4.5, bet * 6, bet * 8, bet * 12, bet * 24],
  horse: (bet) => [0, Math.floor(bet * 1.8), Math.floor(bet * 3.0), Math.floor(bet * 4.2), Math.floor(bet * 8.0)],
  keno: (bet) => [0, Math.round(bet * 0.75), Math.round(bet * 1.5), bet * 9],
  penalty: (bet) => [0, Math.round(bet * 1.65)],
  rps: (bet) => [0, bet, Math.round(bet * 1.85)],
  scratch: (bet) => [0, bet, bet * 2, bet * 4, bet * 8],
  slots: (bet) => [0, Math.round(bet * 2.2), bet * 7],
  var_challenge: (bet) => [0, Math.round(bet * 0.7), Math.round(bet * 1.2), Math.round(bet * 2.0)],
  wheel: (bet) => [
    0,
    Math.round(bet * 0.25),
    Math.round(bet * 0.5),
    Math.round(bet * 0.75),
    Math.round(bet * 0.9),
    bet,
    Math.round(bet * 1.1),
    Math.round(bet * 1.2),
    Math.round(bet * 1.35),
    Math.round(bet * 1.6),
    Math.round(bet * 2.5),
  ],
};

const MAX_PAYOUT_MULTIPLIERS: Record<string, number> = {
  crash: 20,
  higher_lower: 30,
  mines: 4.8,
  offside: 2.9,
  plinko: 3.5,
  tower: 3.2,
};

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

function uniqSorted(values: number[]) {
  return [...new Set(values.map((value) => Math.max(0, Math.trunc(value))))].sort((a, b) => a - b);
}

function isPayoutAllowed(game: string, bet: number, payout: number) {
  const exactRule = EXACT_PAYOUT_RULES[game];
  if (exactRule) {
    return uniqSorted(exactRule(bet)).includes(Math.trunc(payout));
  }

  const maxMult = MAX_PAYOUT_MULTIPLIERS[game];
  if (maxMult) {
    return payout >= 0 && payout <= Math.round(bet * maxMult);
  }

  return payout >= 0;
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
    const game = String(round.game || "");

    if (!isPayoutAllowed(game, bet, payout)) {
      return json({
        ok: false,
        error: "invalid payout for game",
        game,
        bet,
        payout,
      }, 400);
    }

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
        game,
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
        game,
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
      game,
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
