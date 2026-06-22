import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hydratePvpChickenRoom, toPublicPvpChickenRoom } from "../_shared/pvp-chicken.ts";

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

    const [{ data: participant, error: participantError }, { data: roomRow, error: roomError }] = await Promise.all([
      sb.from("participants").select("code, name").eq("code", code).maybeSingle(),
      sb.from("casino_pvp_chicken_rooms").select("*").eq("room_id", room_id).maybeSingle(),
    ]);

    if (participantError) return json({ ok: false, error: participantError.message }, 500);
    if (roomError) return json({ ok: false, error: roomError.message }, 500);
    if (!participant) return json({ ok: false, error: "participant not found" }, 404);
    if (!roomRow) return json({ ok: false, error: "room not found" }, 404);

    const room = hydratePvpChickenRoom(roomRow as Record<string, unknown>);
    if (room.host_code === code) return json({ ok: false, error: "host cannot accept own room" }, 400);
    if (room.status !== "waiting") return json({ ok: false, error: "room is not waiting" }, 400);
    if (room.guest_code) return json({ ok: false, error: "room already taken" }, 400);

    const { data: claimedRoom, error: claimError } = await sb.rpc("claim_pvp_chicken_room", {
      p_room_id: room_id,
      p_guest_code: code,
      p_guest_name: participant.name || "",
      p_bet: room.bet,
      p_accepted_at: new Date().toISOString(),
    });
    if (claimError) {
      const message = claimError.message || "room already accepted";
      const status = /not enough coins|host cannot accept|room/i.test(message) ? 400 : 500;
      return json({ ok: false, error: message }, status);
    }

    const finalRoomRow = Array.isArray(claimedRoom) ? claimedRoom[0] : claimedRoom;
    if (!finalRoomRow) return json({ ok: false, error: "room claim returned empty result" }, 500);
    const finalRoom = hydratePvpChickenRoom(finalRoomRow as Record<string, unknown>);
    const { data: casinoRow, error: casinoError } = await sb.from("casino").select("coins, spent").eq("code", code).maybeSingle();
    if (casinoError) return json({ ok: false, error: casinoError.message }, 500);

    return json({
      ok: true,
      room: toPublicPvpChickenRoom(finalRoom, code),
      coins: Math.max(0, Number(casinoRow?.coins ?? 0)),
      spent: Math.max(0, Number(casinoRow?.spent ?? 0)),
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "accept-pvp-chicken-room failed" }, 500);
  }
});
