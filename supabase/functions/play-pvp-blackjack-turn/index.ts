import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  drawCard,
  hydratePvpBlackjackRoom,
  maybeFinishPvpBlackjack,
  toPublicPvpBlackjackRoom,
} from "../_shared/pvp-blackjack.ts";

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

async function settleRoom(room: ReturnType<typeof hydratePvpBlackjackRoom>) {
  const resolution = room.resolution && typeof room.resolution === "object" ? room.resolution as Record<string, unknown> : {};
  const payoutHost = Math.max(0, Number(resolution.payout_host ?? 0));
  const payoutGuest = Math.max(0, Number(resolution.payout_guest ?? 0));

  const [{ data: hostCasino }, { data: guestCasino }] = await Promise.all([
    sb.from("casino").select("coins, spent, name, last_daily, last_cashback").eq("code", room.host_code).maybeSingle(),
    room.guest_code ? sb.from("casino").select("coins, spent, name, last_daily, last_cashback").eq("code", room.guest_code).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  if (hostCasino) {
    await sb.from("casino").upsert({
      code: room.host_code,
      name: hostCasino.name || room.host_name,
      coins: Math.max(0, Number(hostCasino.coins ?? 0)) + payoutHost,
      spent: Math.max(0, Number(hostCasino.spent ?? 0)),
      last_daily: hostCasino.last_daily || null,
      last_cashback: hostCasino.last_cashback || null,
    }, { onConflict: "code" });
  }

  if (room.guest_code && guestCasino) {
    await sb.from("casino").upsert({
      code: room.guest_code,
      name: guestCasino.name || room.guest_name || "",
      coins: Math.max(0, Number(guestCasino.coins ?? 0)) + payoutGuest,
      spent: Math.max(0, Number(guestCasino.spent ?? 0)),
      last_daily: guestCasino.last_daily || null,
      last_cashback: guestCasino.last_cashback || null,
    }, { onConflict: "code" });
  }
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
      const { data: hostCasino } = await sb.from("casino").select("coins, spent, name, last_daily, last_cashback").eq("code", room.host_code).maybeSingle();
      if (hostCasino) {
        await sb.from("casino").upsert({
          code: room.host_code,
          name: hostCasino.name || room.host_name,
          coins: Math.max(0, Number(hostCasino.coins ?? 0)) + room.bet,
          spent: Math.max(0, Math.max(0, Number(hostCasino.spent ?? 0)) - room.bet),
          last_daily: hostCasino.last_daily || null,
          last_cashback: hostCasino.last_cashback || null,
        }, { onConflict: "code" });
      }
      const { error: cancelError } = await sb.from("casino_pvp_blackjack_rooms").update({ status: "cancelled", turn_code: null, finished_at: new Date().toISOString() }).eq("room_id", room_id);
      if (cancelError) return json({ ok: false, error: cancelError.message }, 500);
      return json({ ok: true, cancelled: true });
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

    const { error: updateError } = await sb
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
      .eq("room_id", room.room_id);

    if (updateError) return json({ ok: false, error: updateError.message }, 500);

    if (room.status === "finished") {
      await settleRoom(room);
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
