import { sb, rpc } from "../api.js?v=2.3.0";
import { h, clear, fmt, dt, toast, actionButton, sleep, reducedMotion } from "../ui.js?v=2.3.0";
import { meme } from "../memes.js?v=2.3.0";
import { sha256hex, rouletteNumber, shuffle, blackjackReplay, roulettePayout, colorOf,
  diceReplay, minesPositions, minesPayout, crashPoint, plinkoReplay, horseReplay, slotsReplay, hlReplay } from "../fair.js?v=2.3.0";
import { cardLabel } from "./shared.js?v=2.3.0";

// ---------- жаргон на человеческий: наводишь курсор/палец — получаешь перевод ----------
const GLOSSARY = [
  ["server seed", "Секретное число казино. Известно только серверу до конца раунда — потом его раскрывают."],
  ["client seed", "Ваше число. Можно поменять в любой момент между раундами — оно тоже влияет на результат."],
  ["nonce", "Порядковый номер ставки на текущей паре сидов. Растёт на 1 каждый раз — как номер квитанции."],
  ["SHA-256", "Функция-«печать»: из секрета получается короткий отпечаток (хеш). Секрет по отпечатку не восстановить, а один и тот же секрет всегда даёт один и тот же отпечаток."],
  ["HMAC-SHA256", "Способ смешать секрет и ваши данные так, чтобы результат нельзя было ни предсказать заранее, ни подделать задним числом."],
  ["хеш", "Отпечаток секрета, который вам показали ДО ставки. После раскрытия секрета отпечаток должен совпасть — иначе казино врёт."],
  ["cursor", "Счётчик внутри одного раунда: если нужно много случайных чисел подряд (например, много карт), берём их одно за другим по этому счётчику."],
  ["Фишера–Йетса", "Стандартный способ честно перетасовать колоду: любой порядок карт равновероятен, подглядеть заранее нельзя."],
  ["смещения по модулю", "Технический приём, без которого некоторые числа выпадали бы чуть чаще других. С ним — все варианты равновероятны."],
  ["commitment", "Обязательство: казино публикует отпечаток секрета до ставки и не может задним числом его подменить."],
];
function glossify(text) {
  let rest = text, out = [];
  while (rest) {
    let best = null;
    for (const [term, tip] of GLOSSARY) {
      const i = rest.indexOf(term);
      if (i !== -1 && (!best || i < best.i)) best = { i, term, tip };
    }
    if (!best) { out.push(rest); break; }
    if (best.i > 0) out.push(rest.slice(0, best.i));
    out.push(h("span", { class: "gloss", tabindex: "0", "data-tip": best.tip }, best.term));
    rest = rest.slice(best.i + best.term.length);
  }
  return out;
}
const P = (...parts) => h("p", { class: "muted" }, ...parts.flatMap((p) => (typeof p === "string" ? glossify(p) : [p])));

export async function mount(root, { app, sub, params }) {
  if (sub === "verify") return verifyPage(root, app, params.get("round"));
  await app.refreshMe();
  const s = app.me.seed;
  const { data: revealed } = await sb.from("fair_seeds").select("id,server_seed,server_seed_hash,client_seed,next_nonce,revealed_at,created_at")
    .eq("status", "revealed").order("revealed_at", { ascending: false }).limit(20);
  const clientInput = h("input", { class: "input mono", maxlength: 64, placeholder: "оставьте пустым — сгенерируем", "aria-label": "Новый client seed" });

  root.append(h("div", { class: "container stack" },
    h("div", { class: "game-head" }, h("div", {}, h("div", { class: "eyebrow" }, "Provably fair"), h("h1", {}, "Честность"))),
    h("div", { class: "card gilded stack" },
      h("h3", {}, "Почему касса не может подкрутить исход"),
      h("div", { class: "fstep-list" },
        h("div", { class: "fstep ok" }, h("div", {}), h("div", { class: "fstep-body" },
          h("div", { class: "fstep-t" }, "Секрет публикуется ДО ставки"),
          h("div", { class: "fstep-d" }, P("Сервер генерирует секретный ", "server seed", " и сразу показывает вам его ", "SHA-256", " ", "хеш", ". Подменить секрет позже нельзя — другой секрет даст другой отпечаток.")))),
        h("div", { class: "fstep ok" }, h("div", {}), h("div", { class: "fstep-body" },
          h("div", { class: "fstep-t" }, "Исход зависит и от вас тоже"),
          h("div", { class: "fstep-d" }, P("Число складывается из секрета казино, вашего ", "client seed", " и счётчика ", "nonce", ". Свою часть казино поменять не может, вашу — вы контролируете сами.")))),
        h("div", { class: "fstep ok" }, h("div", {}), h("div", { class: "fstep-body" },
          h("div", { class: "fstep-t" }, "Всё можно пересчитать"),
          h("div", { class: "fstep-d" }, P("При смене пары сидов старый секрет раскрывается — и любой сыгранный на нём раунд можно проверить прямо в браузере, без доверия к нам.")))),
      ),
      h("details", { class: "more" }, h("summary", {}, "Технические детали (занудно, но честно)"),
        h("div", { class: "stack muted", style: { fontSize: "14px" } },
          P("Поток случайности: ", "HMAC-SHA256", "(key = ", "server seed", ", message = ", "client seed", " : ", "nonce", " : ", "cursor", "), cursor = 0, 1, 2… Каждый блок даёт восемь 32-битных чисел (big-endian)."),
          P("Равномерное целое в [0, m): принимаем u, если u < ⌊2³²/m⌋·m, иначе берём следующее. Результат u mod m. Так нет ", "смещения по модулю", "."),
          P("Рулетка: одно число mod 37. Блэкджек: тасовка ", "Фишера–Йетса", " по 312 картам (6 колод), j = rand(i+1) для i = 311…1; карта c → ранг c mod 13, масть ⌊c/13⌋ mod 4. Порядок раздачи: игрок, дилер, игрок, дилер (закрытая), далее по шузу."),
          P("Dice: число = rand(10000). Mines: тасовка 25 клеток, мины — первые m. Больше/Меньше: тасовка 52 карт, карты того же номинала сгорают. Crash: r = rand(2³¹−1), краш = ⌊97·N/(N−r)⌋/100. Plinko: 12 × rand(2). Скачки: последовательный взвешенный выбор по весам. Слот: остановки барабанов = rand(длина ленты)."),
          P("Сид нельзя сменить, пока идёт незавершённая игра: иначе вы узнали бы будущие карты, мины или точку краха.")))),
    h("div", { class: "card stack" },
      h("div", { class: "eyebrow" }, "Текущая пара сидов"),
      h("dl", { class: "kv" },
        h("dt", {}, ...glossify("Хеш server seed")), h("dd", { class: "mono" }, s.serverSeedHash),
        h("dt", {}, ...glossify("Client seed")), h("dd", { class: "mono" }, s.clientSeed),
        h("dt", {}, ...glossify("Следующий nonce")), h("dd", { class: "num" }, String(s.nextNonce))),
      h("div", { class: "field" }, h("label", {}, "Новый client seed"), clientInput),
      actionButton("Раскрыть сид и начать новый", async () => {
        try {
          const r = await rpc("rpc_rotate_seed", { p_new_client_seed: clientInput.value.trim() || null });
          toast("Сид раскрыт. Теперь все его раунды можно проверить.", "ok");
          app.route();
          return r;
        } catch (e) { toast(e.message, "error"); }
      }, { class: "btn primary" })),
    h("div", { class: "card stack" },
      h("div", { class: "eyebrow" }, "Раскрытые сиды"),
      (revealed || []).length ? h("div", { class: "table-wrap" }, h("table", { class: "table" },
        h("thead", {}, h("tr", {}, h("th", {}, "Раскрыт"), h("th", {}, "Server seed"), h("th", {}, "Client seed"), h("th", { class: "r" }, "Раундов"))),
        h("tbody", {}, revealed.map((x) => h("tr", {}, h("td", {}, dt(x.revealed_at)), h("td", { class: "mono" }, x.server_seed),
          h("td", { class: "mono" }, x.client_seed), h("td", { class: "r num" }, fmt(x.next_nonce)))))))
        : h("p", { class: "muted" }, "Пока ни один сид не раскрыт. Раскройте текущий, чтобы проверить сыгранные раунды."),
      h("a", { href: "#/history" }, "Выбрать раунд для проверки в истории →"))));
}

async function verifyPage(root, app, roundId) {
  const out = h("div", { class: "stack" });
  root.append(h("div", { class: "container stack" },
    h("div", { class: "game-head" }, h("div", {}, h("div", { class: "eyebrow" }, "Верификатор"), h("h1", {}, "Проверка раунда"))), out));
  if (!roundId) { out.appendChild(h("p", { class: "muted" }, "Выберите раунд в истории.")); return; }
  const { data: r } = await sb.from("casino_rounds").select("*").eq("id", roundId).single();
  if (!r) { out.appendChild(h("p", { class: "loss" }, "Раунд не найден.")); return; }
  const { data: seed } = await sb.from("fair_seeds").select("*").eq("id", r.seed_id).single();
  const { data: actions } = await sb.from("casino_actions").select("seq,action").eq("round_id", r.id).order("seq");

  const facts = h("dl", { class: "kv" },
    h("dt", {}, "Игра"), h("dd", {}, r.game_slug),
    h("dt", {}, "Раунд"), h("dd", { class: "mono" }, r.id),
    h("dt", {}, "Правила"), h("dd", { class: "mono" }, r.rule_version_id),
    h("dt", {}, ...glossify("Хеш server seed")), h("dd", { class: "mono" }, r.server_seed_hash),
    h("dt", {}, ...glossify("Server seed")), h("dd", { class: "mono" }, seed?.server_seed || "ещё не раскрыт"),
    h("dt", {}, ...glossify("Client seed")), h("dd", { class: "mono" }, r.client_seed),
    h("dt", {}, ...glossify("Nonce")), h("dd", { class: "mono" }, String(r.nonce)),
    h("dt", {}, "Исход на сервере"), h("dd", {}, r.game_slug === "roulette" ? `${r.state.number}, выплата ${fmt(r.payout)}` : `выплата ${fmt(r.payout)}`));
  const { data: rv } = await sb.from("game_rule_versions").select("rules").eq("id", r.rule_version_id).maybeSingle();
  const rules = rv?.rules || {};
  const verdictEl = h("div");
  out.append(h("div", { class: "card stack" }, facts), verdictEl);

  if (!seed?.server_seed) {
    clear(verdictEl, h("div", { class: "card stack" },
      h("p", {}, "Сид этого раунда ещё активен, поэтому серверный секрет не раскрыт. Раскройте пару сидов — проверить можно будет сразу."),
      actionButton("Раскрыть сид сейчас", async () => {
        try { await rpc("rpc_rotate_seed", { p_new_client_seed: null }); app.route(); } catch (e) { toast(e.message, "error"); }
      }, { class: "btn primary" })));
    return;
  }

  const STEP_LABELS = {
    roulette: ["Сверяем отпечаток секрета", "Пересчитываем число из сидов", "Пересчитываем выплату по вашим ставкам"],
    blackjack: ["Сверяем отпечаток секрета", "Пересчитываем ваши карты из шуза", "Сверяем карты дилера", "Пересчитываем выплату по правилам"],
  };
  const button = actionButton("Проверить, что касса тебя не наебала", async () => {
    const checks = [];
    const hash = await sha256hex(seed.server_seed);
    checks.push(["SHA-256(server seed) совпадает с хешем, показанным до ставки", hash === r.server_seed_hash]);
    if (r.game_slug === "roulette") {
      const n = await rouletteNumber(seed.server_seed, r.client_seed, r.nonce);
      checks.push([`Число из сидов: ${n} (${colorOf(n)})`, n === r.state.number]);
      const pay = roulettePayout(r.request, n);
      checks.push([`Выплата по вашим ставкам: ${fmt(pay)} ЛК`, pay === Number(r.payout)]);
    } else if (r.game_slug === "blackjack") {
      const deck = await shuffle(seed.server_seed, r.client_seed, r.nonce);
      const acts = (actions || []).filter((a) => a.action !== "start").map((a) => a.action);
      const rep = blackjackReplay(deck, Number(r.request.bet), acts);
      const sameHands = JSON.stringify(rep.hands.map((x) => x.cards)) === JSON.stringify(r.state.hands.map((x) => x.cards));
      checks.push([`Шуз из сидов → ваши руки: ${rep.hands.map((x) => x.cards.map(cardLabel).join(" ")).join(" | ")}`, sameHands]);
      checks.push([`Дилер: ${rep.dealer.map(cardLabel).join(" ")}`, JSON.stringify(rep.dealer) === JSON.stringify(r.state.dealer)]);
      checks.push([`Выплата по правилам: ${fmt(rep.payout)} ЛК`, rep.payout === Number(r.payout)]);
    } else {
      checks.push(...await gameChecks(r, seed.server_seed, actions || [], rules));
    }
    const pass = checks.every((c) => c[1]);
    const labels = STEP_LABELS[r.game_slug] || checks.map((_, i) => (i === 0 ? "Сверяем отпечаток секрета" : `Пересчитываем шаг ${i + 1} из сидов`));

    // Наглядный степпер: шаги появляются по одному, прогресс-бар растёт — цифры и термины остаются занудными,
    // но человек видит, что именно и в каком порядке проверяется, а не разом вываленный список.
    const stepEls = checks.map((_, i) => h("div", { class: "fstep pending" }, h("div", {}),
      h("div", { class: "fstep-body" }, h("div", { class: "fstep-t" }, labels[i] || `Шаг ${i + 1}`), h("div", { class: "fstep-d mono" }, ""))));
    const bar = h("div", { class: "fbar" });
    clear(verdictEl,
      h("div", { class: "card stack" },
        h("div", { class: "row", style: { justifyContent: "space-between" } }, h("b", {}, "Идёт проверка…"), h("span", { class: "muted num", id: "fpct" }, "0%")),
        h("div", { class: "fbar-wrap" }, bar),
        h("div", { class: "fstep-list" }, stepEls)));
    const pct = verdictEl.querySelector("#fpct");
    const step = reducedMotion() ? 0 : 260;
    for (let i = 0; i < checks.length; i++) {
      stepEls[i].className = "fstep active";
      if (step) await sleep(step);
      const [text, ok] = checks[i];
      stepEls[i].className = "fstep " + (ok ? "ok" : "bad");
      stepEls[i].querySelector(".fstep-d").className = "fstep-d mono";
      stepEls[i].querySelector(".fstep-d").textContent = text;
      const p = Math.round(((i + 1) / checks.length) * 100);
      bar.style.width = p + "%"; bar.className = "fbar" + (ok ? "" : " bad");
      pct.textContent = p + "%";
      if (step) await sleep(90);
    }
    if (step) await sleep(250);
    clear(verdictEl, h("div", { class: ["verdict", pass ? "pass" : "fail"] },
      h("h2", {}, pass ? "✓ Результат подтверждён." : "✗ Проверка не прошла"),
      h("p", { class: "meme-line" }, meme(pass ? "fair.pass" : "fair.fail")),
      h("div", { class: "fstep-list", style: { textAlign: "left", marginTop: "16px" } },
        checks.map(([t, ok], i) => h("div", { class: "fstep " + (ok ? "ok" : "bad") }, h("div", {}),
          h("div", { class: "fstep-body" }, h("div", { class: "fstep-t" }, labels[i] || `Шаг ${i + 1}`), h("div", { class: "fstep-d mono" }, t)))))));
  }, { class: "btn primary lg block" });
  verdictEl.appendChild(h("p", { class: "muted small" }, "Кнопка ниже прогоняет проверку по шагам — каждый шаг подписан по-человечески, цифры внутри те же самые, что видит сервер."));
  verdictEl.appendChild(button);
}

// Checks for the games pack. Each mirrors the published algorithm (see rule version), not the server code.
async function gameChecks(r, S, actions, rules) {
  const C = r.client_seed, N = r.nonce, st = r.state || {}, req = r.request || {}, bet = Number(r.bet_total), pay = Number(r.payout);
  const out = [];
  if (r.game_slug === "dice") {
    const x = await diceReplay(S, C, N, { bet, chance: Number(req.chance), direction: req.direction });
    out.push([`Число из сидов: ${(x.roll / 100).toFixed(2)}`, x.roll === Number(st.roll)]);
    out.push([`Выплата: ${fmt(x.payout)} ЛК`, x.payout === pay]);
  } else if (r.game_slug === "mines") {
    const m = Number(req.mines), mines = await minesPositions(S, C, N, m), rev = st.revealed || [];
    out.push([`Мины из сидов: ${mines.map((t) => t + 1).join(", ")}`, JSON.stringify(mines) === JSON.stringify(st.minePositions)]);
    if (st.phase === "BOOM") out.push([`Вы открыли клетку ${Number(st.hit) + 1} — там мина`, mines.includes(Number(st.hit)) && pay === 0]);
    else out.push([`${rev.length} чистых клеток → выплата ${fmt(minesPayout(bet, m, rev.length))} ЛК`, !rev.some((t) => mines.includes(t)) && minesPayout(bet, m, rev.length) === pay]);
  } else if (r.game_slug === "crash") {
    const cx = await crashPoint(S, C, N), crash = Math.round(Number(st.crash) * 100);
    out.push([`Точка краха из сидов: ×${(cx / 100).toFixed(2)}`, cx === crash]);
    if (st.phase === "CASHED") {
      const co = Math.round(Number(st.cashout) * 100);
      out.push([`Вывод на ×${(co / 100).toFixed(2)} не выше точки краха`, co <= cx]);
      out.push([`Выплата ⌊${fmt(bet)} × ${(co / 100).toFixed(2)}⌋ = ${fmt(Math.floor((bet * co) / 100))} ЛК`, Math.floor((bet * co) / 100) === pay]);
    } else out.push(["Вывода не было до краха → выплата 0", pay === 0]);
  } else if (r.game_slug === "plinko") {
    const x = await plinkoReplay(S, C, N, bet, rules.tables[req.risk]);
    out.push([`Путь шарика: ${x.path.map((b) => (b ? "→" : "←")).join("")} → лунка ${x.bucket}`, JSON.stringify(x.path) === JSON.stringify(st.path)]);
    out.push([`Выплата ×${rules.tables[req.risk][x.bucket]}: ${fmt(x.payout)} ЛК`, x.payout === pay]);
  } else if (r.game_slug === "horse") {
    const w = rules.horses.map((h0) => h0.w), bets = (Array.isArray(req) ? req : []).map((b) => ({ h: Number(b.h), a: Number(b.a) }));
    const x = await horseReplay(S, C, N, w, bets);
    out.push([`Порядок финиша: ${x.order.map((i) => i + 1).join(" → ")}`, JSON.stringify(x.order) === JSON.stringify(st.order)]);
    out.push([`Выплата по коэффициентам: ${fmt(x.payout)} ЛК`, x.payout === pay]);
  } else if (r.game_slug === "businka_slots") {
    const x = await slotsReplay(S, C, N, bet, rules);
    out.push([`Остановки барабанов (${x.spins.length} спин${x.spins.length > 1 ? "ов" : ""})`, JSON.stringify(x.spins.map((s) => s.stops)) === JSON.stringify((st.spins || []).map((s) => s.stops))]);
    out.push([`Выплата по таблице: ${fmt(x.payout)} ЛК`, x.payout === pay]);
  } else if (r.game_slug === "higher_lower") {
    const acts = actions.map((a) => a.action).filter((a) => ["higher", "lower", "cashout"].includes(a));
    const x = await hlReplay(S, C, N, bet, acts);
    const ids = (st.history || []).map((c) => c.id);
    out.push([`Карты из колоды: ${x.cards.map(hlLabel).join(" ")}`, JSON.stringify(x.cards) === JSON.stringify(ids)]);
    out.push([`Выплата: ${fmt(x.payout)} ЛК`, x.payout === pay]);
  } else {
    out.push(["Для этой игры верификатор ещё не написан", false]);
  }
  return out;
}

const HL_R = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
export const hlLabel = (c) => HL_R[c % 13] + ["♠", "♥", "♦", "♣"][Math.floor(c / 13)];
