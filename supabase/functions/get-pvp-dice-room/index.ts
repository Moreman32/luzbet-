import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hydratePvpDiceRoom, toPublicPvpDiceRoom } from "../_shared/pvp-dice.ts";
import { ensurePvpDiceRoomLedger } from "../_shared/pvp-dice-ledger.ts";

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

    let query = sb.from("casino_pvp_dice_rooms").select("*").or(`host_code.eq.${code},guest_code.eq.${code}`);
    if (room_id) query = query.eq("room_id", room_id);
    else query = query.in("status", ["waiting", "active", "finished"]);

    const { data: row, error } = await query.order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!row) return json({ ok: false, error: "pvp dice room not found" }, 404);

    const room = hydratePvpDiceRoom(row as Record<string, unknown>);
    if (room.status === "finished" || room.status === "cancelled") {
      await ensurePvpDiceRoomLedger(sb, room);
    }
    const { data: casinoRow, error: casinoError } = await sb.from("casino").select("coins, spent").eq("code", code).maybeSingle();
    if (casinoError) return json({ ok: false, error: casinoError.message }, 500);
    return json({
      ok: true,
      room: toPublicPvpDiceRoom(room, code),
      coins: Math.max(0, Number(casinoRow?.coins ?? 0)),
      spent: Math.max(0, Number(casinoRow?.spent ?? 0)),
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "get-pvp-dice-room failed" }, 500);
  }
});
