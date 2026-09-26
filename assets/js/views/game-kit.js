// Shared building blocks for game views. Cosmetic + transport only: every number that matters comes from the server.
import { rpc, sb, ApiError } from "../api.js?v=2.1.1";
import { h, clear, fmt, signed, toast, store, newKey, sleep } from "../ui.js?v=2.1.1";
import { meme, outcomeContext, sessionMeme } from "../memes.js?v=2.1.1";
import { sfx } from "../sound.js?v=2.1.1";
import { bigWin } from "./shared.js?v=2.1.1";

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
  return [switcher(route), h("div", { class: "game-head gk-head" },
    h("div", {}, eyebrow ? h("div", { class: "eyebrow" }, eyebrow) : null, h("h1", {}, title), sub ? h("p", { class: "muted" }, sub) : null),
    h("div", { class: "spacer" }), badge ? h("span", { class: "badge gold" }, badge) : null)];
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
  if (round.balance === 67) toast(meme("balance67"));
  return { net, line, ctx: useCtx };
}

export function resultTag(round) {
  const net = round.payout - round.bet;
  return h("div", { class: ["gk-result", net > 0 ? "win" : net < 0 ? "loss" : "push"] },
    h("b", { class: "num" }, round.payout > 0 ? "+" + fmt(round.payout) + " ЛК" : signed(net) + " ЛК"),
    h("small", { class: "muted" }, `ставка ${fmt(round.bet)} · итог ${signed(net)}`));
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
