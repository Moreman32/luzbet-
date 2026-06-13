import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  canBeatDurakCard,
  hydrateDurakGame,
  maybeFinishDurakGame,
  maybeOpenBotAttack,
  pickBotDefenseCard,
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

const DURAK_PAYOUT_MULTIPLIER = 2;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
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
  const payout = state.winner === "player" ? Math.round(state.bet * DURAK_PAYOUT_MULTIPLIER) : 0;

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
      if (state.attacker !== "player" || state.turn_state.phase !== "attack" || state.table_pairs.length) {
        return json({ ok: false, error: "player cannot attack now", game: toPublicDurakGame(state) }, 400);
      }

      const removed = removeDurakCard(state.player_hand, card_id);
      if (!removed.card) {
        return json({ ok: false, error: "card not found in hand", game: toPublicDurakGame(state) }, 400);
      }

      state = {
        ...state,
        player_hand: sortDurakHand(removed.hand, state.trump_suit),
        table_pairs: [{ attack: removed.card, defense: null }],
        turn_state: {
          phase: "defense",
          can_take: false,
          can_pass: false,
          attack_count: 1,
          notes: "Игрок атаковал. Бот отвечает автоматически.",
        },
      };

      const defenseCard = pickBotDefenseCard(removed.card, state.bot_hand, state.trump_suit);

      if (!defenseCard) {
        state = refillDurakHands({
          ...state,
          bot_hand: sortDurakHand([...state.bot_hand, removed.card], state.trump_suit),
          table_pairs: [],
          attacker: "player",
          defender: "bot",
          turn_state: {
            phase: "attack",
            can_take: false,
            can_pass: false,
            attack_count: 0,
            notes: "Бот забрал карту. Игрок снова атакует.",
          },
        });
      } else {
        const nextBot = removeDurakCard(state.bot_hand, defenseCard.id).hand;
        state = refillDurakHands({
          ...state,
          attacker: "bot",
          defender: "player",
          bot_hand: sortDurakHand(nextBot, state.trump_suit),
          discard_pile: [...state.discard_pile, removed.card, defenseCard],
          table_pairs: [],
          turn_state: {
            phase: "attack",
            can_take: false,
            can_pass: false,
            attack_count: 0,
            notes: "Бот отбился. Следующая атака за ботом.",
          },
        });
        state = maybeOpenBotAttack(maybeFinishDurakGame(state));
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

      state = refillDurakHands({
        ...state,
        attacker: "player",
        defender: "bot",
        player_hand: sortDurakHand(removed.hand, state.trump_suit),
        discard_pile: [...state.discard_pile, openPair.attack, removed.card],
        table_pairs: [],
        turn_state: {
          phase: "attack",
          can_take: false,
          can_pass: false,
          attack_count: 0,
          notes: "Игрок отбился и теперь атакует.",
        },
      });
      state = maybeFinishDurakGame(state);
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
