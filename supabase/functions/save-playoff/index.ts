import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { guardRequest, json } from "../_shared/http-security.ts";

Deno.serve(async (req) => {
  const blocked = guardRequest(req, { requireProxy: true, maxBodyBytes: 24576 });
  if (blocked) return blocked;

  try {
    const body = await req.json();
    const rawCode = String(body.code || "").trim();

    if (!rawCode) {
      return json(req, { ok: false, error: "Не передан code" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: participants, error: participantError } = await supabase
      .from("participants")
      .select("code,name")
      .ilike("code", rawCode)
      .limit(1);

    if (participantError) throw participantError;
    if (!participants || !participants.length) {
      return json(req, { ok: false, error: "Код не найден" }, 404);
    }

    const participant = participants[0];

    const parseScore = (value: unknown) => {
      if (value === null || value === undefined || value === "") return null;
      const num = Number.parseInt(String(value), 10);
      return Number.isFinite(num) ? num : null;
    };

    const normalizeWinner = (value: unknown) => {
      const token = String(value || "").trim().toLowerCase();
      return token === "home" || token === "away" ? token : "";
    };

    const normalizePredictionMatches = (value: unknown) => {
      const map = new Map<string, { homeScore: number | null; awayScore: number | null; winner: string }>();
      if (!value || typeof value !== "object") return map;
      const source = value as Record<string, unknown>;
      const items = Array.isArray(source.matches)
        ? source.matches
        : source.matches && typeof source.matches === "object"
          ? Object.entries(source.matches as Record<string, unknown>).map(([id, item]) => ({ id, ...(item as Record<string, unknown>) }))
          : [];
      for (const item of items) {
        const id = String((item as Record<string, unknown>)?.id || "").trim().toUpperCase();
        if (!id) continue;
        map.set(id, {
          homeScore: parseScore((item as Record<string, unknown>)?.homeScore),
          awayScore: parseScore((item as Record<string, unknown>)?.awayScore),
          winner: normalizeWinner((item as Record<string, unknown>)?.winner),
        });
      }
      return map;
    };

    const data = { ...body };
    delete data.code;
    delete data.action;
    delete data.name;

    data.code = participant.code;
    data.name = participant.name;
    data.timestamp = new Date().toISOString();

    const [resultsRes, existingRes] = await Promise.all([
      supabase
        .from("results")
        .select("group_code,data")
        .eq("group_code", "_PLAYOFF")
        .maybeSingle(),
      supabase
        .from("playoff")
        .select("data")
        .ilike("code", participant.code)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (resultsRes.error) throw resultsRes.error;
    if (existingRes.error) throw existingRes.error;

    const actualPlayoff = resultsRes.data?.data && typeof resultsRes.data.data === "object"
      ? resultsRes.data.data as Record<string, unknown>
      : null;
    const actualRounds = Array.isArray(actualPlayoff?.rounds) ? actualPlayoff.rounds as Array<Record<string, unknown>> : [];
    const currentPrediction = existingRes.data?.data && typeof existingRes.data.data === "object"
      ? existingRes.data.data as Record<string, unknown>
      : {};
    const incomingMatches = normalizePredictionMatches(data);
    const existingMatches = normalizePredictionMatches(currentPrediction);
    const globallyLocked = String(actualPlayoff?.locked || "").trim() === "1" || actualPlayoff?.locked === true;

    for (const [id, match] of incomingMatches.entries()) {
      if (match.homeScore !== null && (match.homeScore < 0 || match.homeScore > 20)) {
        return json(req, { ok: false, error: `Матч ${id}: счёт хозяев должен быть от 0 до 20` }, 400);
      }
      if (match.awayScore !== null && (match.awayScore < 0 || match.awayScore > 20)) {
        return json(req, { ok: false, error: `Матч ${id}: счёт гостей должен быть от 0 до 20` }, 400);
      }

      const hasHome = match.homeScore !== null;
      const hasAway = match.awayScore !== null;
      if (!hasHome || !hasAway) continue;

      const derivedWinner =
        match.homeScore! > match.awayScore!
          ? "home"
          : match.awayScore! > match.homeScore!
            ? "away"
            : "";

      if (derivedWinner) {
        match.winner = derivedWinner;
        continue;
      }

      if (!match.winner) {
        return json(req, { ok: false, error: `Матч ${id}: при ничьей нужно выбрать, кто проходит дальше` }, 400);
      }
    }

    for (const round of actualRounds) {
      for (const match of Array.isArray(round?.matches) ? round.matches as Array<Record<string, unknown>> : []) {
        const id = String(match?.id || "").trim().toUpperCase();
        if (!id) continue;
        const kickoffRaw = String(match?.kickoff || "").trim();
        const kickoffTime = kickoffRaw ? new Date(kickoffRaw).getTime() : NaN;
        const isLocked = globallyLocked || (!Number.isNaN(kickoffTime) && Date.now() >= kickoffTime);
        if (!isLocked) continue;
        const incoming = incomingMatches.get(id) || { homeScore: null, awayScore: null, winner: "" };
        const existing = existingMatches.get(id) || { homeScore: null, awayScore: null, winner: "" };
        if (
          incoming.homeScore !== existing.homeScore ||
          incoming.awayScore !== existing.awayScore ||
          incoming.winner !== existing.winner
        ) {
          return json(req, { ok: false, error: `Матч ${id} уже закрыт для изменения` }, 400);
        }
      }
    }

    const payload = {
      code: participant.code,
      name: participant.name,
      data,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("playoff")
      .upsert(payload, { onConflict: "code" });

    if (error) throw error;

    return json(req, { ok: true });
  } catch (e) {
    return json(
      req,
      { ok: false, error: e instanceof Error ? e.message : "save-playoff failed" },
      500,
    );
  }
});
