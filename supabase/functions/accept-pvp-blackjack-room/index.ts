import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dealInitialPvpBlackjackRoom, hydratePvpBlackjackRoom, toPublicPvpBlackjackRoom } from "../_shared/pvp-blackjack.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const code = String(body?.code || "").trim().toLowerCase();
    const room_id = String(body?.room_id || "").trim();

    if (!code) return json({ ok: false, error: "code is required" }, 400);
    if (!room_id) return json({ ok: false, error: "room_id is required" }, 400);

    const [{ data: participant, error: participantError }, { data: casinoRow, error: casinoError }, { data: existingActive, error: activeError }, { data: roomRow, error: roomError }] = await Promise.all([
      sb.from("participants").select("code, name").eq("code", code).maybeSingle(),
      sb.from("casino").select("code, name, coins, spent, last_daily, last_cashback").eq("code", code).maybeSingle(),
      sb.from("casino_pvp_blackjack_rooms").select("room_id").or(`host_code.eq.${code},guest_code.eq.${code}`).in("status", ["waiting", "active"]).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("casino_pvp_blackjack_rooms").select("*").eq("room_id", room_id).maybeSingle(),
    ]);

    if (participantError) return json({ ok: false, error: participantError.message }, 500);
    if (casinoError) return json({ ok: false, error: casinoError.message }, 500);
    if (activeError) return json({ ok: false, error: activeError.message }, 500);
    if (roomError) return json({ ok: false, error: roomError.message }, 500);
    if (!participant) return json({ ok: false, error: "participant not found" }, 404);
    if (!roomRow) return json({ ok: false, error: "room not found" }, 404);
    if (existingActive && String(existingActive.room_id) !== room_id) return json({ ok: false, error: "you already have active room" }, 400);

    const room = hydratePvpBlackjackRoom(roomRow as Record<string, unknown>);
    if (room.host_code === code) return json({ ok: false, error: "host cannot accept own room" }, 400);
    if (room.status !== "waiting") return json({ ok: false, error: "room is not waiting" }, 400);
    if (room.guest_code) return json({ ok: false, error: "room already taken" }, 400);

    const currentCoins = Math.max(0, Number(casinoRow?.coins ?? 1000));
    const currentSpent = Math.max(0, Number(casinoRow?.spent ?? 0));
    if (currentCoins < room.bet) return json({ ok: false, error: "not enough coins", coins: currentCoins, spent: currentSpent }, 400);

    const nextCoins = currentCoins - room.bet;
    const nextSpent = currentSpent + room.bet;

    const { error: guestCasinoError } = await sb
      .from("casino")
      .upsert({
        code,
        name: casinoRow?.name || participant.name || "",
        coins: nextCoins,
        spent: nextSpent,
        last_daily: casinoRow?.last_daily || null,
        last_cashback: casinoRow?.last_cashback || null,
      }, { onConflict: "code" });

    if (guestCasinoError) return json({ ok: false, error: guestCasinoError.message }, 500);

    const activeRoom = dealInitialPvpBlackjackRoom({
      roomId: room.room_id,
      hostCode: room.host_code,
      hostName: room.host_name,
      guestCode: code,
      guestName: participant.name || "",
      bet: room.bet,
    });

    const { data: updatedRows, error: updateError } = await sb
      .from("casino_pvp_blackjack_rooms")
      .update({
        guest_code: activeRoom.guest_code,
        guest_name: activeRoom.guest_name,
        status: activeRoom.status,
        turn_code: activeRoom.turn_code,
        winner_code: activeRoom.winner_code,
        deck: activeRoom.deck,
        host_hand: activeRoom.host_hand,
        guest_hand: activeRoom.guest_hand,
        host_stood: activeRoom.host_stood,
        guest_stood: activeRoom.guest_stood,
        host_busted: activeRoom.host_busted,
        guest_busted: activeRoom.guest_busted,
        resolution: activeRoom.resolution,
        accepted_at: activeRoom.accepted_at,
      })
      .eq("room_id", room_id)
      .eq("status", "waiting")
      .is("guest_code", null)
      .select("*")
      .limit(1);

    if (updateError || !updatedRows || !updatedRows.length) {
      await sb.from("casino").upsert({
        code,
        name: casinoRow?.name || participant.name || "",
        coins: currentCoins,
        spent: currentSpent,
        last_daily: casinoRow?.last_daily || null,
        last_cashback: casinoRow?.last_cashback || null,
      }, { onConflict: "code" });
      return json({ ok: false, error: updateError?.message || "room already accepted" }, 400);
    }

    return json({
      ok: true,
      room: toPublicPvpBlackjackRoom(hydratePvpBlackjackRoom(updatedRows[0] as Record<string, unknown>), code),
      coins: nextCoins,
      spent: nextSpent,
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "accept-pvp-blackjack-room failed" }, 500);
  }
});
