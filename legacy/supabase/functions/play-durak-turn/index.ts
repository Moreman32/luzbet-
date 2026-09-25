import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  canBeatDurakCard,
  hydrateDurakGame,
  maybeFinishDurakGame,
  maybeOpenBotAttack,
  pickBotDefenseCard,
  pickBotThrowInCard,
  refillDurakHands,
  removeDurakCard,
  sortDurakHand,
  toPublicDurakGame,
} from "../_shared/durak.ts";

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

const DURAK_PAYOUT_MULTIPLIERS = {
  regular: 2.1,
  pro: 3.1,
} as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function getTableRanks(state: ReturnType<typeof hydrateDurakGame>): Set<string> {
  const ranks = new Set<string>();
  for (const pair of state.table_pairs) {
    if (pair.attack?.rank) ranks.add(pair.attack.rank);
    if (pair.defense?.rank) ranks.add(pair.defense.rank);
  }
  return ranks;
}

function allPairsDefended(state: ReturnType<typeof hydrateDurakGame>): boolean {
  return state.table_pairs.length > 0 && state.table_pairs.every((pair) => !!pair.defense);
}

function maxAttackCards(state: ReturnType<typeof hydrateDurakGame>): number {
  return Math.max(1, Math.min(6, state.bot_hand.length + state.table_pairs.filter((pair) => !!pair.defense).length));
}

function getPayoutMultiplier(state: ReturnType<typeof hydrateDurakGame>): number {
  return DURAK_PAYOUT_MULTIPLIERS[state.difficulty] ?? DURAK_PAYOUT_MULTIPLIERS.regular;
}

function maybeBotThrowInAfterPlayerDefense(state: ReturnType<typeof hydrateDurakGame>) {
  if (state.status !== "active") return state;
  if (state.attacker !== "bot") return state;
  if (!allPairsDefended(state)) return state;
  if (state.table_pairs.length >= maxAttackCards(state)) return state;

  const ranksOnTable = getTableRanks(state);
  const maxValue = undefined;
  const throwCard = pickBotThrowInCard({
    hand: state.bot_hand,
    trumpSuit: state.trump_suit,
    ranksOnTable,
    difficulty: state.difficulty,
    maxValue,
  });

  if (!throwCard) {
    return {
      ...state,
      turn_state: {
        phase: "resolve",
        can_take: false,
        can_pass: true,
        attack_count: state.table_pairs.length,
        notes: state.difficulty === "pro"
          ? "Казино пока не нашло добивающую карту. Можно закрыть розыгрыш кнопкой «Бито / завершить»."
          : "Казино закончило атаку. Можно закрыть розыгрыш кнопкой «Бито / завершить».",
      },
    };
  }

  return {
    ...state,
    bot_hand: sortDurakHand(removeDurakCard(state.bot_hand, throwCard.id).hand, state.trump_suit),
    table_pairs: [...state.table_pairs, { attack: throwCard, defense: null }],
    turn_state: {
      phase: "defense",
      can_take: true,
      can_pass: false,
      attack_count: state.table_pairs.length + 1,
      notes: state.difficulty === "pro"
        ? `Казино жёстко давит и подкинуло ${throwCard.rank}. Нужно снова отбиться или забрать.`
        : `Казино подкинуло ${throwCard.rank}. Нужно снова отбиться или забрать.`,
    },
  };
}

async function persistGame(state: ReturnType<typeof hydrateDurakGame>) {
  const payload = {
    status: state.status,
    winner: state.winner,
    attacker: state.attacker,
    defender: state.defender,
    talon: state.talon,
    player_hand: state.player_hand,
    bot_hand: state.bot_hand,
    table_pairs: state.table_pairs,
    discard_pile: state.discard_pile,
    turn_state: state.turn_state,
    finished_at: state.status === "finished" ? new Date().toISOString() : null,
  };

  const { error } = await sb
    .from("casino_durak_games")
    .update(payload)
    .eq("game_id", state.game_id);

  return error;
}

async function settleFinishedGame(state: ReturnType<typeof hydrateDurakGame>) {
  const payout = state.winner === "player" ? Math.round(state.bet * getPayoutMultiplier(state)) : 0;

  const { data: round, error: roundError } = await sb
    .from("casino_rounds")
    .select("status, game, bet, meta")
    .eq("round_id", state.round_id)
    .maybeSingle();

  if (roundError) return { error: roundError.message, payout, coins: 0, spent: 0 };

  if (round?.status !== "finished") {
    const { data: casinoRow, error: casinoError } = await sb
      .from("casino")
      .select("coins, spent")
      .eq("code", state.code)
      .maybeSingle();

    if (casinoError) return { error: casinoError.message, payout, coins: 0, spent: 0 };

    const currentCoins = Math.max(0, Number(casinoRow?.coins ?? 0));
    const currentSpent = Math.max(0, Number(casinoRow?.spent ?? 0));
    const nextCoins = currentCoins + payout;
    const result = payout > state.bet ? "win" : payout === state.bet ? "push" : "loss";

    const finalMeta = {
      ...(round?.meta && typeof round.meta === "object" && !Array.isArray(round.meta) ? round.meta : {}),
      status: "finished",
      result,
      winner: state.winner,
      difficulty: state.difficulty,
      payout_multiplier: getPayoutMultiplier(state),
      durak_game_id: state.game_id,
    };

    const { error: casinoUpdateError } = await sb
      .from("casino")
      .update({ coins: nextCoins, spent: currentSpent })
      .eq("code", state.code);

    if (casinoUpdateError) return { error: casinoUpdateError.message, payout, coins: currentCoins, spent: currentSpent };

    const { error: roundUpdateError } = await sb
      .from("casino_rounds")
      .update({
        status: "finished",
        payout,
        meta: finalMeta,
        finished_at: new Date().toISOString(),
      })
      .eq("round_id", state.round_id);

    if (roundUpdateError) return { error: roundUpdateError.message, payout, coins: nextCoins, spent: currentSpent };

    const { error: eventError } = await sb
      .from("casino_events")
      .upsert({
        code: state.code,
        round_id: state.round_id,
        game: "durak",
        event_type: "round",
        bet: state.bet,
        payout,
        delta: payout - state.bet,
        meta: finalMeta,
      }, { onConflict: "round_id" });

    if (eventError) return { error: eventError.message, payout, coins: nextCoins, spent: currentSpent };

    return { error: null, payout, coins: nextCoins, spent: currentSpent };
  }

  const { data: casinoRow } = await sb
    .from("casino")
    .select("coins, spent")
    .eq("code", state.code)
    .maybeSingle();

  return {
    error: null,
    payout,
    coins: Math.max(0, Number(casinoRow?.coins ?? 0)),
    spent: Math.max(0, Number(casinoRow?.spent ?? 0)),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const code = String(body?.code || "").trim();
    const action = String(body?.action || "").trim();
    const round_id = String(body?.round_id || "").trim();
    const game_id = String(body?.game_id || "").trim();
    const card_id = String(body?.card_id || "").trim();
    const target_attack_id = String(body?.target_attack_id || "").trim();

    if (!code) return json({ ok: false, error: "code is required" }, 400);
    if (!action) return json({ ok: false, error: "action is required" }, 400);

    let query = sb.from("casino_durak_games").select("*").eq("code", code);
    if (game_id) query = query.eq("game_id", game_id);
    else if (round_id) query = query.eq("round_id", round_id);
    else query = query.eq("status", "active");

    const { data: row, error } = await query
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return json({ ok: false, error: error.message }, 500);
    if (!row) return json({ ok: false, error: "durak game not found" }, 404);

    let state = hydrateDurakGame(row as Record<string, unknown>);

    if (state.status !== "active") {
      const settled = await settleFinishedGame(state);
      return json({
        ok: true,
        duplicate: true,
        game: toPublicDurakGame(state),
        payout: settled.payout,
        coins: settled.coins,
        spent: settled.spent,
      });
    }

    if (action === "attack") {
      if (state.attacker !== "player" || state.turn_state.phase !== "attack") {
        return json({ ok: false, error: "player cannot attack now", game: toPublicDurakGame(state) }, 400);
      }

      const removed = removeDurakCard(state.player_hand, card_id);
      if (!removed.card) {
        return json({ ok: false, error: "card not found in hand", game: toPublicDurakGame(state) }, 400);
      }

      const isThrowIn = state.table_pairs.length > 0;
      const ranksOnTable = getTableRanks(state);

      if (isThrowIn) {
        if (!allPairsDefended(state)) {
          return json({ ok: false, error: "cannot throw in before defense is complete", game: toPublicDurakGame(state) }, 400);
        }
        if (!ranksOnTable.has(removed.card.rank)) {
          return json({ ok: false, error: "thrown card must match ranks on table", game: toPublicDurakGame(state) }, 400);
        }
        if (state.table_pairs.length >= maxAttackCards(state)) {
          return json({ ok: false, error: "attack limit reached", game: toPublicDurakGame(state) }, 400);
        }
      }

      state = {
        ...state,
        player_hand: sortDurakHand(removed.hand, state.trump_suit),
        table_pairs: [...state.table_pairs, { attack: removed.card, defense: null }],
        turn_state: {
          phase: "defense",
          can_take: false,
          can_pass: false,
          attack_count: state.table_pairs.length + 1,
          notes: isThrowIn
            ? "Подкинута ещё одна карта. Казино отвечает автоматически."
            : "Игрок атаковал. Казино отвечает автоматически.",
        },
      };

      const defenseCard = pickBotDefenseCard(removed.card, state.bot_hand, state.trump_suit);

      if (!defenseCard) {
        const tableCards = state.table_pairs.flatMap((pair) => pair.defense ? [pair.attack, pair.defense] : [pair.attack]);
        state = refillDurakHands({
          ...state,
          bot_hand: sortDurakHand([...state.bot_hand, ...tableCards], state.trump_suit),
          table_pairs: [],
          attacker: "player",
          defender: "bot",
          turn_state: {
            phase: "attack",
            can_take: false,
            can_pass: false,
            attack_count: 0,
            notes: "Казино не смогло отбиться и забрало карты. Можно атаковать снова.",
          },
        });
      } else {
        const nextBot = removeDurakCard(state.bot_hand, defenseCard.id).hand;
        state = {
          ...state,
          bot_hand: sortDurakHand(nextBot, state.trump_suit),
          table_pairs: state.table_pairs.map((pair) =>
            pair.attack.id === removed.card.id ? { ...pair, defense: defenseCard } : pair
          ),
          turn_state: {
            phase: "attack",
            can_take: false,
            can_pass: true,
            attack_count: state.table_pairs.length,
            notes: "Казино отбилось. Можно подкинуть карту того же ранга или завершить атаку.",
          },
        };
      }
    } else if (action === "defend") {
      const openPair = state.table_pairs.find((pair) => pair.attack.id === target_attack_id && !pair.defense);

      if (state.defender !== "player" || state.turn_state.phase !== "defense" || !openPair) {
        return json({ ok: false, error: "player cannot defend now", game: toPublicDurakGame(state) }, 400);
      }

      const removed = removeDurakCard(state.player_hand, card_id);
      if (!removed.card) {
        return json({ ok: false, error: "card not found in hand", game: toPublicDurakGame(state) }, 400);
      }

      if (!canBeatDurakCard(openPair.attack, removed.card, state.trump_suit)) {
        return json({ ok: false, error: "selected card cannot beat attack", game: toPublicDurakGame(state) }, 400);
      }

      state = {
        ...state,
        player_hand: sortDurakHand(removed.hand, state.trump_suit),
        table_pairs: state.table_pairs.map((pair) =>
          pair.attack.id === target_attack_id ? { ...pair, defense: removed.card } : pair
        ),
        turn_state: {
          phase: "resolve",
          can_take: false,
          can_pass: true,
          attack_count: state.table_pairs.length,
          notes: "Ты отбился. Казино решает, подкинуть ещё или закончить атаку.",
        },
      };
      state = maybeBotThrowInAfterPlayerDefense(state);
    } else if (action === "take") {
      const openCards = state.table_pairs.flatMap((pair) => pair.defense ? [pair.attack, pair.defense] : [pair.attack]);

      if (state.defender !== "player" || state.turn_state.phase !== "defense" || !openCards.length) {
        return json({ ok: false, error: "player cannot take now", game: toPublicDurakGame(state) }, 400);
      }

      state = refillDurakHands({
        ...state,
        attacker: "bot",
        defender: "player",
        player_hand: sortDurakHand([...state.player_hand, ...openCards], state.trump_suit),
        table_pairs: [],
        turn_state: {
          phase: "attack",
          can_take: false,
          can_pass: false,
          attack_count: 0,
          notes: "Игрок забрал карты. Бот снова атакует.",
        },
      });
      state = maybeOpenBotAttack(maybeFinishDurakGame(state));
    } else if (action === "pass") {
      if (state.attacker === "player" && state.turn_state.phase === "attack" && allPairsDefended(state)) {
        const tableCards = state.table_pairs.flatMap((pair) => [pair.attack, pair.defense!]);
        state = refillDurakHands({
          ...state,
          attacker: "bot",
          defender: "player",
          discard_pile: [...state.discard_pile, ...tableCards],
          table_pairs: [],
          turn_state: {
            phase: "attack",
            can_take: false,
            can_pass: false,
            attack_count: 0,
            notes: "Атака завершена. Ход переходит к казино.",
          },
        });
        state = maybeOpenBotAttack(maybeFinishDurakGame(state));
      } else if (state.defender === "player" && state.turn_state.phase === "resolve" && allPairsDefended(state)) {
        const tableCards = state.table_pairs.flatMap((pair) => [pair.attack, pair.defense!]);
        state = refillDurakHands({
          ...state,
          attacker: "player",
          defender: "bot",
          discard_pile: [...state.discard_pile, ...tableCards],
          table_pairs: [],
          turn_state: {
            phase: "attack",
            can_take: false,
            can_pass: false,
            attack_count: 0,
            notes: "Казино закончило давление. Теперь ты атакуешь.",
          },
        });
        state = maybeFinishDurakGame(state);
      } else {
        return json({ ok: false, error: "cannot pass now", game: toPublicDurakGame(state) }, 400);
      }
    } else if (action === "surrender") {
      state = {
        ...state,
        status: "finished",
        winner: "bot",
        turn_state: {
          ...state.turn_state,
          notes: "Игрок сдался.",
        },
      };
    } else {
      return json({ ok: false, error: "unknown durak action" }, 400);
    }

    state = maybeFinishDurakGame(state);

    const persistError = await persistGame(state);
    if (persistError) return json({ ok: false, error: persistError.message }, 500);

    if (state.status === "finished") {
      const settled = await settleFinishedGame(state);
      if (settled.error) return json({ ok: false, error: settled.error }, 500);

      return json({
        ok: true,
        finished: true,
        payout: settled.payout,
        coins: settled.coins,
        spent: settled.spent,
        game: toPublicDurakGame(state),
      });
    }

    const { data: casinoRow } = await sb
      .from("casino")
      .select("coins, spent")
      .eq("code", code)
      .maybeSingle();

    return json({
      ok: true,
      game: toPublicDurakGame(state),
      coins: Math.max(0, Number(casinoRow?.coins ?? 0)),
      spent: Math.max(0, Number(casinoRow?.spent ?? 0)),
    });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "play-durak-turn failed" },
      500,
    );
  }
});
