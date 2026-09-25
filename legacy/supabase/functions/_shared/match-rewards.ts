export const MATCH_REWARD_RULES = {
  exact: 1000,
  diff: 750,
  outcome: 500,
  miss: 50,
} as const;

export type MatchRewardType = keyof typeof MATCH_REWARD_RULES;

type Score = { h: number; a: number };

const MATCH_COMMENT_BANK: Record<MatchRewardType, string[]> = {
  exact: [
    "Ты попал в точный счет. Это не интеллект, это сбой вселенной.",
    "Точный счет. Даже сломанные часы полезнее тебя реже, чем сейчас.",
    "Как ты это угадал? Кто-то явно слил тебе сценарий, гений на минималках.",
    "Попал в счет. Противно признавать, но ты сегодня выглядишь чуть менее бесполезно.",
    "Точный счет. Запиши дату, второй такой всплеск мозговой активности вряд ли случится.",
    "Ну надо же, ты не просто ткнул пальцем в небо, а попал прямо в табло.",
    "Счет угадан идеально. Видимо, даже хаос иногда ошибается в твою пользу.",
    "Точный счет. Система в ужасе: ты случайно показал признаки жизни.",
    "Попадание в счет. Поздравляем, сегодня ты не главный позор статистики.",
    "Да, это точный счет. Не обольщайся, чудеса по расписанию не повторяются.",
    "Идеальное попадание. Страшно осознавать, что это сделал именно ты.",
    "Счет угадан. Такое обычно бывает только у людей и раз в век у тебя.",
  ],
  diff: [
    "Разницу мячей угадал. До точного счета не дотянул, но уже не совсем позорище.",
    "Попал в разницу. Это как почти красиво, если не смотреть внимательно.",
    "Разница сошлась. Счет кривой, но хотя бы не совсем бессмысленный.",
    "Угадал разницу мячей. По меркам твоих прогнозов это почти академическое достижение.",
    "Разница точная, счет мимо. Ну хоть математика тебя не до конца ненавидит.",
    "Попал в разницу. Не идеально, но уже достаточно, чтобы не смеяться слишком громко.",
    "Разницу ты вычислил, а детали, как обычно, доверил хаосу.",
    "Угадал разницу мячей. Видимо, калькулятор в голове иногда все же включается.",
    "Разница верная. До полного позора не дожал, уже прогресс.",
    "Почти умно: разница совпала, а точность опять сбежала от тебя.",
    "Разницу мячей поймал. Счет нет. Типичный полушаг до адекватности.",
    "Разница точная. На фоне остального это почти респектабельно.",
  ],
  outcome: [
    "Исход ты унюхал, но до точного счета мозг, как всегда, не добежал.",
    "Почти угадал. Молодец, для твоего уровня это уже медицинский прорыв.",
    "Исход верный, счет мимо. Половина мозга пришла на матч, вторая проспала.",
    "Ну да, исход угадал. До точности пока так же далеко, как тебе до экспертности.",
    "Попал только в исход. Это как почти быть умным, но все-таки нет.",
    "Исход верный, счет кривой. Типичный ты: рядом, но стыдно.",
    "Угадал победителя. Остальное, как обычно, испорчено твоим участием.",
    "Исход совпал. Счет, правда, выглядит так, будто ты гадал локтем.",
    "Половинчатый успех. Достаточно, чтобы не молчать, но мало, чтобы уважать.",
    "Исход верный. Точный счет ты, видимо, снова доверил внутреннему идиоту.",
    "Ну хоть направление матча понял. Уже неплохо для человека с твоей историей решений.",
    "Попадание по исходу. Счет рядом не стоял, как и твоя уверенность с реальностью.",
  ],
  miss: [
    "Мимо вообще всего, но держи 50 ЛК за участие в фестивале неверных мыслей.",
    "Ты не угадал ничего, кроме того, что снова выглядишь жалко. Вот тебе 50 ЛК.",
    "Промах полный. Награда символическая, как и твой вклад в аналитику.",
    "Не угадал. Это было плохо даже по твоим заниженным стандартам, но 50 ЛК держи.",
    "Мимо. Мы решили, что смеяться над тобой бесплатно уже нечестно, поэтому вот 50 ЛК.",
    "Ноль попаданий. Но ты стабилен, а стабильность тоже чего-то стоит. Примерно 50 ЛК.",
    "Все мимо. Хорошая новость: за позор у нас тоже предусмотрен прайс.",
    "Не угадал вообще. Это уже не ошибка, это фирменный стиль. Держи 50 ЛК.",
    "Полнейшая ерунда, а не прогноз. Но даже мусор иногда монетизируют.",
    "Опять мимо. Если бы за плохие решения давали диплом, ты бы уже преподавал.",
    "Ты провалил матч с изяществом бетонной плиты. Награда прилагается.",
    "Промах. Удивительно не то, что ты ошибся, а что это еще можно было сделать настолько плохо.",
  ],
};

function parseIntSafe(value: unknown) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : null;
}

export function buildMatchKey(groupCode: string, matchIndex: number) {
  return `group_${String(groupCode).toUpperCase()}_m${matchIndex}`;
}

export function getResultScores(data: Record<string, unknown>) {
  const scores: Array<Score | null> = [];
  for (let i = 1; i <= 6; i++) {
    const raw = String(data?.[`m${i}`] ?? "").trim();
    if (!raw) {
      scores.push(null);
      continue;
    }
    const sep = raw.includes("-") ? "-" : raw.includes(":") ? ":" : null;
    if (!sep) {
      scores.push(null);
      continue;
    }
    const [h, a] = raw.split(sep).map((part) => parseIntSafe(part));
    scores.push(h === null || a === null ? null : { h, a });
  }
  return scores;
}

export function getPredictionScore(prediction: Record<string, unknown>, groupCode: string, matchIndex: number) {
  const h = parseIntSafe(prediction?.[`group${groupCode}_m${matchIndex}_h`]);
  const a = parseIntSafe(prediction?.[`group${groupCode}_m${matchIndex}_a`]);
  if (h === null || a === null) return null;
  return { h, a };
}

export function evaluateMatchReward(pred: Score | null, actual: Score | null) {
  if (!pred || !actual) return null;

  const predOutcome = pred.h > pred.a ? "h" : pred.h < pred.a ? "a" : "d";
  const actualOutcome = actual.h > actual.a ? "h" : actual.h < actual.a ? "a" : "d";

  const resultType: MatchRewardType =
    pred.h === actual.h && pred.a === actual.a
      ? "exact"
      : pred.h - pred.a === actual.h - actual.a
        ? "diff"
      : predOutcome === actualOutcome
        ? "outcome"
        : "miss";

  return {
    resultType,
    coinsDelta: MATCH_REWARD_RULES[resultType],
  };
}

function hashString(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function buildMatchComment(params: {
  code: string;
  matchKey: string;
  resultType: MatchRewardType;
  pred: Score;
  actual: Score;
}) {
  const pool = MATCH_COMMENT_BANK[params.resultType];
  const seed = `${params.code}|${params.matchKey}|${params.resultType}|${params.pred.h}:${params.pred.a}|${params.actual.h}:${params.actual.a}`;
  return pool[hashString(seed) % pool.length];
}

export async function settleGroupRewards(supabase: any, groupCode: string) {
  const upperGroup = String(groupCode || "").trim().toUpperCase();
  if (!upperGroup) {
    throw new Error("group_code is required");
  }

  const [{ data: resultRow, error: resultError }, { data: predictionsRows, error: predictionsError }, { data: existingRewards, error: rewardsError }, { data: casinoRows, error: casinoError }] = await Promise.all([
    supabase.from("results").select("group_code,data").eq("group_code", upperGroup).maybeSingle(),
    supabase.from("predictions").select("code,name,data,updated_at,id").order("updated_at", { ascending: true }).order("id", { ascending: true }),
    supabase.from("match_rewards").select("id,code,match_key,coins_delta,pred_home,pred_away,actual_home,actual_away,result_type,shown_at").like("match_key", `group_${upperGroup}_m%`),
    supabase.from("casino").select("code,name,coins,spent"),
  ]);

  if (resultError) throw resultError;
  if (predictionsError) throw predictionsError;
  if (rewardsError) throw rewardsError;
  if (casinoError) throw casinoError;
  if (!resultRow?.data) {
    return { ok: true, group_code: upperGroup, settled: 0, adjusted: 0 };
  }

  const actualScores = getResultScores(resultRow.data || {});
  const latestPredictions = new Map<string, { code: string; name: string; data: Record<string, unknown> }>();
  for (const row of predictionsRows || []) {
    const key = String(row.code || "").trim().toLowerCase();
    if (!key) continue;
    latestPredictions.set(key, {
      code: String(row.code || "").trim(),
      name: String(row.name || "").trim(),
      data: row.data && typeof row.data === "object" ? row.data : {},
    });
  }

  const existingByKey = new Map<string, any>();
  for (const row of existingRewards || []) {
    existingByKey.set(`${String(row.code || "").toLowerCase()}|${row.match_key}`, row);
  }

  const casinoByCode = new Map<string, any>();
  for (const row of casinoRows || []) {
    casinoByCode.set(String(row.code || "").toLowerCase(), row);
  }

  const rewardUpserts: Record<string, unknown>[] = [];
  const coinAdjustments = new Map<string, { code: string; name: string; delta: number }>();
  const rewardDeletes: number[] = [];
  const activeRewardKeys = new Set<string>();
  let settled = 0;
  let adjusted = 0;

  for (const row of latestPredictions.values()) {
    for (let matchIndex = 0; matchIndex < actualScores.length; matchIndex++) {
      const actual = actualScores[matchIndex];
      const pred = getPredictionScore(row.data, upperGroup, matchIndex);
      const outcome = evaluateMatchReward(pred, actual);
      if (!pred || !actual || !outcome) continue;

      const matchKey = buildMatchKey(upperGroup, matchIndex);
      activeRewardKeys.add(`${row.code.toLowerCase()}|${matchKey}`);
      const existing = existingByKey.get(`${row.code.toLowerCase()}|${matchKey}`);
      const comment = buildMatchComment({
        code: row.code,
        matchKey,
        resultType: outcome.resultType,
        pred,
        actual,
      });

      const nextPayload = {
        code: row.code,
        match_key: matchKey,
        group_code: upperGroup,
        match_index: matchIndex,
        pred_home: pred.h,
        pred_away: pred.a,
        actual_home: actual.h,
        actual_away: actual.a,
        result_type: outcome.resultType,
        coins_delta: outcome.coinsDelta,
        message: comment,
        settled_at: new Date().toISOString(),
      };

      let deltaDiff = outcome.coinsDelta;
      if (existing) {
        deltaDiff = outcome.coinsDelta - (Number(existing.coins_delta) || 0);
        const changed =
          deltaDiff !== 0 ||
          Number(existing.pred_home) !== pred.h ||
          Number(existing.pred_away) !== pred.a ||
          Number(existing.actual_home) !== actual.h ||
          Number(existing.actual_away) !== actual.a ||
          String(existing.result_type || "") !== outcome.resultType;

        if (!changed) continue;

        rewardUpserts.push({
          id: existing.id,
          ...nextPayload,
          shown_at: null,
        });
        adjusted += 1;
      } else {
        rewardUpserts.push(nextPayload);
        settled += 1;
      }

      if (!deltaDiff) continue;
      const current = coinAdjustments.get(row.code.toLowerCase()) || {
        code: row.code,
        name: row.name,
        delta: 0,
      };
      current.delta += deltaDiff;
      coinAdjustments.set(row.code.toLowerCase(), current);
    }
  }

  if (rewardUpserts.length) {
    const { error } = await supabase.from("match_rewards").upsert(rewardUpserts, { onConflict: "code,match_key" });
    if (error) throw error;
  }

  for (const row of existingRewards || []) {
    const rewardKey = `${String(row.code || "").toLowerCase()}|${row.match_key}`;
    if (activeRewardKeys.has(rewardKey)) continue;
    rewardDeletes.push(Number(row.id));
    const current = coinAdjustments.get(String(row.code || "").toLowerCase()) || {
      code: String(row.code || "").trim(),
      name: "",
      delta: 0,
    };
    current.delta -= Number(row.coins_delta || 0);
    coinAdjustments.set(String(row.code || "").toLowerCase(), current);
    adjusted += 1;
  }

  if (rewardDeletes.length) {
    const { error } = await supabase.from("match_rewards").delete().in("id", rewardDeletes);
    if (error) throw error;
  }

  for (const entry of coinAdjustments.values()) {
    const existingCasino = casinoByCode.get(entry.code.toLowerCase());
    const coinsNow = Number(existingCasino?.coins || 1000);
    const spentNow = Number(existingCasino?.spent || 0);
    const payload = {
      code: entry.code,
      name: existingCasino?.name || entry.name || entry.code,
      coins: coinsNow + entry.delta,
      spent: spentNow,
    };
    const { error } = await supabase.from("casino").upsert(payload, { onConflict: "code" });
    if (error) throw error;

    if (entry.delta !== 0) {
      const { error: eventError } = await supabase.from("casino_events").insert({
        code: entry.code,
        game: "system",
        event_type: "bonus",
        bet: 0,
        payout: entry.delta > 0 ? entry.delta : 0,
        delta: entry.delta,
        meta: {
          source: "match_reward_settlement",
          group_code: upperGroup,
        },
      });
      if (eventError) throw eventError;
    }
  }

  return {
    ok: true,
    group_code: upperGroup,
    settled,
    adjusted,
    impacted_players: coinAdjustments.size,
  };
}

export async function clearGroupRewards(supabase: any, groupCode: string) {
  const upperGroup = String(groupCode || "").trim().toUpperCase();
  if (!upperGroup) {
    throw new Error("group_code is required");
  }

  const [{ data: rewards, error: rewardsError }, { data: casinoRows, error: casinoError }] = await Promise.all([
    supabase.from("match_rewards").select("id,code,coins_delta").like("match_key", `group_${upperGroup}_m%`),
    supabase.from("casino").select("code,name,coins,spent"),
  ]);

  if (rewardsError) throw rewardsError;
  if (casinoError) throw casinoError;

  if (!rewards?.length) {
    return { ok: true, group_code: upperGroup, cleared: 0, impacted_players: 0 };
  }

  const casinoByCode = new Map<string, any>();
  for (const row of casinoRows || []) {
    casinoByCode.set(String(row.code || "").toLowerCase(), row);
  }

  const adjustments = new Map<string, number>();
  for (const row of rewards) {
    const key = String(row.code || "").toLowerCase();
    adjustments.set(key, (adjustments.get(key) || 0) - (Number(row.coins_delta) || 0));
  }

  for (const [key, delta] of adjustments.entries()) {
    const existingCasino = casinoByCode.get(key);
    if (!existingCasino) continue;
    const { error } = await supabase.from("casino").upsert({
      code: existingCasino.code,
      name: existingCasino.name || existingCasino.code,
      coins: Number(existingCasino.coins || 1000) + delta,
      spent: Number(existingCasino.spent || 0),
    }, { onConflict: "code" });
    if (error) throw error;

    if (delta !== 0) {
      const { error: eventError } = await supabase.from("casino_events").insert({
        code: existingCasino.code,
        game: "system",
        event_type: "bonus",
        bet: 0,
        payout: delta > 0 ? delta : 0,
        delta,
        meta: {
          source: "match_reward_clear",
          group_code: upperGroup,
        },
      });
      if (eventError) throw eventError;
    }
  }

  const ids = rewards.map((row: any) => Number(row.id)).filter((id: number) => Number.isFinite(id));
  const { error } = await supabase.from("match_rewards").delete().in("id", ids);
  if (error) throw error;

  return {
    ok: true,
    group_code: upperGroup,
    cleared: ids.length,
    impacted_players: adjustments.size,
  };
}
