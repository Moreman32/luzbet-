type CasinoEventRow = {
  id?: number | string | null;
  code?: string | null;
  game?: string | null;
  event_type?: string | null;
  bet?: number | string | null;
  payout?: number | string | null;
  delta?: number | string | null;
  created_at?: string | null;
  round_id?: string | null;
  meta?: Record<string, unknown> | null;
};

function eventId(row: CasinoEventRow) {
  return Number(row?.id || 0);
}

function eventStatus(row: CasinoEventRow) {
  return String(row?.meta?.status || "");
}

function eventSource(row: CasinoEventRow) {
  return String(row?.meta?.source || "");
}

function isAdministrativeCasinoSource(row: CasinoEventRow) {
  const source = eventSource(row);
  return (
    source === "balance_reconciliation" ||
    source === "balance_reconciliation_redistributed" ||
    source === "profit_shift_to_crash"
  );
}

function eventRoundKey(row: CasinoEventRow) {
  const code = String(row?.code || "").trim().toLowerCase();
  const roundId = String(row?.round_id || "").trim();
  if (!code || !roundId) return "";
  return `${code}|${roundId}`;
}

function isFinished(row: CasinoEventRow) {
  return eventStatus(row) === "finished";
}

function isStarted(row: CasinoEventRow) {
  return eventStatus(row) === "started";
}

function pickCanonicalRoundEvent(current: CasinoEventRow | undefined, next: CasinoEventRow) {
  if (!current) return next;

  const currentFinished = isFinished(current);
  const nextFinished = isFinished(next);

  if (currentFinished !== nextFinished) {
    return nextFinished ? next : current;
  }

  return eventId(next) >= eventId(current) ? next : current;
}

export function canonicalizeCasinoEvents(rows: CasinoEventRow[]) {
  const standalone: CasinoEventRow[] = [];
  const rounds = new Map<string, CasinoEventRow>();

  for (const row of rows) {
    const roundKey = eventRoundKey(row);
    if (!roundKey) {
      standalone.push(row);
      continue;
    }

    rounds.set(roundKey, pickCanonicalRoundEvent(rounds.get(roundKey), row));
  }

  return [...standalone, ...rounds.values()].sort((a, b) => {
    const createdCmp = String(a.created_at || "").localeCompare(String(b.created_at || ""));
    if (createdCmp !== 0) return createdCmp;
    return eventId(a) - eventId(b);
  });
}

export function isGameplayCasinoEvent(row: CasinoEventRow) {
  if (String(row?.event_type || "") !== "round") return false;
  if (String(row?.game || "") === "system") return false;
  if (isAdministrativeCasinoSource(row)) return false;
  return true;
}

export function isFinishedGameplayCasinoEvent(row: CasinoEventRow) {
  return isGameplayCasinoEvent(row) && isFinished(row);
}

export function buildSpentMap(rows: CasinoEventRow[]) {
  const spentMap = new Map<string, number>();

  for (const row of canonicalizeCasinoEvents(rows)) {
    if (isAdministrativeCasinoSource(row)) continue;
    const key = String(row?.code || "").trim().toLowerCase();
    if (!key) continue;
    spentMap.set(key, (spentMap.get(key) || 0) + Number(row?.bet || 0));
  }

  return spentMap;
}

export async function fetchCasinoEvents(
  supabase: any,
  options: { since?: string; code?: string; pageSize?: number } = {},
) {
  const events: CasinoEventRow[] = [];
  const pageSize = Math.max(1, Math.min(5000, options.pageSize || 1000));
  let from = 0;

  while (true) {
    let query = supabase
      .from("casino_events")
      .select("id,code,game,event_type,bet,payout,delta,created_at,meta,round_id")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (options.since) {
      query = query.gte("created_at", options.since);
    }

    if (options.code) {
      query = query.eq("code", options.code);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];
    events.push(...rows);

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return canonicalizeCasinoEvents(events);
}

export function summarizeCasinoEvents(
  rows: CasinoEventRow[],
  options: { days: number; timeZone: string },
) {
  function dayKey(ts: string) {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: options.timeZone,
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

  function finalizeBucket<T extends Record<string, number | string>>(bucket: T): T {
    bucket.win_rate = bucket.games_count
      ? (Number(bucket.wins_count) / Number(bucket.games_count)) * 100
      : 0;

    bucket.rtp = bucket.bet_sum
      ? (Number(bucket.payout_sum) / Number(bucket.bet_sum)) * 100
      : 0;

    return bucket;
  }

  const byDay: Record<string, ReturnType<typeof emptyBucket> & { day: string }> = {};
  const byGame: Record<string, ReturnType<typeof emptyBucket> & { game: string }> = {};
  const summary = emptyBucket();

  for (let i = 0; i < options.days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = dayKey(d.toISOString());
    byDay[key] = emptyBucket({ day: key }) as ReturnType<typeof emptyBucket> & { day: string };
  }

  for (const row of rows) {
    if (!isFinishedGameplayCasinoEvent(row)) continue;

    const createdAt = String(row.created_at || "");
    if (!createdAt) continue;

    const day = dayKey(createdAt);
    const gameKey = String(row.game || "unknown");

    if (!byDay[day]) {
      byDay[day] = emptyBucket({ day }) as ReturnType<typeof emptyBucket> & { day: string };
    }

    if (!byGame[gameKey]) {
      byGame[gameKey] = emptyBucket({ game: gameKey }) as ReturnType<typeof emptyBucket> & {
        game: string;
      };
    }

    const bet = Number(row.bet || 0);
    const payout = Number(row.payout || 0);
    const delta = Number(row.delta || 0);

    for (const bucket of [summary, byDay[day], byGame[gameKey]]) {
      bucket.games_count += 1;
      bucket.bet_sum += bet;
      bucket.payout_sum += payout;
      bucket.net_sum += delta;

      if (delta > 0) bucket.wins_count += 1;
      else if (delta < 0) bucket.losses_count += 1;
      else bucket.pushes_count += 1;
    }
  }

  const days = Object.values(byDay)
    .sort((a, b) => b.day.localeCompare(a.day))
    .map((bucket) => finalizeBucket(bucket));

  const perGame = Object.values(byGame)
    .sort((a, b) => b.bet_sum - a.bet_sum || a.game.localeCompare(b.game))
    .map((bucket) => finalizeBucket(bucket));

  const todayKey = dayKey(new Date().toISOString());
  const today =
    days.find((bucket) => bucket.day === todayKey) ||
    finalizeBucket(emptyBucket({ day: todayKey }));

  return {
    summary: today,
    overall: finalizeBucket(summary),
    days,
    per_game: perGame,
  };
}
