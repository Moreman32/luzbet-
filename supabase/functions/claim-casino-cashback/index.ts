import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  fetchCasinoEvents,
  isFinishedGameplayCasinoEvent,
} from "../_shared/casino-ledger.ts";

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

const CASHBACK_DAILY_CAP = 300;

const VIP_CASHBACK_LEVELS = [
  { thresh: 75000, pct: 15 },
  { thresh: 35000, pct: 12 },
  { thresh: 15000, pct: 10 },
  { thresh: 5000, pct: 7 },
  { thresh: 2000, pct: 5 },
  { thresh: 500, pct: 3 },
  { thresh: 0, pct: 2 },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function sameUtcDay(a: string | null | undefined, b: Date) {
  if (!a) return false;
  const d = new Date(a);
  return (
    d.getUTCFullYear() === b.getUTCFullYear() &&
    d.getUTCMonth() === b.getUTCMonth() &&
    d.getUTCDate() === b.getUTCDate()
  );
}

function getCashbackPct(spent: number) {
  return (VIP_CASHBACK_LEVELS.find((x) => spent >= x.thresh) || VIP_CASHBACK_LEVELS[VIP_CASHBACK_LEVELS.length - 1]).pct;
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

    if (participantError) return json({ ok: false, error: participantError.message }, 500);
    if (!participant) return json({ ok: false, error: "participant not found" }, 404);

    const { data: casinoRow, error: casinoError } = await sb
      .from("casino")
      .select("code, name, coins, spent, last_daily, last_cashback")
      .eq("code", code)
      .maybeSingle();

    if (casinoError) return json({ ok: false, error: casinoError.message }, 500);

    const now = new Date();
    if (sameUtcDay(casinoRow?.last_cashback, now)) {
      return json({
        ok: true,
        amount: 0,
        last_cashback: casinoRow?.last_cashback || now.toISOString(),
        logged: true,
      });
    }

    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const nextDayStart = new Date(dayStart);
    nextDayStart.setUTCDate(nextDayStart.getUTCDate() + 1);

    const events = await fetchCasinoEvents(sb, {
      code,
      since: dayStart.toISOString(),
    });

    const net = events
      .filter((row) => {
        if (!isFinishedGameplayCasinoEvent(row)) return false;
        const createdAt = String(row.created_at || "");
        return createdAt < nextDayStart.toISOString();
      })
      .reduce((sum, row) => sum + (Number(row.delta || 0) || 0), 0);
    const rawLoss = Math.max(0, -Math.round(net));
    const spent = Number(casinoRow?.spent || 0) || 0;
    const cashbackPct = getCashbackPct(spent);
    const amount = Math.min(CASHBACK_DAILY_CAP, Math.floor(rawLoss * cashbackPct / 100));

    if (amount <= 0) {
      return json({
        ok: true,
        amount: 0,
        last_cashback: casinoRow?.last_cashback || null,
        logged: true,
      });
    }

    const nextCoins = (Number(casinoRow?.coins || 1000) || 1000) + amount;
    const nextSpent = spent;
    const last_daily = casinoRow?.last_daily || null;
    const last_cashback = now.toISOString();

    const { error: upsertError } = await sb.from("casino").upsert({
      code,
      name: casinoRow?.name || participant.name || "",
      coins: nextCoins,
      spent: nextSpent,
      last_daily,
      last_cashback,
    }, { onConflict: "code" });

    if (upsertError) return json({ ok: false, error: upsertError.message }, 500);

    const { error: logError } = await sb.from("casino_events").insert({
      code,
      game: "system",
      event_type: "bonus",
      bet: 0,
      payout: amount,
      delta: amount,
      meta: {
        source: "daily_cashback",
        cashback_percent: cashbackPct,
        based_on_loss: rawLoss,
        capped_at: CASHBACK_DAILY_CAP,
      },
    });

    if (logError) {
      await restoreCasinoRow(code, participant.name || "", casinoRow || null);
      return json({ ok: false, error: logError.message }, 500);
    }

    return json({
      ok: true,
      amount,
      last_cashback,
      logged: true,
    });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      500,
    );
  }
});
