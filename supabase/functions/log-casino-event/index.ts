import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { guardRequest, json } from "../_shared/http-security.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ALLOWED_GAMES = new Set([
  "slots",
  "blackjack",
  "wheel",
  "keno",
  "scratch",
  "rps",
  "penalty",
  "offside",
  "var_challenge",
  "system",
  "dice",
  "crash",
  "higher_lower",
  "horse",
  "plinko",
  "mines",
  "tower",
  "coinflip",
  "durak",
]);

const ALLOWED_EVENT_TYPES = new Set(["round", "bonus"]);

function toInt(value: unknown, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

Deno.serve(async (req) => {
  const blocked = guardRequest(req, { requireProxy: true, maxBodyBytes: 8192 });
  if (blocked) return blocked;

  try {
    const body = await req.json().catch(() => ({}));

    const code = String(body?.code || "").trim();
    const round_id = String(body?.round_id || "").trim();
    const game = String(body?.game || "").trim();

    const eventTypeRaw = String(body?.event_type || "round").trim() || "round";
    const event_type = ALLOWED_EVENT_TYPES.has(eventTypeRaw) ? eventTypeRaw : "round";

    const bet = toInt(body?.bet, 0);
    const payout = toInt(body?.payout, 0);
    const delta = toInt(body?.delta, payout - bet);

    const meta =
      body?.meta && typeof body.meta === "object" && !Array.isArray(body.meta)
        ? body.meta
        : {};

    if (!code) {
      return json(req, { ok: false, error: "code is required" }, 400);
    }

    if (!game || !ALLOWED_GAMES.has(game)) {
      return json(req, { ok: false, error: "invalid game" }, 400);
    }

    if (bet < 0 || payout < 0) {
      return json(req, { ok: false, error: "bet and payout must be >= 0" }, 400);
    }

    const { data: participant, error: participantError } = await sb
      .from("participants")
      .select("code")
      .eq("code", code)
      .maybeSingle();

    if (participantError) {
      return json(req, { ok: false, error: participantError.message }, 500);
    }

    if (!participant) {
      return json(req, { ok: false, error: "participant not found" }, 404);
    }

    const payload: Record<string, unknown> = {
      code,
      game,
      event_type,
      bet,
      payout,
      delta,
      meta,
    };

    if (round_id) {
      payload.round_id = round_id;
    }

    if (round_id) {
      const { error: upsertError } = await sb
        .from("casino_events")
        .upsert(payload, {
          onConflict: "round_id",
        });

      if (upsertError) {
        return json(req, { ok: false, error: upsertError.message }, 500);
      }
    } else {
      const { error: insertError } = await sb
        .from("casino_events")
        .insert(payload);

      if (insertError) {
        return json(req, { ok: false, error: insertError.message }, 500);
      }
    }

    return json(req, { ok: true });
  } catch (e) {
    return json(
      req,
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      500,
    );
  }
});
