import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hydratePvpBlackjackRoom, toPublicPvpBlackjackRoom } from "../_shared/pvp-blackjack.ts";

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

    const [{ data: waitingRows, error: waitingError }, { data: mineRows, error: mineError }] = await Promise.all([
      sb
        .from("casino_pvp_blackjack_rooms")
        .select("*")
        .eq("status", "waiting")
        .order("created_at", { ascending: false })
        .limit(30),
      code
        ? sb
          .from("casino_pvp_blackjack_rooms")
          .select("*")
          .or(`host_code.eq.${code},guest_code.eq.${code}`)
          .in("status", ["waiting", "active", "finished"])
          .order("updated_at", { ascending: false })
          .limit(10)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (waitingError) return json({ ok: false, error: waitingError.message }, 500);
    if (mineError) return json({ ok: false, error: mineError.message }, 500);

    const waiting = (waitingRows || [])
      .map((row) => hydratePvpBlackjackRoom(row as Record<string, unknown>))
      .filter((room) => room.host_code !== code)
      .map((room) => toPublicPvpBlackjackRoom(room, code));

    const mine = (mineRows || [])
      .map((row) => hydratePvpBlackjackRoom(row as Record<string, unknown>))
      .map((room) => toPublicPvpBlackjackRoom(room, code));

    return json({ ok: true, waiting, mine });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "list-pvp-blackjack-rooms failed" }, 500);
  }
});
