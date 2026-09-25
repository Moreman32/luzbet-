import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { guardRequest, json } from "../_shared/http-security.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const VIP_DAILY_BONUS_LEVELS = [
  { thresh: 10000000, amount: 1400 },
  { thresh: 5000000, amount: 1150 },
  { thresh: 2500000, amount: 900 },
  { thresh: 1000000, amount: 700 },
  { thresh: 500000, amount: 550 },
  { thresh: 200000, amount: 450 },
  { thresh: 80000, amount: 375 },
  { thresh: 25000, amount: 300 },
  { thresh: 7500, amount: 250 },
  { thresh: 2000, amount: 225 },
  { thresh: 0, amount: 200 },
];

function sameUtcDay(a: string | null | undefined, b: Date) {
  if (!a) return false;
  const d = new Date(a);
  return (
    d.getUTCFullYear() === b.getUTCFullYear() &&
    d.getUTCMonth() === b.getUTCMonth() &&
    d.getUTCDate() === b.getUTCDate()
  );
}

function getDailyBonusAmount(spent: number) {
  return (VIP_DAILY_BONUS_LEVELS.find((x) => spent >= x.thresh) || VIP_DAILY_BONUS_LEVELS[VIP_DAILY_BONUS_LEVELS.length - 1]).amount;
}

async function restoreCasinoRow(
  code: string,
  participantName: string,
  previous: {
    name?: string | null;
    coins?: number | null;
    spent?: number | null;
    last_daily?: string | null;
    last_cashback?: string | null;
  } | null,
) {
  if (!previous) {
    await sb.from("casino").delete().eq("code", code);
    return;
  }

  await sb.from("casino").upsert({
    code,
    name: previous.name || participantName || "",
    coins: Number(previous.coins || 0),
    spent: Number(previous.spent || 0),
    last_daily: previous.last_daily || null,
    last_cashback: previous.last_cashback || null,
  }, { onConflict: "code" });
}

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

    if (participantError) return json(req, { ok: false, error: participantError.message }, 500);
    if (!participant) return json(req, { ok: false, error: "participant not found" }, 404);

    const { data: casinoRow, error: casinoError } = await sb
      .from("casino")
      .select("code, name, coins, spent, last_daily, last_cashback")
      .eq("code", code)
      .maybeSingle();

    if (casinoError) return json(req, { ok: false, error: casinoError.message }, 500);

    const now = new Date();
    if (sameUtcDay(casinoRow?.last_daily, now)) {
      return json(req, {
        ok: true,
        amount: 0,
        last_daily: casinoRow?.last_daily || now.toISOString(),
        logged: true,
      });
    }

    const nextSpent = Number(casinoRow?.spent || 0) || 0;
    const dailyBonusAmount = getDailyBonusAmount(nextSpent);
    const nextCoins = (Number(casinoRow?.coins || 1000) || 1000) + dailyBonusAmount;
    const last_cashback = casinoRow?.last_cashback || null;
    const last_daily = now.toISOString();

    const { error: upsertError } = await sb.from("casino").upsert({
      code,
      name: casinoRow?.name || participant.name || "",
      coins: nextCoins,
      spent: nextSpent,
      last_daily,
      last_cashback,
    }, { onConflict: "code" });

    if (upsertError) return json(req, { ok: false, error: upsertError.message }, 500);

    const { error: logError } = await sb.from("casino_events").insert({
      code,
      game: "system",
      event_type: "bonus",
      bet: 0,
      payout: dailyBonusAmount,
      delta: dailyBonusAmount,
      meta: { source: "daily_bonus", vip_daily_bonus: dailyBonusAmount },
    });

    if (logError) {
      await restoreCasinoRow(code, participant.name || "", casinoRow || null);
      return json(req, { ok: false, error: logError.message }, 500);
    }

    return json(req, {
      ok: true,
      amount: dailyBonusAmount,
      last_daily,
      logged: true,
    });
  } catch (e) {
    return json(
      req,
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      500,
    );
  }
});
