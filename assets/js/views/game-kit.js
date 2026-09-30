// Shared building blocks for game views. Cosmetic + transport only: every number that matters comes from the server.
import { rpc, sb, ApiError } from "../api.js?v=2.3.5";
import { h, clear, fmt, signed, toast, store, newKey, sleep } from "../ui.js?v=2.3.5";
import { meme, outcomeContext, sessionMeme } from "../memes.js?v=2.3.5";
import { sfx } from "../sound.js?v=2.3.5";
import { bigWin, maybeFunnyEvent } from "./shared.js?v=2.3.5";

export const GAMES = [
  { slug: "roulette", route: "roulette", name: "Рулетка", short: "Рулетка", emoji: "🎡", tag: "97,3%", desc: "Один ноль, 37 чисел и бесконечная вера в красное." },
  { slug: "blackjack", route: "blackjack", name: "Блэкджек", short: "21", emoji: "🃏", tag: "≈99,4%", desc: "Дилер стоит на 17. Вы — на своём, даже при 16 против туза." },
  { slug: "businka_slots", route: "slots", name: "Бусинка: Кошачья фортуна", short: "Бусинка", emoji: "🐈", tag: "96,2%", desc: "Слот 5×3, 10 линий, фриспины ×2. Кот не гарантирует ничего." },
  { slug: "crash", route: "crash", name: "Crash: Курс ЛК", short: "Crash", emoji: "📈", tag: "97%", desc: "График растёт, пока не перестанет. Заберите раньше, чем рынок вспомнит о гравитации." },
  { slug: "dice", route: "dice", name: "Dice", short: "Dice", emoji: "🎲", tag: "97%", desc: "Вы задаёте шанс, комитет по случайным числам — число." },
  { slug: "mines", route: "mines", name: "Минное поле бухгалтерии", short: "Mines", emoji: "💣", tag: "97%", desc: "25 клеток, от 1 до 24 мин. «Ещё одну» — самые дорогие слова." },
  { slug: "higher_lower", route: "higher_lower", name: "Больше / Меньше", short: "Hi-Lo", emoji: "🂡", tag: "97%", desc: "Одна колода, 52 карты, коэффициент по реальным остаткам." },
  { slug: "plinko", route: "plinko", name: "Plinko: Кредитная воронка", short: "Plinko", emoji: "🟡", tag: "≈97,1%", desc: "12 рядов гвоздей и шарик, который разбирается в финансах лучше вас." },
  { slug: "horse", route: "horse", name: "Скачки имени неправильных выводов", short: "Скачки", emoji: "🐎", tag: "95%", desc: "8 лошадей, честные веса, букмекерская маржа 5% — публично." },
];
export const gameBySlug = (s) => GAMES.find((g) => g.slug === s);

const ruleCache = new Map();
export async function currentRules(slug, fallback = {}) {
  if (ruleCache.has(slug)) return ruleCache.get(slug);
  const { data } = await sb.from("game_rule_versions").select("id,rules").eq("game_slug", slug).eq("is_current", true).maybeSingle();
  const r = { id: data?.id || null, ...(fallback || {}), ...(data?.rules || {}) };
  ruleCache.set(slug, r);
  return r;
}

// Horizontal game switcher shown above every game.
export function switcher(active) {
  return h("nav", { class: "game-switch", "aria-label": "Игры" },
    GAMES.map((g) => h("a", { href: "#/" + g.route, class: g.route === active ? "on" : null, "aria-current": g.route === active ? "page" : null },
      h("span", { class: "e", "aria-hidden": "true" }, g.emoji), g.short)));
}

export function head({ eyebrow, title, sub, badge, route }) {
  const g = GAMES.find((x) => x.route === route);
  return [switcher(route), h("div", { class: "game-head gk-head" },
    h("div", {}, eyebrow ? h("div", { class: "eyebrow" }, eyebrow) : null, h("h1", {}, title), sub ? h("p", { class: "muted" }, sub) : null),
    h("div", { class: "spacer" }), badge ? h("span", { class: "badge gold" }, badge) : null), g ? howTo(g.slug) : null];
}

// Bet input with quick buttons. Clamps to rules and remembers the last value per game.
export function betInput({ app, min = 1, max = 5000, key, value = 100, label = "Ставка, ЛК", onChange }) {
  let v = store.get("bet-" + key, value);
  const inp = h("input", { class: "input num gk-bet-input", type: "number", inputmode: "numeric", min, max, step: 1, value: v, "aria-label": label });
  const set = (x, silent) => {
    x = Math.floor(Number(x) || 0);
    x = Math.max(min, Math.min(max, x));
    v = x; inp.value = String(x); store.set("bet-" + key, x);
    if (!silent && onChange) onChange(x);
  };
  inp.addEventListener("change", () => set(inp.value));
  inp.addEventListener("input", () => { const x = Math.floor(Number(inp.value)); if (x >= min && x <= max) { v = x; onChange && onChange(x); } });
  const q = (t, f) => h("button", { class: "btn sm", type: "button", onclick: () => { f(); } }, t);
  const quick = h("div", { class: "gk-quick" },
    q("½", () => set(Math.floor(v / 2))), q("×2", () => set(v * 2)), q("Мин", () => set(min)),
    q("Макс", () => set(Math.min(max, Math.max(min, app.me.balance)))));
  const el = h("div", { class: "field gk-bet" }, h("label", {}, label, h("small", { class: "muted" }, ` ${fmt(min)}–${fmt(max)}`)),
    h("div", { class: "gk-bet-row" }, inp), quick);
  set(v, true);
  return {
    el, get: () => { set(inp.value, true); return v; }, set,
    disable(b) { inp.disabled = b; quick.querySelectorAll("button").forEach((x) => (x.disabled = b)); },
  };
}

// Idempotent RPC: the same key is re-sent after a network failure, so a lost response never double-charges.
export async function send(name, args, { retries = 2 } = {}) {
  for (let i = 0; ; i++) {
    try { return await rpc(name, args); } catch (e) {
      if (!(e instanceof ApiError) || e.code !== "network" || i >= retries || !("p_idempotency_key" in args)) throw e;
      await sleep(700 * (i + 1));
    }
  }
}
export const key = (p) => newKey(p);

export function activeRound(app, slug) {
  return (app.me?.activeRounds || []).find((r) => r.game === slug) || null;
}

// Result bookkeeping for a finished round: balance, sound, memes, rare big-win overlay.
export function settle(app, round, { ctx, vars = {}, award = null, memeEl = null, toastIt = false } = {}) {
  const net = round.payout - round.bet;
  if (round.balance !== undefined && round.balance !== null) app.setBalance(round.balance);
  const base = outcomeContext({ bet: round.bet, payout: round.payout });
  const useCtx = base === "win.big" ? "win.big" : (ctx || base);
  const line = sessionMeme({ won: net > 0, lost: net < 0, balance: round.balance, award }) || meme(useCtx, { win: round.payout, ...vars });
  if (memeEl) memeEl.textContent = line;
  if (toastIt) toast(line, net > 0 ? "ok" : "");
  if (net > 0) (base === "win.big" ? sfx.bigWin : sfx.win)(); else if (net < 0) sfx.loss();
  if (base === "win.big") bigWin(round.payout);
  else maybeFunnyEvent(useCtx.split(".")[0], net);
  if (round.balance === 67) toast(meme("balance67"));
  return { net, line, ctx: useCtx };
}

// Big, unambiguous verdict: headline + net result + one line explaining WHY.
export function resultTag(round, why = "") {
  const net = round.payout - round.bet;
  const kind = net > 0 ? "win" : net < 0 ? (round.payout > 0 ? "part" : "loss") : "push";
  const head = { win: "ВЫИГРЫШ", loss: "ПРОИГРЫШ", part: "ЧАСТИЧНЫЙ ВОЗВРАТ", push: "ПРИ СВОИХ" }[kind];
  return h("div", { class: ["gk-result", kind === "part" ? "loss" : kind], role: "status" },
    h("span", { class: "gk-verdict" }, head),
    h("b", { class: "num" }, (net === 0 ? "0" : signed(net)) + " ЛК"),
    h("small", { class: "muted" }, `ставка ${fmt(round.bet)} · вернулось ${fmt(round.payout)}`),
    why ? h("span", { class: "gk-why" }, why) : null);
}

// Brief coloured pulse on the game stage so the outcome is visible even at a glance.
export function flash(el, round) {
  if (!el) return;
  const net = round.payout - round.bet;
  el.classList.remove("gk-flash-win", "gk-flash-loss", "gk-flash-push"); void el.offsetWidth;
  el.classList.add(net > 0 ? "gk-flash-win" : net < 0 ? "gk-flash-loss" : "gk-flash-push");
}

// «Как играть»: plain rules first, jokes second. Open on the first visit, then remembered per game.
const HOWTO = {
  roulette: { goal: "Угадать, куда упадёт шарик: 37 чисел, одно зелёное зеро.",
    steps: ["Выберите фишку внизу и кликните по числу, цвету, дюжине — или по границе между числами (сплит/угол).",
      "Можно ставить на много позиций сразу. «Повторить» ставит прошлый набор, «×2» — удваивает.",
      "Нажмите «Крутить». Выигравшие ставки подсветятся зелёным в разборе спина."],
    pays: "Число 35:1 · сплит 17:1 · стрит 11:1 · угол 8:1 · линия 5:1 · дюжина/колонка 2:1 · цвет, чёт/нечет, половина 1:1.",
    joke: "Зеро не против вас лично. Оно против всех одинаково — это и есть честность." },
  blackjack: { goal: "Набрать больше, чем дилер, но не больше 21.",
    steps: ["Картинки = 10, туз = 1 или 11. Сделайте ставку и «Раздать».",
      "«Ещё» — взять карту, «Хватит» — остановиться, «Удвоить» — удвоить ставку и взять ровно одну карту, «Сплит» — разделить пару.",
      "Дилер добирает до 17 и останавливается. У кого ближе к 21 — тот и прав."],
    pays: "Победа 1:1 · блэкджек (туз + 10 с раздачи) 3:2 · ничья — ставка возвращается.",
    joke: "16 против туза дилера — классический момент, когда все становятся философами." },
  businka_slots: { goal: "Собрать 3–5 одинаковых символов слева направо на одной из 10 линий.",
    steps: ["Выберите ставку и нажмите «Крутить» (или пробел).",
      "🐾 Лапа заменяет любой символ, кроме клубка. Три лапы с начала линии платят как Бусинка.",
      "🧶 Три клубка в любом месте — фриспины с множителем ×2. Выигрышные клетки подсвечиваются."],
    pays: "Выплата линии × (ставка / 10). Таблица выплат — под автоматом.",
    joke: "Кот не знает, что это слот. Кот думает, что вы его кормите. В каком-то смысле так и есть." },
  crash: { goal: "Забрать ставку до того, как график рухнет.",
    steps: ["Сделайте ставку — множитель начнёт расти с ×1.00.",
      "Нажмите «Забрать» в любой момент: получите ставку × текущий множитель.",
      "Не успели до краха — ставка сгорает. Можно заранее включить автовывод на нужном ×."],
    pays: "Выплата = ставка × множитель в момент вывода. Точка краха решена сидом до старта.",
    joke: "Лучший трейдер — тот, кто нажал кнопку. Второй лучший — тот, кто не нажимал «Купить»." },
  dice: { goal: "Угадать, будет число от 0 до 99,99 ниже или выше вашей границы.",
    steps: ["Ползунком выберите шанс (2–95%). Зелёная полоса — ваша зона выигрыша.",
      "«Ниже» — выигрыш, если число меньше шанса; «Выше» — если больше (100 − шанс).",
      "Нажмите кнопку — маркер покажет число, а зона — выиграли вы или нет."],
    pays: "Множитель = 97 / шанс. 50% → ×1.94, 10% → ×9.7.",
    joke: "Чем меньше шанс, тем больше множитель и тем громче потом рассказы." },
  mines: { goal: "Открывать клетки без мин и вовремя забрать деньги.",
    steps: ["Выберите ставку и число мин (больше мин — быстрее растёт множитель).",
      "Кликайте по клеткам: 💎 — безопасно, множитель растёт; 💣 — раунд проигран.",
      "«Забрать» в любой момент после первой клетки. После игры видно, где были все мины."],
    pays: "Каждая безопасная клетка повышает множитель по честной вероятности (минус 3%).",
    joke: "«Ну ещё одну» — самые дорогие два слова в этой игре." },
  higher_lower: { goal: "Угадать, будет следующая карта старше или младше.",
    steps: ["Сделайте ставку — откроется первая карта. Туз старший, двойка младшая.",
      "Выберите «Больше» или «Меньше». Процент на кнопке — реальный шанс по оставшейся колоде.",
      "Угадали — множитель растёт, можно продолжать или забрать. Не угадали — раунд окончен. Карты того же номинала пропускаются."],
    pays: "Множитель = 0,97 / вероятность всей вашей серии угадываний.",
    joke: "Если на столе туз — «больше» не нажимается. Мы проверяли. Много раз." },
  plinko: { goal: "Шарик падает через 12 рядов гвоздей — куда упадёт, такой множитель и получите.",
    steps: ["Выберите ставку и риск: низкий — ровнее, высокий — края ×170, середина ×0.2.",
      "Нажмите «Бросить». Можно бросать несколько шариков подряд.",
      "Лунка, куда попал шарик, подсветится, а в ленте ниже появится результат."],
    pays: "Выплата = ставка × множитель лунки. Коэффициенты подписаны под доской.",
    joke: "Шарик не слушает уговоров. Мы спрашивали." },
  horse: { goal: "Угадать, какая лошадь придёт первой.",
    steps: ["Впишите сумму напротив одной или нескольких лошадей (кнопки +10/+100).",
      "Коэффициент рядом с лошадью — сколько получите за каждый ЛК, если она победит.",
      "«Принять ставку» — начнётся забег. Ваши лошади помечены, победитель подсвечен."],
    pays: "Выигрыш = ставка на победителя × коэффициент. Ставки на остальных лошадей сгорают.",
    joke: "Фаворит приходит первым часто. Но не всегда — поэтому это и называется скачки." },
};
export function howTo(slug) {
  const r = HOWTO[slug]; if (!r) return null;
  const seen = store.get("howto-" + slug, false);
  const d = h("details", { class: "card gk-howto", open: !seen, ontoggle: () => store.set("howto-" + slug, true) },
    h("summary", {}, h("span", { class: "gk-howto-q" }, "?"), "Как играть — за 20 секунд"),
    h("div", { class: "gk-howto-body" },
      h("p", { class: "gk-howto-goal" }, h("b", {}, "Цель: "), r.goal),
      h("ol", {}, r.steps.map((t) => h("li", {}, t))),
      h("p", { class: "gk-howto-pays" }, h("b", {}, "Выплаты: "), r.pays),
      h("p", { class: "gk-howto-joke" }, "💬 ", r.joke)));
  store.set("howto-" + slug, true);
  return d;
}

export function errorToast(e) {
  toast(e instanceof ApiError ? e.message : meme("error"), "error");
  sfx.error();
}

// Small print shown under each game: rules version, RTP, verification link. Honest by design.
export function footnote(rules, text) {
  return h("p", { class: "gk-foot muted" }, text, " ", h("span", { class: "mono" }, rules?.id || ""), " · ",
    h("a", { href: "#/fairness" }, "как проверить"), " · ", h("a", { href: "#/office/rules" }, "правила конторы"));
}

export { h, clear, fmt, signed, toast, sfx, meme };
