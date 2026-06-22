import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hydratePvpChickenRoom, maybeFinishPvpChicken, pushPvpChicken, toPublicPvpChickenRoom } from "../_shared/pvp-chicken.ts";
import { ensurePvpChickenRoomLedger } from "../_shared/pvp-chicken-ledger.ts";

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
    if (!["push", "stand", "cancel"].includes(action)) return json({ ok: false, error: "bad action" }, 400);

    const { data: row, error } = await sb.from("casino_pvp_chicken_rooms").select("*").eq("room_id", room_id).maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!row) return json({ ok: false, error: "room not found" }, 404);

    let room = hydratePvpChickenRoom(row as Record<string, unknown>);
    const isHost = room.host_code === code;
    const isGuest = room.guest_code === code;
    if (!isHost && !isGuest) return json({ ok: false, error: "forbidden" }, 403);

    if (action === "cancel") {
      if (room.status !== "waiting" || !isHost) return json({ ok: false, error: "cannot cancel room" }, 400);
      const { data: updatedRows, error: cancelError } = await sb
        .from("casino_pvp_chicken_rooms")
        .update({ status: "cancelled", finished_at: new Date().toISOString() })
        .eq("room_id", room_id)
        .eq("status", "waiting")
        .eq("host_code", code)
        .eq("updated_at", room.updated_at || "")
        .select("*")
        .limit(1);
      if (cancelError) return json({ ok: false, error: cancelError.message }, 500);
      if (!updatedRows || !updatedRows.length) {
        const { data: freshRow } = await sb.from("casino_pvp_chicken_rooms").select("*").eq("room_id", room_id).maybeSingle();
        const freshRoom = freshRow ? hydratePvpChickenRoom(freshRow as Record<string, unknown>) : room;
        await ensurePvpChickenRoomLedger(sb, freshRoom);
        return json({ ok: false, error: "room state changed", room: toPublicPvpChickenRoom(freshRoom, code) }, 409);
      }
      room = hydratePvpChickenRoom(updatedRows[0] as Record<string, unknown>);
      await ensurePvpChickenRoomLedger(sb, room);
      const { data: casinoRow } = await sb.from("casino").select("coins, spent").eq("code", code).maybeSingle();
      return json({
        ok: true,
        cancelled: true,
        room: toPublicPvpChickenRoom(room, code),
        coins: Math.max(0, Number(casinoRow?.coins ?? 0)),
        spent: Math.max(0, Number(casinoRow?.spent ?? 0)),
      });
    }

    if (room.status === "finished" || room.status === "cancelled") {
      await ensurePvpChickenRoomLedger(sb, room);
      const { data: casinoRow } = await sb.from("casino").select("coins, spent").eq("code", code).maybeSingle();
      return json({
        ok: true,
        room: toPublicPvpChickenRoom(room, code),
        coins: Math.max(0, Number(casinoRow?.coins ?? 0)),
        spent: Math.max(0, Number(casinoRow?.spent ?? 0)),
      });
    }

    if (room.status !== "active") return json({ ok: false, error: "room is not active", room: toPublicPvpChickenRoom(room, code) }, 400);

    const actorDone = isHost
      ? room.host_stood || room.host_busted
      : room.guest_stood || room.guest_busted;

    if (actorDone) {
      return json({ ok: false, error: "player already locked", room: toPublicPvpChickenRoom(room, code) }, 400);
    }

    if (action === "push") {
      room = pushPvpChicken(room, isHost ? "host" : "guest").state;
    } else if (action === "stand") {
      room = isHost ? { ...room, host_stood: true } : { ...room, guest_stood: true };
    }

    room = maybeFinishPvpChicken(room);

    const { data: updatedRows, error: updateError } = await sb
      .from("casino_pvp_chicken_rooms")
      .update({
        status: room.status,
        winner_code: room.winner_code,
        host_steps: room.host_steps,
        guest_steps: room.guest_steps,
        host_stood: room.host_stood,
        guest_stood: room.guest_stood,
        host_busted: room.host_busted,
        guest_busted: room.guest_busted,
        resolution: room.resolution,
        finished_at: room.finished_at,
      })
      .eq("room_id", room.room_id)
      .eq("status", "active")
      .eq("updated_at", row.updated_at || "")
      .select("*")
      .limit(1);

    if (updateError) return json({ ok: false, error: updateError.message }, 500);
    if (!updatedRows || !updatedRows.length) {
      const { data: freshRow } = await sb.from("casino_pvp_chicken_rooms").select("*").eq("room_id", room_id).maybeSingle();
      const freshRoom = freshRow ? hydratePvpChickenRoom(freshRow as Record<string, unknown>) : room;
      if (freshRoom.status === "finished" || freshRoom.status === "cancelled") {
        await ensurePvpChickenRoomLedger(sb, freshRoom);
      }
      return json({ ok: false, error: "room state changed", room: toPublicPvpChickenRoom(freshRoom, code) }, 409);
    }

    room = hydratePvpChickenRoom(updatedRows[0] as Record<string, unknown>);
    if (room.status === "finished") await ensurePvpChickenRoomLedger(sb, room);

    const { data: casinoRow } = await sb.from("casino").select("coins, spent").eq("code", code).maybeSingle();
    return json({
      ok: true,
      room: toPublicPvpChickenRoom(room, code),
      coins: Math.max(0, Number(casinoRow?.coins ?? 0)),
      spent: Math.max(0, Number(casinoRow?.spent ?? 0)),
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "play-pvp-chicken-turn failed" }, 500);
  }
});
