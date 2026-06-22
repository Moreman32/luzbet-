export type PvpChickenRoom = {
  room_id: string;
  host_code: string;
  host_name: string;
  guest_code: string | null;
  guest_name: string | null;
  bet: number;
  status: "waiting" | "active" | "finished" | "cancelled";
  winner_code: string | null;
  host_steps: number;
  guest_steps: number;
  host_stood: boolean;
  guest_stood: boolean;
  host_busted: boolean;
  guest_busted: boolean;
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

export function getChickenBustChance(currentSteps: number) {
  return Math.min(82, 12 + Math.max(0, toInt(currentSteps, 0)) * 11);
}

export function hydratePvpChickenRoom(row: Record<string, unknown>): PvpChickenRoom {
  return {
    room_id: String(row.room_id || ""),
    host_code: String(row.host_code || ""),
    host_name: String(row.host_name || ""),
    guest_code: row.guest_code ? String(row.guest_code) : null,
    guest_name: row.guest_name ? String(row.guest_name) : null,
    bet: Math.max(0, toInt(row.bet, 0)),
    status: String(row.status || "waiting") as PvpChickenRoom["status"],
    winner_code: row.winner_code ? String(row.winner_code) : null,
    host_steps: Math.max(0, toInt(row.host_steps, 0)),
    guest_steps: Math.max(0, toInt(row.guest_steps, 0)),
    host_stood: row.host_stood === true,
    guest_stood: row.guest_stood === true,
    host_busted: row.host_busted === true,
    guest_busted: row.guest_busted === true,
    resolution: asObject(row.resolution),
    created_at: row.created_at ? String(row.created_at) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null,
    accepted_at: row.accepted_at ? String(row.accepted_at) : null,
    finished_at: row.finished_at ? String(row.finished_at) : null,
    settled_at: row.settled_at ? String(row.settled_at) : null,
    cancel_refunded_at: row.cancel_refunded_at ? String(row.cancel_refunded_at) : null,
  };
}

export function pushPvpChicken(state: PvpChickenRoom, target: "host" | "guest") {
  const currentSteps = target === "host" ? state.host_steps : state.guest_steps;
  const bustChance = getChickenBustChance(currentSteps);
  const roll = Math.floor(Math.random() * 100) + 1;
  const busted = roll <= bustChance;

  if (target === "host") {
    return {
      roll,
      bustChance,
      state: busted
        ? { ...state, host_busted: true }
        : { ...state, host_steps: currentSteps + 1 },
    };
  }

  return {
    roll,
    bustChance,
    state: busted
      ? { ...state, guest_busted: true }
      : { ...state, guest_steps: currentSteps + 1 },
  };
}

export function resolvePvpChicken(state: PvpChickenRoom) {
  const hostDone = state.host_stood || state.host_busted;
  const guestDone = state.guest_stood || state.guest_busted;

  if (!hostDone || !guestDone) return state;

  let winnerCode: string | null = null;
  let result = "push";
  let payoutHost = state.bet;
  let payoutGuest = state.bet;

  if (state.host_busted && !state.guest_busted) {
    winnerCode = state.guest_code;
    result = "guest_win";
    payoutHost = 0;
    payoutGuest = state.bet * 2;
  } else if (!state.host_busted && state.guest_busted) {
    winnerCode = state.host_code;
    result = "host_win";
    payoutHost = state.bet * 2;
    payoutGuest = 0;
  } else if (state.host_steps > state.guest_steps) {
    winnerCode = state.host_code;
    result = "host_win";
    payoutHost = state.bet * 2;
    payoutGuest = 0;
  } else if (state.guest_steps > state.host_steps) {
    winnerCode = state.guest_code;
    result = "guest_win";
    payoutHost = 0;
    payoutGuest = state.bet * 2;
  } else if (state.host_busted && state.guest_busted) {
    result = "double_bust_push";
  }

  return {
    ...state,
    status: "finished" as const,
    winner_code: winnerCode,
    finished_at: new Date().toISOString(),
    resolution: {
      result,
      host_steps: state.host_steps,
      guest_steps: state.guest_steps,
      host_busted: state.host_busted,
      guest_busted: state.guest_busted,
      payout_host: payoutHost,
      payout_guest: payoutGuest,
    },
  };
}

export function maybeFinishPvpChicken(state: PvpChickenRoom) {
  if (state.host_busted || state.guest_busted || (state.host_stood && state.guest_stood)) {
    const forced = {
      ...state,
      host_stood: state.host_stood || state.host_busted,
      guest_stood: state.guest_stood || state.guest_busted,
    };
    return resolvePvpChicken(forced);
  }
  return state;
}

export function toPublicPvpChickenRoom(state: PvpChickenRoom, viewerCode = "") {
  const myRole = viewerCode === state.host_code ? "host" : viewerCode === state.guest_code ? "guest" : "";
  const revealAll = state.status === "finished";
  const myCanPush = state.status === "active" && (
    (myRole === "host" && !state.host_stood && !state.host_busted) ||
    (myRole === "guest" && !state.guest_stood && !state.guest_busted)
  );
  const showHostProgress = revealAll || myRole === "host";
  const showGuestProgress = revealAll || myRole === "guest";
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
    my_can_push: myCanPush,
    my_can_stand: myCanPush,
    host: {
      code: state.host_code,
      name: state.host_name,
      steps: showHostProgress ? state.host_steps : null,
      stood: state.host_stood,
      busted: state.host_busted,
      next_bust_chance: showHostProgress ? getChickenBustChance(state.host_steps) : null,
      hidden_progress: !showHostProgress,
    },
    guest: {
      code: state.guest_code,
      name: state.guest_name,
      steps: showGuestProgress ? state.guest_steps : null,
      stood: state.guest_stood,
      busted: state.guest_busted,
      next_bust_chance: showGuestProgress ? getChickenBustChance(state.guest_steps) : null,
      hidden_progress: !showGuestProgress,
    },
    resolution: state.resolution,
    created_at: state.created_at || null,
    updated_at: state.updated_at || null,
    accepted_at: state.accepted_at || null,
    finished_at: state.finished_at || null,
  };
}
