import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  drawCard,
  hydratePvpBlackjackRoom,
  maybeFinishPvpBlackjack,
  toPublicPvpBlackjackRoom,
} from "../_shared/pvp-blackjack.ts";
import { ensurePvpBlackjackRoomLedger } from "../_shared/pvp-blackjack-ledger.ts";

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
    const action = String(body?.action || "").trim();

    if (!code) return json({ ok: false, error: "code is required" }, 400);
    if (!room_id) return json({ ok: false, error: "room_id is required" }, 400);
    if (!["hit", "stand", "cancel"].includes(action)) return json({ ok: false, error: "bad action" }, 400);

    const { data: row, error } = await sb.from("casino_pvp_blackjack_rooms").select("*").eq("room_id", room_id).maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!row) return json({ ok: false, error: "room not found" }, 404);

    let room = hydratePvpBlackjackRoom(row as Record<string, unknown>);
    const isHost = room.host_code === code;
    const isGuest = room.guest_code === code;
    if (!isHost && !isGuest) return json({ ok: false, error: "forbidden" }, 403);

    if (action === "cancel") {
      if (room.status !== "waiting" || !isHost) return json({ ok: false, error: "cannot cancel room" }, 400);
      const { data: updatedRows, error: cancelError } = await sb
        .from("casino_pvp_blackjack_rooms")
        .update({ status: "cancelled", turn_code: null, finished_at: new Date().toISOString() })
        .eq("room_id", room_id)
        .eq("status", "waiting")
        .eq("host_code", code)
        .eq("updated_at", room.updated_at || "")
        .select("*")
        .limit(1);
      if (cancelError) return json({ ok: false, error: cancelError.message }, 500);
      if (!updatedRows || !updatedRows.length) {
        const { data: freshRow } = await sb.from("casino_pvp_blackjack_rooms").select("*").eq("room_id", room_id).maybeSingle();
        const freshRoom = freshRow ? hydratePvpBlackjackRoom(freshRow as Record<string, unknown>) : room;
        await ensurePvpBlackjackRoomLedger(sb, freshRoom);
        return json({ ok: false, error: "room state changed", room: toPublicPvpBlackjackRoom(freshRoom, code) }, 409);
      }
      room = hydratePvpBlackjackRoom(updatedRows[0] as Record<string, unknown>);
      await ensurePvpBlackjackRoomLedger(sb, room);
      const { data: casinoRow } = await sb.from("casino").select("coins, spent").eq("code", code).maybeSingle();
      return json({
        ok: true,
        cancelled: true,
        room: toPublicPvpBlackjackRoom(room, code),
        coins: Math.max(0, Number(casinoRow?.coins ?? 0)),
        spent: Math.max(0, Number(casinoRow?.spent ?? 0)),
      });
    }

    if (room.status === "finished" || room.status === "cancelled") {
      await ensurePvpBlackjackRoomLedger(sb, room);
      const { data: casinoRow } = await sb.from("casino").select("coins, spent").eq("code", code).maybeSingle();
      return json({
        ok: true,
        room: toPublicPvpBlackjackRoom(room, code),
        coins: Math.max(0, Number(casinoRow?.coins ?? 0)),
        spent: Math.max(0, Number(casinoRow?.spent ?? 0)),
      });
    }

    if (room.status !== "active") {
      return json({ ok: false, error: "room is not active", room: toPublicPvpBlackjackRoom(room, code) }, 400);
    }
    if (room.turn_code !== code) {
      return json({ ok: false, error: "not your turn", room: toPublicPvpBlackjackRoom(room, code) }, 400);
    }

    const target = isHost ? "host" : "guest";

    if (action === "hit") {
      const dealt = drawCard(room, target);
      room = dealt.state;
    } else if (action === "stand") {
      room = isHost ? { ...room, host_stood: true } : { ...room, guest_stood: true };
    }

    room = maybeFinishPvpBlackjack(room);

    if (room.status === "active") {
      room = {
        ...room,
        turn_code: isHost ? room.guest_code : room.host_code,
      };

      if ((room.turn_code === room.host_code && (room.host_stood || room.host_busted)) ||
          (room.turn_code === room.guest_code && (room.guest_stood || room.guest_busted))) {
        room = maybeFinishPvpBlackjack({
          ...room,
          turn_code: room.turn_code === room.host_code ? room.guest_code : room.host_code,
        });
      }
    }

    const { data: updatedRows, error: updateError } = await sb
      .from("casino_pvp_blackjack_rooms")
      .update({
        status: room.status,
        turn_code: room.turn_code,
        winner_code: room.winner_code,
        deck: room.deck,
        host_hand: room.host_hand,
        guest_hand: room.guest_hand,
        host_stood: room.host_stood,
        guest_stood: room.guest_stood,
        host_busted: room.host_busted,
        guest_busted: room.guest_busted,
        resolution: room.resolution,
        finished_at: room.finished_at,
      })
      .eq("room_id", room.room_id)
      .eq("status", "active")
      .eq("turn_code", code)
      .eq("updated_at", row.updated_at || "")
      .select("*")
      .limit(1);

    if (updateError) return json({ ok: false, error: updateError.message }, 500);
    if (!updatedRows || !updatedRows.length) {
      const { data: freshRow } = await sb.from("casino_pvp_blackjack_rooms").select("*").eq("room_id", room_id).maybeSingle();
      const freshRoom = freshRow ? hydratePvpBlackjackRoom(freshRow as Record<string, unknown>) : room;
      if (freshRoom.status === "finished" || freshRoom.status === "cancelled") {
        await ensurePvpBlackjackRoomLedger(sb, freshRoom);
      }
      return json({ ok: false, error: "room state changed", room: toPublicPvpBlackjackRoom(freshRoom, code) }, 409);
    }

    room = hydratePvpBlackjackRoom(updatedRows[0] as Record<string, unknown>);

    if (room.status === "finished") {
      await ensurePvpBlackjackRoomLedger(sb, room);
    }

    const { data: casinoRow } = await sb.from("casino").select("coins, spent").eq("code", code).maybeSingle();
    return json({
      ok: true,
      room: toPublicPvpBlackjackRoom(room, code),
      coins: Math.max(0, Number(casinoRow?.coins ?? 0)),
      spent: Math.max(0, Number(casinoRow?.spent ?? 0)),
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "play-pvp-blackjack-turn failed" }, 500);
  }
});
