import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function mskDayKey(ts: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts));
}

function emptyBucket(base: Record<string, unknown> = {}) {
  return {
    ...base,
    games_count: 0,
    wins_count: 0,
    losses_count: 0,
    pushes_count: 0,
    bet_sum: 0,
    payout_sum: 0,
    net_sum: 0,
    win_rate: 0,
    rtp: 0,
  };
}

function finalizeBucket<T extends Record<string, any>>(bucket: T): T {
  bucket.win_rate = bucket.games_count
    ? (bucket.wins_count / bucket.games_count) * 100
    : 0;

  bucket.rtp = bucket.bet_sum
    ? (bucket.payout_sum / bucket.bet_sum) * 100
    : 0;

  return bucket;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const rawCode = String(body.code || "").trim();
    const days = Math.max(1, Math.min(30, parseInt(body.days ?? 1) || 1));

    if (!rawCode) {
      return Response.json(
        { ok: false, error: "Не передан code" },
        { headers: corsHeaders, status: 400 }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: participants, error: participantError } = await supabase
      .from("participants")
      .select("code")
      .ilike("code", rawCode)
      .limit(1);

    if (participantError) throw participantError;

    if (!participants || !participants.length) {
      return Response.json(
        { ok: false, error: "Код не найден" },
        { headers: corsHeaders, status: 404 }
      );
    }

    const canonicalCode = participants[0].code;

    const since = new Date();
    since.setDate(since.getDate() - (days - 1));
    since.setHours(0, 0, 0, 0);

    const events: any[] = [];
    let from = 0;
    const pageSize = 1000;

    while (true) {
      const { data, error } = await supabase
        .from("casino_events")
        .select("game,event_type,bet,payout,delta,created_at")
        .eq("code", canonicalCode)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1);

      if (error) throw error;

      events.push(...(data || []));

      if (!data || data.length < pageSize) break;

      from += pageSize;
    }

    const byDay: Record<string, ReturnType<typeof emptyBucket> & { day: string }> = {};
    const byGame: Record<string, ReturnType<typeof emptyBucket> & { game: string }> = {};

    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);

      const key = mskDayKey(d.toISOString());

      byDay[key] = emptyBucket({ day: key }) as ReturnType<typeof emptyBucket> & {
        day: string;
      };
    }

    const summary = emptyBucket();

    for (const ev of events || []) {
      const dayKey = mskDayKey(ev.created_at);

      if (!byDay[dayKey]) {
        byDay[dayKey] = emptyBucket({ day: dayKey }) as ReturnType<typeof emptyBucket> & {
          day: string;
        };
      }

      const gameKey = String(ev.game || "unknown");

      if (!byGame[gameKey]) {
        byGame[gameKey] = emptyBucket({ game: gameKey }) as ReturnType<typeof emptyBucket> & {
          game: string;
        };
      }

      const bet = Number(ev.bet || 0);
      const payout = Number(ev.payout || 0);
      const delta = Number(ev.delta || 0);
      const countsAsRound = bet > 0 && ev.event_type === "round";

      for (const bucket of [summary, byDay[dayKey], byGame[gameKey]]) {
        bucket.bet_sum += bet;
        bucket.payout_sum += payout;
        bucket.net_sum += delta;

        if (countsAsRound) {
          bucket.games_count += 1;

          if (delta > 0) bucket.wins_count += 1;
          else if (delta < 0) bucket.losses_count += 1;
          else bucket.pushes_count += 1;
        }
      }
    }

    finalizeBucket(summary);

    const daysOut = Object.values(byDay)
      .sort((a, b) => b.day.localeCompare(a.day))
      .map((day) => finalizeBucket(day));

    const perGameOut = Object.values(byGame)
      .sort((a, b) => b.bet_sum - a.bet_sum || a.game.localeCompare(b.game))
      .map((game) => finalizeBucket(game));

    const todayKey = mskDayKey(new Date().toISOString());

    const todaySummary =
      daysOut.find((d) => d.day === todayKey) ||
      finalizeBucket(emptyBucket({ day: todayKey }));

    return Response.json(
      {
        ok: true,
        summary: todaySummary,
        overall: summary,
        days: daysOut,
        per_game: perGameOut,
      },
      { headers: corsHeaders }
    );
  } catch (e) {
    return Response.json(
      {
        ok: false,
        error: e.message || "get-my-casino-stats failed",
      },
      { headers: corsHeaders, status: 500 }
    );
  }
});