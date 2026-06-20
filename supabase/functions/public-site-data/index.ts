import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const AUTOCLICKER_CODES = new Set<string>();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

function normalizeResultRow(row: any) {
  const d = row?.data || {};
  if (d && typeof d === "object" && Array.isArray(d.rounds)) {
    return normalizePlayoffRow(row);
  }
  if (Array.isArray(d.teams)) {
    return {
      teams: d.teams,
      scores: Array.isArray(d.scores) ? d.scores : [],
    };
  }
  const teams = [d.team1, d.team2].filter(Boolean);
  const scores: Array<{ h: number | null; a: number | null }> = [];
  for (let i = 1; i <= 6; i++) {
    const raw = String(d[`m${i}`] || "").trim();
    if (!raw) {
      scores.push({ h: null, a: null });
      continue;
    }
    const sep = raw.includes("-") ? "-" : raw.includes(":") ? ":" : null;
    if (!sep) {
      scores.push({ h: null, a: null });
      continue;
    }
    const [h, a] = raw.split(sep).map((v) => Number.parseInt(v, 10));
    scores.push(Number.isFinite(h) && Number.isFinite(a) ? { h, a } : { h: null, a: null });
  }
  return { teams, scores };
}

function parseScore(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isPlaceholderTeam(value: unknown) {
  const token = String(value || "").trim();
  if (!token) return true;
  return /^(?:[12][A-L]|3[A-L]+|W\d+|L\d+)$/i.test(token);
}

function normalizeWinnerToken(value: unknown) {
  const token = String(value || "").trim().toLowerCase();
  return token === "home" || token === "away" ? token : "";
}

function resolveMatchWinner(match: any) {
  const explicit = normalizeWinnerToken(match?.winner);
  if (explicit) return explicit;
  const homeScore = parseScore(match?.homeScore);
  const awayScore = parseScore(match?.awayScore);
  if (homeScore === null || awayScore === null) return "";
  if (homeScore > awayScore) return "home";
  if (awayScore > homeScore) return "away";
  return "";
}

function getWinnerName(match: any) {
  const side = resolveMatchWinner(match);
  if (side === "home") {
    const name = String(match?.home || "").trim();
    return isPlaceholderTeam(name) ? "" : name;
  }
  if (side === "away") {
    const name = String(match?.away || "").trim();
    return isPlaceholderTeam(name) ? "" : name;
  }
  return "";
}

function getLoserName(match: any) {
  const side = resolveMatchWinner(match);
  if (side === "home") {
    const name = String(match?.away || "").trim();
    return isPlaceholderTeam(name) ? "" : name;
  }
  if (side === "away") {
    const name = String(match?.home || "").trim();
    return isPlaceholderTeam(name) ? "" : name;
  }
  return "";
}

function normalizePlayoffRow(row: any) {
  const d = row?.data && typeof row.data === "object" ? row.data : {};
  const rounds = Array.isArray(d.rounds) ? d.rounds : [];
  const normalizedRounds = rounds.map((round: any, roundIndex: number) => ({
    key: String(round?.key || `round_${roundIndex + 1}`).trim(),
    label: String(round?.label || `Раунд ${roundIndex + 1}`).trim(),
    matches: Array.isArray(round?.matches)
      ? round.matches.map((match: any, matchIndex: number) => ({
          id: String(match?.id || `${String(round?.key || `round_${roundIndex + 1}`).trim()}_${matchIndex + 1}`).trim(),
          home: String(match?.home || "").trim(),
          away: String(match?.away || "").trim(),
          kickoff: String(match?.kickoff || "").trim(),
          homeScore: parseScore(match?.homeScore),
          awayScore: parseScore(match?.awayScore),
          note: String(match?.note || "").trim(),
          winner: normalizeWinnerToken(match?.winner),
        }))
      : [],
  }));

  const findRound = (key: string) => normalizedRounds.find((round: any) => round.key === key);
  const semifinalRound = findRound("semifinal");
  const thirdPlaceRound = findRound("third_place");
  const finalRound = findRound("final");
  const finalMatch = finalRound?.matches?.[0] || null;
  const thirdPlaceMatch = thirdPlaceRound?.matches?.[0] || null;

  const teamSet = new Map<string, { name: string }>();
  for (const round of normalizedRounds) {
    for (const match of round.matches) {
      for (const name of [match.home, match.away]) {
        const trimmed = String(name || "").trim();
        if (!trimmed || trimmed === "TBD" || trimmed === "—" || isPlaceholderTeam(trimmed)) continue;
        if (!teamSet.has(trimmed.toLowerCase())) teamSet.set(trimmed.toLowerCase(), { name: trimmed });
      }
    }
  }

  return {
    deadline: String(d.deadline || "").trim(),
    locked: String(d.locked || "").trim() === "1",
    rounds: normalizedRounds,
    teams: [...teamSet.values()],
    semi: semifinalRound
      ? semifinalRound.matches.flatMap((match: any) => [match.home, match.away]).filter((name: string) => name && !isPlaceholderTeam(name))
      : [],
    winner: getWinnerName(finalMatch),
    finalist: getLoserName(finalMatch),
    third: getWinnerName(thirdPlaceMatch),
    finalH: finalMatch?.homeScore ?? null,
    finalA: finalMatch?.awayScore ?? null,
    thirdH: thirdPlaceMatch?.homeScore ?? null,
    thirdA: thirdPlaceMatch?.awayScore ?? null,
  };
}

function scorePrediction(row: any, results: Record<string, any>) {
  const pred = row?.data && typeof row.data === "object" ? row.data : {};
  let teamPts = 0;
  let outPts = 0;
  let diffPts = 0;
  let scPts = 0;
  const detail: Record<string, any> = {};

  for (const [groupCode, result] of Object.entries(results)) {
    if (groupCode.startsWith("_")) continue;
    const raw = String(pred[`group${groupCode}`] || "");
    const predicted = raw ? raw.split("|").map((s) => s.trim()).filter(Boolean) : [];
    const actual = Array.isArray((result as any)?.teams) ? (result as any).teams : [];
    const actScores = Array.isArray((result as any)?.scores) ? (result as any).scores : [];
    let groupPts = 0;

    predicted.forEach((team) => {
      if (actual.some((a: string) => a.toLowerCase() === team.toLowerCase())) {
        teamPts += 3;
        groupPts += 3;
      }
    });

    const predScores: Array<{ h: number; a: number } | null> = [];
    for (let matchIndex = 0; matchIndex < 6; matchIndex++) {
      const ph = pred[`group${groupCode}_m${matchIndex}_h`];
      const pa = pred[`group${groupCode}_m${matchIndex}_a`];
      const parsedH = ph !== undefined && ph !== "" ? Number.parseInt(ph, 10) : null;
      const parsedA = pa !== undefined && pa !== "" ? Number.parseInt(pa, 10) : null;
      predScores.push(parsedH === null || parsedA === null ? null : { h: parsedH, a: parsedA });

      const actualScore = actScores[matchIndex];
      if (parsedH === null || parsedA === null) continue;
      if (!actualScore || actualScore.h === null || actualScore.h === undefined) continue;

      const predDiff = parsedH - parsedA;
      const actDiff = actualScore.h - actualScore.a;
      const predOutcome = predDiff > 0 ? "h" : predDiff < 0 ? "a" : "d";
      const actOutcome = actDiff > 0 ? "h" : actDiff < 0 ? "a" : "d";

      if (parsedH === actualScore.h && parsedA === actualScore.a) {
        scPts += 3;
        groupPts += 3;
      } else if (predDiff === actDiff) {
        diffPts += 2;
        groupPts += 2;
      } else if (predOutcome === actOutcome) {
        outPts += 1;
        groupPts += 1;
      }
    }

    detail[groupCode] = {
      predicted,
      actual,
      pts: groupPts,
      actScores,
      predScores,
    };
  }

  const playoff = results._PLAYOFF;
  if (playoff) {
    const winner = String(pred.winner || "").trim();
    const finalist = String(pred.finalist || "").trim();
    const third = String(pred.third || "").trim();
    const semiTeams = String(pred.semi || "").split("|").map((s) => s.trim()).filter(Boolean);
    const actualSemiTeams = Array.isArray(playoff.semi) ? playoff.semi : [];
    let playoffPts = 0;

    if (winner && playoff.winner && winner.toLowerCase() === String(playoff.winner).toLowerCase()) playoffPts += 5;
    if (finalist && playoff.finalist && finalist.toLowerCase() === String(playoff.finalist).toLowerCase()) playoffPts += 3;
    if (third && playoff.third && third.toLowerCase() === String(playoff.third).toLowerCase()) playoffPts += 3;
    if (actualSemiTeams.length) {
      playoffPts += semiTeams.filter((team) =>
        actualSemiTeams.some((actual: string) => String(actual).toLowerCase() === team.toLowerCase())
      ).length * 2;
    }

    const finalH = parseScore(pred.finalH);
    const finalA = parseScore(pred.finalA);
    if (finalH !== null && finalA !== null && finalH === playoff.finalH && finalA === playoff.finalA) playoffPts += 5;

    const thirdH = parseScore(pred.thirdH);
    const thirdA = parseScore(pred.thirdA);
    if (thirdH !== null && thirdA !== null && thirdH === playoff.thirdH && thirdA === playoff.thirdA) playoffPts += 3;

    detail._PLAYOFF = {
      predicted: { winner, finalist, third, semi: semiTeams, finalH, finalA, thirdH, thirdA },
      actual: playoff,
      pts: playoffPts,
    };
    return {
      name: row.name,
      code: row.code,
      total: teamPts + outPts + diffPts + scPts + playoffPts,
      teamPts,
      outPts,
      diffPts,
      scPts,
      playoffPts,
      detail,
    };
  }

  return {
    name: row.name,
    code: row.code,
    total: teamPts + outPts + diffPts + scPts,
    teamPts,
    outPts,
    diffPts,
    scPts,
    playoffPts: 0,
    detail,
  };
}

function normalizeKey(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function normalizeName(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function mapSnapshotCasinoRows(
  snapshot: any,
  liveCasinoRows: any[],
  participantRows: any[],
) {
  const snapshotRows = asArray(snapshot?.casinoCoins).length
    ? asArray(snapshot?.casinoCoins)
    : asArray(snapshot?.casino);
  if (!snapshotRows.length) return null;

  const liveByCode = new Map<string, any>();
  const liveByName = new Map<string, any>();
  for (const row of liveCasinoRows || []) {
    const codeKey = normalizeKey(row?.code);
    const nameKey = normalizeName(row?.name);
    if (codeKey) liveByCode.set(codeKey, row);
    if (nameKey) liveByName.set(nameKey, row);
  }

  const participantByName = new Map<string, any>();
  for (const row of participantRows || []) {
    const nameKey = normalizeName(row?.name);
    if (nameKey && !participantByName.has(nameKey)) participantByName.set(nameKey, row);
  }

  return snapshotRows.map((row: any) => {
    const snapshotCode = normalizeKey(row?.code || row?.login);
    const snapshotName = normalizeName(row?.name);
    const liveRow = (snapshotCode && liveByCode.get(snapshotCode)) || liveByName.get(snapshotName) || null;
    const participantRow = participantByName.get(snapshotName) || null;
    const code = snapshotCode || String(liveRow?.code || participantRow?.code || "").trim();
    const spent = Number(row?.spent ?? liveRow?.spent ?? 0);

    return {
      code,
      name: row?.name || liveRow?.name || participantRow?.name || "",
      coins: Number(row?.coins ?? liveRow?.coins ?? 0),
      spent,
    };
  });
}

function mapSnapshotAchievementRows(snapshot: any, participantRows: any[]) {
  const snapshotRows = asArray(snapshot?.achievementsRating).length
    ? asArray(snapshot?.achievementsRating)
    : asArray(snapshot?.achievements);
  if (!snapshotRows.length) return null;

  const participantByName = new Map<string, any>();
  for (const row of participantRows || []) {
    const nameKey = normalizeName(row?.name);
    if (nameKey && !participantByName.has(nameKey)) participantByName.set(nameKey, row);
  }

  return snapshotRows.flatMap((row: any) => {
    const name = String(row?.name || "").trim();
    const participantRow = participantByName.get(normalizeName(name)) || null;
    const code = String(row?.code || participantRow?.code || "").trim();
    return asArray<string>(row?.achList).map((achievement) => ({
      code,
      name,
      achievement,
    }));
  });
}

function mapSnapshotAutoclickers(snapshot: any) {
  const rows = asArray(snapshot?.autoclickers).length
    ? asArray(snapshot?.autoclickers)
    : asArray(snapshot?.autoclickerRows);
  if (!rows.length) return null;

  return rows.map((row: any) => ({
    code: row?.code || row?.login || "",
    name: row?.name || "",
    coins: Number(row?.coins || 0),
    spent: Number(row?.spent || 0),
    achCount: Number(row?.achCount || asArray(row?.achList).length || 0),
    predTotal: Number(row?.predTotal || row?.points || 0),
    login: row?.login || row?.code || "",
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const [snapshotRes, predictionsRes, resultsRes, casinoRes, achRes, participantsRes] = await Promise.all([
      supabase.from("rating_snapshots").select("key,data,updated_at").eq("key", "public_ratings").maybeSingle(),
      supabase.from("predictions").select("id,code,name,data,updated_at").order("updated_at", { ascending: true }).order("id", { ascending: true }),
      supabase.from("results").select("group_code,data").order("group_code", { ascending: true }),
      supabase.from("casino").select("code,name,coins,spent").order("code", { ascending: true }),
      supabase.from("achievements").select("code,achievement").order("id", { ascending: true }),
      supabase.from("participants").select("code,name,created_at,id").order("id", { ascending: true }),
    ]);

    if (snapshotRes.error) throw snapshotRes.error;
    if (predictionsRes.error) throw predictionsRes.error;
    if (resultsRes.error) throw resultsRes.error;
    if (casinoRes.error) throw casinoRes.error;
    if (achRes.error) throw achRes.error;
    if (participantsRes.error) throw participantsRes.error;

    const results: Record<string, any> = {};
    for (const row of resultsRes.data || []) {
      results[String(row.group_code || "").toUpperCase()] = normalizeResultRow(row);
    }

    const latestPredictions = new Map<string, any>();
    for (const row of predictionsRes.data || []) {
      const key = String(row.code || "").trim().toLowerCase();
      if (!key) continue;
      latestPredictions.set(key, row);
    }

    const casinoMap = new Map<string, any>();
    for (const row of casinoRes.data || []) {
      const key = String(row.code || "").toLowerCase();
      casinoMap.set(key, {
        ...row,
        spent: Number(row.spent || 0),
      });
    }

    const achMap = new Map<string, string[]>();
    for (const row of achRes.data || []) {
      const key = String(row.code || "").toLowerCase();
      const next = achMap.get(key) || [];
      next.push(String(row.achievement || ""));
      achMap.set(key, next);
    }

    const leaderboard = [...latestPredictions.values()].map((row) => {
      const base = scorePrediction(row, results);
      const casino = casinoMap.get(String(row.code || "").toLowerCase());
      const achList = achMap.get(String(row.code || "").toLowerCase()) || [];
      return {
        ...base,
        coins: Number(casino?.coins || 0),
        spent: Number(casino?.spent || 0),
        achCount: achList.length,
        achList,
      };
    }).sort((a, b) =>
      b.total - a.total ||
      b.teamPts - a.teamPts ||
      b.scPts - a.scPts ||
      b.diffPts - a.diffPts ||
      b.outPts - a.outPts ||
      String(a.name || "").localeCompare(String(b.name || ""), "ru")
    );

    const casinoRows = (casinoRes.data || []).map((row) => {
      return {
        ...row,
        spent: Number(row.spent || 0),
      };
    });
    const casinoRowCodes = new Set(casinoRows.map((row) => String(row.code || "").trim().toLowerCase()).filter(Boolean));
    for (const row of leaderboard) {
      const key = String(row.code || "").trim().toLowerCase();
      if (!key || casinoRowCodes.has(key)) continue;
      const coins = Number(row.coins || 0);
      const spent = Number(row.spent || 0);
      if (coins <= 0 && spent <= 0) continue;
      casinoRows.push({
        code: row.code,
        name: row.name || "",
        coins,
        spent,
      });
      casinoRowCodes.add(key);
    }

    const participantRows = participantsRes.data || [];
    const snapshotData = snapshotRes.data?.data || null;
    const leaderboardMap = new Map<string, any>();
    for (const row of leaderboard) {
      leaderboardMap.set(String(row.code || "").trim().toLowerCase(), row);
    }

    const liveAutoclickers = casinoRows
      .filter((row) => AUTOCLICKER_CODES.has(String(row.code || "").trim().toLowerCase()))
      .map((row) => {
        const key = String(row.code || "").trim().toLowerCase();
        const lbRow = leaderboardMap.get(key);
        const participantRow = participantRows.find((p) => String(p.code || "").trim().toLowerCase() === key);
        const achList = achMap.get(key) || [];
        return {
          code: row.code,
          name: row.name || lbRow?.name || participantRow?.name || row.code,
          coins: Number(row.coins || 0),
          spent: Number(row.spent || 0),
          achCount: achList.length,
          predTotal: Number(lbRow?.total || 0),
        };
      })
      .sort((a, b) => b.spent - a.spent || String(a.name || "").localeCompare(String(b.name || ""), "ru"));

    const snapshotCasinoRows = mapSnapshotCasinoRows(snapshotData, casinoRows, participantRows);
    const snapshotAchRows = mapSnapshotAchievementRows(snapshotData, participantRows);
    const snapshotAutoclickers: any[] = [];

    return json({
      ok: true,
      leaderboard,
      results,
      casinoRows,
      achRows: snapshotAchRows || (achRes.data || []),
      participantRows,
      autoclickers: [],
    });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "public-site-data failed" },
      500,
    );
  }
});
