export type PvpBlackjackCard = {
  s: string;
  v: string;
};

export type PvpBlackjackRoom = {
  room_id: string;
  host_code: string;
  host_name: string;
  guest_code: string | null;
  guest_name: string | null;
  bet: number;
  status: "waiting" | "active" | "finished" | "cancelled";
  turn_code: string | null;
  winner_code: string | null;
  deck: PvpBlackjackCard[];
  host_hand: PvpBlackjackCard[];
  guest_hand: PvpBlackjackCard[];
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

const SUITS = ["♠", "♥", "♦", "♣"] as const;
const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

function toInt(value: unknown, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function asCards(value: unknown): PvpBlackjackCard[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const s = String((item as Record<string, unknown>).s || "").trim();
    const v = String((item as Record<string, unknown>).v || "").trim();
    if (!s || !v) return [];
    return [{ s, v }];
  });
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function buildBlackjackDeck() {
  const deck: PvpBlackjackCard[] = [];
  for (const s of SUITS) {
    for (const v of VALUES) {
      deck.push({ s, v });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function bjValue(v: string) {
  if (v === "A") return 11;
  if (v === "J" || v === "Q" || v === "K") return 10;
  return toInt(v, 0);
}

export function bjScore(hand: PvpBlackjackCard[]) {
  let score = hand.reduce((sum, card) => sum + bjValue(card.v), 0);
  let aces = hand.filter((card) => card.v === "A").length;
  while (score > 21 && aces > 0) {
    score -= 10;
    aces -= 1;
  }
  return score;
}

export function hydratePvpBlackjackRoom(row: Record<string, unknown>): PvpBlackjackRoom {
  return {
    room_id: String(row.room_id || ""),
    host_code: String(row.host_code || ""),
    host_name: String(row.host_name || ""),
    guest_code: row.guest_code ? String(row.guest_code) : null,
    guest_name: row.guest_name ? String(row.guest_name) : null,
    bet: Math.max(0, toInt(row.bet, 0)),
    status: String(row.status || "waiting") as PvpBlackjackRoom["status"],
    turn_code: row.turn_code ? String(row.turn_code) : null,
    winner_code: row.winner_code ? String(row.winner_code) : null,
    deck: asCards(row.deck),
    host_hand: asCards(row.host_hand),
    guest_hand: asCards(row.guest_hand),
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

export function dealInitialPvpBlackjackRoom(params: {
  roomId: string;
  hostCode: string;
  hostName: string;
  guestCode: string;
  guestName: string;
  bet: number;
}) {
  const deck = buildBlackjackDeck();
  const hostHand = [deck.pop(), deck.pop()].filter(Boolean) as PvpBlackjackCard[];
  const guestHand = [deck.pop(), deck.pop()].filter(Boolean) as PvpBlackjackCard[];
  return {
    room_id: params.roomId,
    host_code: params.hostCode,
    host_name: params.hostName,
    guest_code: params.guestCode,
    guest_name: params.guestName,
    bet: params.bet,
    status: "active" as const,
    turn_code: params.hostCode,
    winner_code: null,
    deck,
    host_hand: hostHand,
    guest_hand: guestHand,
    host_stood: false,
    guest_stood: false,
    host_busted: bjScore(hostHand) > 21,
    guest_busted: bjScore(guestHand) > 21,
    resolution: {},
    accepted_at: new Date().toISOString(),
    finished_at: null,
  };
}

export function drawCard(state: PvpBlackjackRoom, target: "host" | "guest") {
  const nextDeck = [...state.deck];
  const card = nextDeck.pop() || null;
  if (!card) return { state, card: null };
  if (target === "host") {
    const hostHand = [...state.host_hand, card];
    return {
      card,
      state: {
        ...state,
        deck: nextDeck,
        host_hand: hostHand,
        host_busted: bjScore(hostHand) > 21,
      },
    };
  }
  const guestHand = [...state.guest_hand, card];
  return {
    card,
    state: {
      ...state,
      deck: nextDeck,
      guest_hand: guestHand,
      guest_busted: bjScore(guestHand) > 21,
    },
  };
}

export function resolvePvpBlackjack(state: PvpBlackjackRoom) {
  const hostScore = bjScore(state.host_hand);
  const guestScore = bjScore(state.guest_hand);
  const hostBust = hostScore > 21 || state.host_busted;
  const guestBust = guestScore > 21 || state.guest_busted;

  let winnerCode: string | null = null;
  let result = "push";
  let payoutHost = state.bet;
  let payoutGuest = state.bet;

  if (hostBust && guestBust) {
    result = "double_bust_push";
  } else if (hostBust && !guestBust) {
    winnerCode = state.guest_code;
    result = "guest_win";
    payoutHost = 0;
    payoutGuest = state.bet * 2;
  } else if (!hostBust && guestBust) {
    winnerCode = state.host_code;
    result = "host_win";
    payoutHost = state.bet * 2;
    payoutGuest = 0;
  } else if (hostScore > guestScore) {
    winnerCode = state.host_code;
    result = "host_win";
    payoutHost = state.bet * 2;
    payoutGuest = 0;
  } else if (guestScore > hostScore) {
    winnerCode = state.guest_code;
    result = "guest_win";
    payoutHost = 0;
    payoutGuest = state.bet * 2;
  }

  return {
    ...state,
    status: "finished" as const,
    turn_code: null,
    winner_code: winnerCode,
    finished_at: new Date().toISOString(),
    resolution: {
      result,
      host_score: hostScore,
      guest_score: guestScore,
      host_busted: hostBust,
      guest_busted: guestBust,
      payout_host: payoutHost,
      payout_guest: payoutGuest,
    },
  };
}

export function maybeFinishPvpBlackjack(state: PvpBlackjackRoom) {
  const hostDone = state.host_stood || state.host_busted;
  const guestDone = state.guest_stood || state.guest_busted;
  if (hostDone && guestDone) return resolvePvpBlackjack(state);
  return state;
}

export function toPublicPvpBlackjackRoom(state: PvpBlackjackRoom, viewerCode = "") {
  const hostScore = bjScore(state.host_hand);
  const guestScore = bjScore(state.guest_hand);
  const resolution = asObject(state.resolution);
  const myRole = viewerCode === state.host_code ? "host" : viewerCode === state.guest_code ? "guest" : "";
  const myTurn = !!viewerCode && state.turn_code === viewerCode;
  const revealAllCards = state.status === "finished";
  const showHostCards = revealAllCards || myRole === "host";
  const showGuestCards = revealAllCards || myRole === "guest";
  const hostVisibleState = revealAllCards || myRole === "host";
  const guestVisibleState = revealAllCards || myRole === "guest";
  return {
    room_id: state.room_id,
    status: state.status,
    bet: state.bet,
    host_code: state.host_code,
    host_name: state.host_name,
    guest_code: state.guest_code,
    guest_name: state.guest_name,
    turn_code: state.turn_code,
    turn_name: state.turn_code === state.host_code
      ? state.host_name
      : state.turn_code === state.guest_code
        ? state.guest_name
        : "",
    winner_code: state.winner_code,
    winner_name: state.winner_code === state.host_code
      ? state.host_name
      : state.winner_code === state.guest_code
        ? state.guest_name
        : "",
    my_role: myRole,
    my_turn: myTurn,
    host: {
      code: state.host_code,
      name: state.host_name,
      hand: showHostCards ? state.host_hand : Array.from({ length: state.host_hand.length }, () => ({ s: "?", v: "?" })),
      score: showHostCards ? hostScore : null,
      hidden: !showHostCards,
      stood: hostVisibleState ? state.host_stood : null,
      busted: hostVisibleState ? state.host_busted : null,
    },
    guest: {
      code: state.guest_code,
      name: state.guest_name,
      hand: showGuestCards ? state.guest_hand : Array.from({ length: state.guest_hand.length }, () => ({ s: "?", v: "?" })),
      score: showGuestCards ? guestScore : null,
      hidden: !showGuestCards,
      stood: guestVisibleState ? state.guest_stood : null,
      busted: guestVisibleState ? state.guest_busted : null,
    },
    resolution,
    created_at: state.created_at || null,
    updated_at: state.updated_at || null,
    accepted_at: state.accepted_at || null,
    finished_at: state.finished_at || null,
  };
}
