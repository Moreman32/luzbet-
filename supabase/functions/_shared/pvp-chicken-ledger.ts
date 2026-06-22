import type { PvpChickenRoom } from "./pvp-chicken.ts";

function toInt(value: unknown, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

export async function ensurePvpChickenRoomLedger(sb: any, room: PvpChickenRoom) {
  if (!room || !room.room_id) return false;

  if (room.status === "finished" && !room.settled_at) {
    const resolution = room.resolution && typeof room.resolution === "object"
      ? room.resolution as Record<string, unknown>
      : {};
    const { data, error } = await sb.rpc("apply_pvp_chicken_finish", {
      p_room_id: room.room_id,
      p_host_code: room.host_code,
      p_host_name: room.host_name || "",
      p_guest_code: room.guest_code || "",
      p_guest_name: room.guest_name || "",
      p_payout_host: Math.max(0, toInt(resolution.payout_host, 0)),
      p_payout_guest: Math.max(0, toInt(resolution.payout_guest, 0)),
    });
    if (error) throw new Error(error.message);
    return data === true;
  }

  if (room.status === "cancelled" && !room.cancel_refunded_at) {
    const { data, error } = await sb.rpc("apply_pvp_chicken_cancel_refund", {
      p_room_id: room.room_id,
      p_host_code: room.host_code,
      p_host_name: room.host_name || "",
      p_bet: Math.max(0, toInt(room.bet, 0)),
    });
    if (error) throw new Error(error.message);
    return data === true;
  }

  return false;
}
