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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const code = String(body?.code || "").trim().toLowerCase();
    const room_id = String(body?.room_id || crypto.randomUUID()).trim();
    const bet = Math.max(0, toInt(body?.bet, 0));

    if (!code) return json({ ok: false, error: "code is required" }, 400);
    if (!room_id) return json({ ok: false, error: "room_id is required" }, 400);
    if (bet <= 0 || bet > 3000) return json({ ok: false, error: "bad bet" }, 400);

    const [{ data: participant, error: participantError }, { data: casinoRow, error: casinoError }, { data: existingRoom, error: roomError }] = await Promise.all([
      sb.from("participants").select("code, name").eq("code", code).maybeSingle(),
      sb.from("casino").select("code, name, coins, spent, last_daily, last_cashback").eq("code", code).maybeSingle(),
      sb.from("casino_pvp_dice_rooms").select("room_id, status").eq("host_code", code).in("status", ["waiting", "active"]).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

    if (participantError) return json({ ok: false, error: participantError.message }, 500);
    if (casinoError) return json({ ok: false, error: casinoError.message }, 500);
    if (roomError) return json({ ok: false, error: roomError.message }, 500);
    if (!participant) return json({ ok: false, error: "participant not found" }, 404);
    if (existingRoom) return json({ ok: false, error: "active room already exists", room_id: existingRoom.room_id }, 400);

    const currentCoins = Math.max(0, Number(casinoRow?.coins ?? 1000));
    const currentSpent = Math.max(0, Number(casinoRow?.spent ?? 0));
    if (currentCoins < bet) return json({ ok: false, error: "not enough coins", coins: currentCoins, spent: currentSpent }, 400);

    const nextCoins = currentCoins - bet;
    const nextSpent = currentSpent + bet;

    const { error: casinoUpdateError } = await sb
      .from("casino")
      .upsert({
        code,
        name: casinoRow?.name || participant.name || "",
        coins: nextCoins,
        spent: nextSpent,
        last_daily: casinoRow?.last_daily || null,
        last_cashback: casinoRow?.last_cashback || null,
      }, { onConflict: "code" });

    if (casinoUpdateError) return json({ ok: false, error: casinoUpdateError.message }, 500);

    const { error: insertError } = await sb
      .from("casino_pvp_dice_rooms")
      .insert({
        room_id,
        host_code: code,
        host_name: participant.name || "",
        bet,
        status: "waiting",
        resolution: { locked_host_bet: bet },
      });

    if (insertError) {
      await sb.from("casino").upsert({
        code,
        name: casinoRow?.name || participant.name || "",
        coins: currentCoins,
        spent: currentSpent,
        last_daily: casinoRow?.last_daily || null,
        last_cashback: casinoRow?.last_cashback || null,
      }, { onConflict: "code" });
      return json({ ok: false, error: insertError.message }, 500);
    }

    return json({ ok: true, room_id, status: "waiting", coins: nextCoins, spent: nextSpent });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "create-pvp-dice-room failed" }, 500);
  }
});
