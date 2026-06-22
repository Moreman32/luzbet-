export type PvpDiceRoom = {
  room_id: string;
  host_code: string;
  host_name: string;
  guest_code: string | null;
  guest_name: string | null;
  bet: number;
  status: "waiting" | "active" | "finished" | "cancelled";
  winner_code: string | null;
  host_roll: number | null;
  guest_roll: number | null;
  resolution: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
  accepted_at?: string | null;
  finished_at?: string | null;
  settled_at?: string | null;
  cancel_refunded_at?: string | null;
};

function toInt(value: unknown, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseRoll(value: unknown) {
  const n = toInt(value, 0);
  return n >= 1 && n <= 6 ? n : null;
}

export function hydratePvpDiceRoom(row: Record<string, unknown>): PvpDiceRoom {
  return {
    room_id: String(row.room_id || ""),
    host_code: String(row.host_code || ""),
    host_name: String(row.host_name || ""),
    guest_code: row.guest_code ? String(row.guest_code) : null,
    guest_name: row.guest_name ? String(row.guest_name) : null,
    bet: Math.max(0, toInt(row.bet, 0)),
    status: String(row.status || "waiting") as PvpDiceRoom["status"],
    winner_code: row.winner_code ? String(row.winner_code) : null,
    host_roll: parseRoll(row.host_roll),
    guest_roll: parseRoll(row.guest_roll),
    resolution: asObject(row.resolution),
    created_at: row.created_at ? String(row.created_at) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null,
    accepted_at: row.accepted_at ? String(row.accepted_at) : null,
    finished_at: row.finished_at ? String(row.finished_at) : null,
    settled_at: row.settled_at ? String(row.settled_at) : null,
    cancel_refunded_at: row.cancel_refunded_at ? String(row.cancel_refunded_at) : null,
  };
}

export function rollPvpDice() {
  return Math.floor(Math.random() * 6) + 1;
}

export function resolvePvpDice(state: PvpDiceRoom) {
  const hostRoll = state.host_roll;
  const guestRoll = state.guest_roll;

  let winnerCode: string | null = null;
  let result = "push";
  let payoutHost = state.bet;
  let payoutGuest = state.bet;

  if (hostRoll !== null && guestRoll !== null) {
    if (hostRoll > guestRoll) {
      winnerCode = state.host_code;
      result = "host_win";
      payoutHost = state.bet * 2;
      payoutGuest = 0;
    } else if (guestRoll > hostRoll) {
      winnerCode = state.guest_code;
      result = "guest_win";
      payoutHost = 0;
      payoutGuest = state.bet * 2;
    }
  }

  return {
    ...state,
    status: "finished" as const,
    winner_code: winnerCode,
    finished_at: new Date().toISOString(),
    resolution: {
      result,
      host_roll: hostRoll,
      guest_roll: guestRoll,
      payout_host: payoutHost,
      payout_guest: payoutGuest,
    },
  };
}

export function maybeFinishPvpDice(state: PvpDiceRoom) {
  if (state.host_roll !== null && state.guest_roll !== null) return resolvePvpDice(state);
  return state;
}

export function toPublicPvpDiceRoom(state: PvpDiceRoom, viewerCode = "") {
  const myRole = viewerCode === state.host_code ? "host" : viewerCode === state.guest_code ? "guest" : "";
  const revealAll = state.status === "finished";
  const showHostRoll = revealAll || myRole === "host";
  const showGuestRoll = revealAll || myRole === "guest";
  const myCanRoll = state.status === "active" && (
    (myRole === "host" && state.host_roll === null) ||
    (myRole === "guest" && state.guest_roll === null)
  );
  return {
    room_id: state.room_id,
    status: state.status,
    bet: state.bet,
    host_code: state.host_code,
    host_name: state.host_name,
    guest_code: state.guest_code,
    guest_name: state.guest_name,
    winner_code: state.winner_code,
    winner_name: state.winner_code === state.host_code
      ? state.host_name
      : state.winner_code === state.guest_code
        ? state.guest_name
        : "",
    my_role: myRole,
    my_can_roll: myCanRoll,
    host: {
      code: state.host_code,
      name: state.host_name,
      roll: showHostRoll ? state.host_roll : null,
      rolled: state.host_roll !== null,
      hidden: !showHostRoll && state.host_roll !== null,
    },
    guest: {
      code: state.guest_code,
      name: state.guest_name,
      roll: showGuestRoll ? state.guest_roll : null,
      rolled: state.guest_roll !== null,
      hidden: !showGuestRoll && state.guest_roll !== null,
    },
    resolution: state.resolution,
    created_at: state.created_at || null,
    updated_at: state.updated_at || null,
    accepted_at: state.accepted_at || null,
    finished_at: state.finished_at || null,
  };
}
