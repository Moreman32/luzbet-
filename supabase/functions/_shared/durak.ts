export const DURAK_SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;
export const DURAK_RANKS = ["6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;

export type DurakSuit = (typeof DURAK_SUITS)[number];
export type DurakRank = (typeof DURAK_RANKS)[number];
export type DurakDifficulty = "regular" | "pro";
export type DurakSide = "player" | "bot";
export type DurakStatus = "active" | "finished" | "abandoned";

export interface DurakCard {
  id: string;
  suit: DurakSuit;
  rank: DurakRank;
  value: number;
}

export interface DurakTablePair {
  attack: DurakCard;
  defense: DurakCard | null;
}

export interface DurakTurnState {
  phase: "attack" | "defense" | "resolve";
  can_take: boolean;
  can_pass: boolean;
  attack_count: number;
  notes: string;
}

export interface DurakGameState {
  game_id: string;
  round_id: string;
  code: string;
  status: DurakStatus;
  difficulty: DurakDifficulty;
  bet: number;
  winner: DurakSide | null;
  trump_suit: DurakSuit;
  attacker: DurakSide;
  defender: DurakSide;
  talon: DurakCard[];
  player_hand: DurakCard[];
  bot_hand: DurakCard[];
  table_pairs: DurakTablePair[];
  discard_pile: DurakCard[];
  turn_state: DurakTurnState;
}

export interface PublicDurakGameState {
  game_id: string;
  round_id: string;
  code: string;
  status: DurakStatus;
  difficulty: DurakDifficulty;
  bet: number;
  winner: DurakSide | null;
  trump_suit: DurakSuit;
  trump_card: DurakCard | null;
  attacker: DurakSide;
  defender: DurakSide;
  talon_count: number;
  player_hand: DurakCard[];
  bot_hand: DurakCard[];
  bot_hand_count: number;
  table_pairs: DurakTablePair[];
  discard_pile: DurakCard[];
  turn_state: DurakTurnState;
}

const DURAK_RANK_VALUES: Record<DurakRank, number> = {
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

export function createDurakDeck36(): DurakCard[] {
  const deck: DurakCard[] = [];

  for (const suit of DURAK_SUITS) {
    for (const rank of DURAK_RANKS) {
      deck.push({
        id: `${rank}_${suit}`,
        suit,
        rank,
        value: DURAK_RANK_VALUES[rank],
      });
    }
  }

  return deck;
}

export function shuffleDurakDeck(cards: DurakCard[], rng: () => number = Math.random): DurakCard[] {
  const deck = [...cards];

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

export function sortDurakHand(hand: DurakCard[], trumpSuit: DurakSuit): DurakCard[] {
  return [...hand].sort((a, b) => {
    const aTrump = a.suit === trumpSuit ? 1 : 0;
    const bTrump = b.suit === trumpSuit ? 1 : 0;

    if (aTrump !== bTrump) return aTrump - bTrump;
    if (a.value !== b.value) return a.value - b.value;
    return a.suit.localeCompare(b.suit);
  });
}

function lowestTrumpValue(hand: DurakCard[], trumpSuit: DurakSuit): number | null {
  const trumps = hand.filter((card) => card.suit === trumpSuit).sort((a, b) => a.value - b.value);
  return trumps.length ? trumps[0].value : null;
}

export function chooseFirstAttacker(
  playerHand: DurakCard[],
  botHand: DurakCard[],
  trumpSuit: DurakSuit,
): DurakSide {
  const playerTrump = lowestTrumpValue(playerHand, trumpSuit);
  const botTrump = lowestTrumpValue(botHand, trumpSuit);

  if (playerTrump !== null && botTrump !== null) {
    return playerTrump <= botTrump ? "player" : "bot";
  }

  if (playerTrump !== null) return "player";
  if (botTrump !== null) return "bot";

  const lowestPlayer = [...playerHand].sort((a, b) => a.value - b.value)[0]?.value ?? 99;
  const lowestBot = [...botHand].sort((a, b) => a.value - b.value)[0]?.value ?? 99;
  return lowestPlayer <= lowestBot ? "player" : "bot";
}

export function dealInitialDurakGame(params: {
  gameId: string;
  roundId: string;
  code: string;
  bet: number;
  difficulty: DurakDifficulty;
  rng?: () => number;
}): DurakGameState {
  const shuffled = shuffleDurakDeck(createDurakDeck36(), params.rng);
  const playerHand = shuffled.slice(0, 6);
  const botHand = shuffled.slice(6, 12);
  const talon = shuffled.slice(12);
  const trumpSuit = talon[talon.length - 1]?.suit ?? "spades";
  const attacker = chooseFirstAttacker(playerHand, botHand, trumpSuit);
  const defender: DurakSide = attacker === "player" ? "bot" : "player";

  return {
    game_id: params.gameId,
    round_id: params.roundId,
    code: params.code,
    status: "active",
    difficulty: params.difficulty,
    bet: params.bet,
    winner: null,
    trump_suit: trumpSuit,
    attacker,
    defender,
    talon,
    player_hand: sortDurakHand(playerHand, trumpSuit),
    bot_hand: sortDurakHand(botHand, trumpSuit),
    table_pairs: [],
    discard_pile: [],
    turn_state: {
      phase: attacker === "player" ? "attack" : "defense",
      can_take: false,
      can_pass: false,
      attack_count: 0,
      notes: "MVP foundation: state is ready for server-validated turn flow.",
    },
  };
}

export function pickBotAttackCard(
  hand: DurakCard[],
  trumpSuit: DurakSuit,
  difficulty: DurakDifficulty,
): DurakCard | null {
  if (!hand.length) return null;

  const sorted = sortDurakHand(hand, trumpSuit);
  const rankCounts = new Map<DurakRank, number>();
  for (const card of sorted) {
    rankCounts.set(card.rank, (rankCounts.get(card.rank) || 0) + 1);
  }

  if (difficulty === "pro") {
    return sorted.find((card) => card.suit !== trumpSuit && (rankCounts.get(card.rank) || 0) > 1) ??
      sorted.find((card) => (rankCounts.get(card.rank) || 0) > 1) ??
      sorted.find((card) => card.suit !== trumpSuit) ??
      sorted[0];
  }

  return sorted.find((card) => card.suit !== trumpSuit) ?? sorted[0];
}

export function pickBotDefenseCard(
  attackCard: DurakCard,
  hand: DurakCard[],
  trumpSuit: DurakSuit,
): DurakCard | null {
  const sameSuit = hand
    .filter((card) => card.suit === attackCard.suit && card.value > attackCard.value)
    .sort((a, b) => a.value - b.value);

  if (sameSuit.length) return sameSuit[0];

  if (attackCard.suit === trumpSuit) return null;

  const trumps = hand
    .filter((card) => card.suit === trumpSuit)
    .sort((a, b) => a.value - b.value);

  return trumps[0] ?? null;
}

export function pickBotThrowInCard(params: {
  hand: DurakCard[];
  trumpSuit: DurakSuit;
  ranksOnTable: Set<string>;
  difficulty: DurakDifficulty;
  maxValue?: number;
}): DurakCard | null {
  const candidates = sortDurakHand(
    params.hand.filter((card) =>
      params.ranksOnTable.has(card.rank) &&
      (params.maxValue == null || card.value <= params.maxValue)
    ),
    params.trumpSuit,
  );

  if (!candidates.length) return null;

  if (params.difficulty === "pro") {
    return candidates.find((card) => card.suit !== params.trumpSuit && card.value >= 9) ??
      candidates.find((card) => card.value >= 10) ??
      candidates.find((card) => card.suit !== params.trumpSuit) ??
      candidates[0];
  }

  if (params.difficulty === "regular") {
    return candidates.find((card) => card.suit !== params.trumpSuit) ??
      candidates[0];
  }

  return candidates[0];
}

export function removeDurakCard(hand: DurakCard[], cardId: string): {
  card: DurakCard | null;
  hand: DurakCard[];
} {
  const index = hand.findIndex((card) => card.id === cardId);

  if (index === -1) {
    return { card: null, hand: [...hand] };
  }

  return {
    card: hand[index],
    hand: hand.filter((_, itemIndex) => itemIndex !== index),
  };
}

export function canBeatDurakCard(
  attackCard: DurakCard,
  defenseCard: DurakCard,
  trumpSuit: DurakSuit,
): boolean {
  if (defenseCard.suit === attackCard.suit && defenseCard.value > attackCard.value) {
    return true;
  }

  return defenseCard.suit === trumpSuit && attackCard.suit !== trumpSuit;
}

function drawOne(talon: DurakCard[]): {
  card: DurakCard | null;
  talon: DurakCard[];
} {
  if (!talon.length) return { card: null, talon: [] };
  return {
    card: talon[0],
    talon: talon.slice(1),
  };
}

export function refillDurakHands(state: DurakGameState): DurakGameState {
  let nextTalon = [...state.talon];
  let nextPlayer = [...state.player_hand];
  let nextBot = [...state.bot_hand];
  const drawOrder: DurakSide[] = [state.attacker, state.defender];

  for (const side of drawOrder) {
    while ((side === "player" ? nextPlayer.length : nextBot.length) < 6 && nextTalon.length) {
      const drawn = drawOne(nextTalon);
      nextTalon = drawn.talon;
      if (!drawn.card) break;
      if (side === "player") nextPlayer.push(drawn.card);
      else nextBot.push(drawn.card);
    }
  }

  return {
    ...state,
    talon: nextTalon,
    player_hand: sortDurakHand(nextPlayer, state.trump_suit),
    bot_hand: sortDurakHand(nextBot, state.trump_suit),
  };
}

export function maybeFinishDurakGame(state: DurakGameState): DurakGameState {
  if (state.talon.length > 0) return state;

  if (!state.player_hand.length && !state.bot_hand.length) {
    return {
      ...state,
      status: "finished",
      winner: "player",
      turn_state: { ...state.turn_state, notes: "Ничья невозможна по правилам казино, партия засчитана игроку." },
    };
  }

  if (!state.player_hand.length) {
    return {
      ...state,
      status: "finished",
      winner: "player",
      turn_state: { ...state.turn_state, notes: "Игрок первым остался без карт и победил." },
    };
  }

  if (!state.bot_hand.length) {
    return {
      ...state,
      status: "finished",
      winner: "bot",
      turn_state: { ...state.turn_state, notes: "Бот первым остался без карт." },
    };
  }

  return state;
}

export function maybeOpenBotAttack(state: DurakGameState): DurakGameState {
  if (state.status !== "active") return state;
  if (state.attacker !== "bot") return state;
  if (state.table_pairs.length) return state;

  const attackCard = pickBotAttackCard(state.bot_hand, state.trump_suit, state.difficulty);
  if (!attackCard) {
    return maybeFinishDurakGame(state);
  }

  const nextBot = removeDurakCard(state.bot_hand, attackCard.id).hand;

  return {
    ...state,
    bot_hand: sortDurakHand(nextBot, state.trump_suit),
    table_pairs: [{ attack: attackCard, defense: null }],
    turn_state: {
      phase: "defense",
      can_take: true,
      can_pass: false,
      attack_count: 1,
      notes: "Бот атаковал. Нужно отбиться или забрать.",
    },
  };
}

function asCard(value: unknown): DurakCard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const card = value as Record<string, unknown>;
  const suit = DURAK_SUITS.find((item) => item === card.suit);
  const rank = DURAK_RANKS.find((item) => item === card.rank);
  const rawValue = Number(card.value);

  if (!suit || !rank || !Number.isFinite(rawValue)) return null;

  return {
    id: String(card.id || `${rank}_${suit}`),
    suit,
    rank,
    value: Math.trunc(rawValue),
  };
}

function asCardArray(value: unknown): DurakCard[] {
  if (!Array.isArray(value)) return [];
  return value.map(asCard).filter((card): card is DurakCard => !!card);
}

function asTablePairs(value: unknown): DurakTablePair[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const pair = item as Record<string, unknown>;
      const attack = asCard(pair.attack);

      if (!attack) return null;

      return {
        attack,
        defense: asCard(pair.defense),
      };
    })
    .filter((pair): pair is DurakTablePair => !!pair);
}

function asTurnState(value: unknown, attacker: DurakSide): DurakTurnState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      phase: attacker === "player" ? "attack" : "defense",
      can_take: false,
      can_pass: false,
      attack_count: 0,
      notes: "",
    };
  }

  const turn = value as Record<string, unknown>;
  const phase = turn.phase === "attack" || turn.phase === "defense" || turn.phase === "resolve"
    ? turn.phase
    : attacker === "player"
    ? "attack"
    : "defense";

  return {
    phase,
    can_take: Boolean(turn.can_take),
    can_pass: Boolean(turn.can_pass),
    attack_count: Number.isFinite(Number(turn.attack_count)) ? Math.trunc(Number(turn.attack_count)) : 0,
    notes: String(turn.notes || ""),
  };
}

export function isDurakDifficulty(value: unknown): value is DurakDifficulty {
  return value === "regular" || value === "pro";
}

export function hydrateDurakGame(row: Record<string, unknown>): DurakGameState {
  const trumpSuit = DURAK_SUITS.find((item) => item === row.trump_suit) ?? "spades";
  const attacker: DurakSide = row.attacker === "bot" ? "bot" : "player";
  const defender: DurakSide = row.defender === "player" ? "player" : "bot";
  const difficulty: DurakDifficulty = isDurakDifficulty(row.difficulty) ? row.difficulty : "regular";
  const status: DurakStatus = row.status === "finished" || row.status === "abandoned"
    ? row.status
    : "active";
  const winner: DurakSide | null = row.winner === "player" || row.winner === "bot" ? row.winner : null;

  return {
    game_id: String(row.game_id || ""),
    round_id: String(row.round_id || ""),
    code: String(row.code || ""),
    status,
    difficulty,
    bet: Math.max(0, Math.trunc(Number(row.bet || 0))),
    winner,
    trump_suit: trumpSuit,
    attacker,
    defender,
    talon: asCardArray(row.talon),
    player_hand: sortDurakHand(asCardArray(row.player_hand), trumpSuit),
    bot_hand: sortDurakHand(asCardArray(row.bot_hand), trumpSuit),
    table_pairs: asTablePairs(row.table_pairs),
    discard_pile: asCardArray(row.discard_pile),
    turn_state: asTurnState(row.turn_state, attacker),
  };
}

export function toPublicDurakGame(state: DurakGameState): PublicDurakGameState {
  const revealBotHand = state.status !== "active";
  const trumpCard = state.talon[state.talon.length - 1] ?? null;

  return {
    game_id: state.game_id,
    round_id: state.round_id,
    code: state.code,
    status: state.status,
    difficulty: state.difficulty,
    bet: state.bet,
    winner: state.winner,
    trump_suit: state.trump_suit,
    trump_card: trumpCard,
    attacker: state.attacker,
    defender: state.defender,
    talon_count: state.talon.length,
    player_hand: sortDurakHand(state.player_hand, state.trump_suit),
    bot_hand: revealBotHand ? sortDurakHand(state.bot_hand, state.trump_suit) : [],
    bot_hand_count: state.bot_hand.length,
    table_pairs: state.table_pairs,
    discard_pile: state.discard_pile,
    turn_state: state.turn_state,
  };
}
