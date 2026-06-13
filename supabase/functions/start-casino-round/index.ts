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

const MIN_ROUND_INTERVAL_MS = 1000;

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
    const round_id = String(body?.round_id || crypto.randomUUID()).trim();
    const game = String(body?.game || "").trim();
    const bet = Math.max(0, toInt(body?.bet, 0));
    const meta = isPlainObject(body?.meta) ? body.meta : {};

    if (!code) return json({ ok: false, error: "code is required" }, 400);
    if (!round_id) return json({ ok: false, error: "round_id is required" }, 400);
    if (!game) return json({ ok: false, error: "game is required" }, 400);
    if (bet <= 0 || bet > 500) return json({ ok: false, error: "bad bet" }, 400);

    const allowedGames = new Set([
      "slots",
      "blackjack",
      "wheel",
      "keno",
      "scratch",
      "rps",
      "penalty",
      "offside",
      "var_challenge",
      "eleven_meters",
      "dice",
      "crash",
      "higher_lower",
      "horse",
      "plinko",
      "mines",
      "tower",
      "coinflip",
    ]);

    if (!allowedGames.has(game)) {
      return json({ ok: false, error: "unknown casino game" }, 400);
    }

    const { data: participant, error: participantError } = await sb
      .from("participants")
      .select("code, name")
      .eq("code", code)
      .maybeSingle();

    if (participantError) return json({ ok: false, error: participantError.message }, 500);
    if (!participant) return json({ ok: false, error: "participant not found" }, 404);

    const { data: casinoRow, error: casinoError } = await sb
      .from("casino")
      .select("code, name, coins, spent, last_daily, last_cashback")
      .eq("code", code)
      .maybeSingle();

    if (casinoError) return json({ ok: false, error: casinoError.message }, 500);

    const currentCoins = Math.max(0, Number(casinoRow?.coins ?? 1000));
    const currentSpent = Math.max(0, Number(casinoRow?.spent ?? 0));

    if (currentCoins < bet) {
      return json({
        ok: false,
        error: "not enough coins",
        coins: currentCoins,
        spent: currentSpent,
      }, 400);
    }

    const { data: existingRound, error: existingRoundError } = await sb
      .from("casino_rounds")
      .select("round_id, status, code, game, bet")
      .eq("round_id", round_id)
      .maybeSingle();

    if (existingRoundError) {
      return json({ ok: false, error: existingRoundError.message }, 500);
    }

    if (existingRound) {
      return json({
        ok: true,
        duplicate: true,
        round_id: existingRound.round_id,
        status: existingRound.status,
        coins: currentCoins,
        spent: currentSpent,
      });
    }

    // Надёжная защита от параллельных автокликов.
    // Внутри Postgres используется pg_advisory_xact_lock по code.
    const { data: rateOk, error: rateError } = await sb.rpc(
      "try_casino_rate_limit",
      {
        p_code: code,
        p_interval_ms: MIN_ROUND_INTERVAL_MS,
      },
    );

    if (rateError) {
      return json({ ok: false, error: rateError.message }, 500);
    }

    if (rateOk !== true) {
      return json({
        ok: false,
        error: "too_fast",
        message: "Слишком быстро. Подожди немного.",
        retry_after_ms: MIN_ROUND_INTERVAL_MS,
        coins: currentCoins,
        spent: currentSpent,
      }, 429);
    }

    const nextCoins = currentCoins - bet;
    const nextSpent = currentSpent + bet;

    const casinoPayload = {
      code,
      name: casinoRow?.name || participant.name || "",
      coins: nextCoins,
      spent: nextSpent,
      last_daily: casinoRow?.last_daily || null,
      last_cashback: casinoRow?.last_cashback || null,
    };

    const { error: upsertCasinoError } = await sb
      .from("casino")
      .upsert(casinoPayload, { onConflict: "code" });

    if (upsertCasinoError) {
      return json({ ok: false, error: upsertCasinoError.message }, 500);
    }

    const { error: roundError } = await sb
      .from("casino_rounds")
      .insert({
        round_id,
        code,
        game,
        bet,
        status: "started",
        payout: 0,
        meta,
      });

    if (roundError) {
      await sb
        .from("casino")
        .upsert({
          ...casinoPayload,
          coins: currentCoins,
          spent: currentSpent,
        }, { onConflict: "code" });

      return json({ ok: false, error: roundError.message }, 500);
    }

    return json({
      ok: true,
      round_id,
      code,
      game,
      bet,
      coins: nextCoins,
      spent: nextSpent,
    });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "start-casino-round failed" },
      500,
    );
  }
});
