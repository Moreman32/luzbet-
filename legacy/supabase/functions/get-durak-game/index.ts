import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hydrateDurakGame, maybeOpenBotAttack, toPublicDurakGame } from "../_shared/durak.ts";

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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const code = String(body?.code || "").trim();
    const round_id = String(body?.round_id || "").trim();
    const game_id = String(body?.game_id || "").trim();

    if (!code) {
      return json({ ok: false, error: "code is required" }, 400);
    }

    let query = sb
      .from("casino_durak_games")
      .select("*")
      .eq("code", code);

    if (game_id) {
      query = query.eq("game_id", game_id);
    } else if (round_id) {
      query = query.eq("round_id", round_id);
    } else {
      query = query.eq("status", "active");
    }

    const { data: row, error } = await query
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return json({ ok: false, error: error.message }, 500);
    }

    if (!row) {
      return json({ ok: false, error: "durak game not found" }, 404);
    }

    const [{ data: casinoRow, error: casinoError }, { data: roundRow, error: roundError }] = await Promise.all([
      sb
        .from("casino")
        .select("coins, spent")
        .eq("code", code)
        .maybeSingle(),
      sb
        .from("casino_rounds")
        .select("status, payout, finished_at")
        .eq("round_id", String(row.round_id))
        .maybeSingle(),
    ]);

    if (casinoError) {
      return json({ ok: false, error: casinoError.message }, 500);
    }

    if (roundError) {
      return json({ ok: false, error: roundError.message }, 500);
    }

    let game = hydrateDurakGame(row as Record<string, unknown>);

    if (game.status === "active" && game.attacker === "bot" && !game.table_pairs.length) {
      game = maybeOpenBotAttack(game);

      await sb
        .from("casino_durak_games")
        .update({
          bot_hand: game.bot_hand,
          table_pairs: game.table_pairs,
          turn_state: game.turn_state,
        })
        .eq("game_id", game.game_id);
    }

    return json({
      ok: true,
      game: toPublicDurakGame(game),
      round: roundRow
        ? {
          status: String(roundRow.status || ""),
          payout: Math.max(0, Number(roundRow.payout || 0)),
          finished_at: roundRow.finished_at || null,
        }
        : null,
      coins: Math.max(0, Number(casinoRow?.coins ?? 0)),
      spent: Math.max(0, Number(casinoRow?.spent ?? 0)),
    });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "get-durak-game failed" },
      500,
    );
  }
});
