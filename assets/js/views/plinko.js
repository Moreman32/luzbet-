import { h, clear, fmt, toast, sfx, meme, head, betInput, send, key, settle, errorToast, footnote, currentRules } from "./game-kit.js";
import { store, reducedMotion, sleep, signed } from "../ui.js";

const ROWS = 12;
const RISK = { low: "Низкий", medium: "Средний", high: "Высокий" };
const RISK_NOTE = { low: "Консервативный вклад: медленно теряете, иногда радуетесь.", medium: "Сбалансированный портфель сомнительных решений.", high: "Кредитное плечо без кредита. Середина платит ×0,2." };
const FALLBACK = {
  low: [10, 3, 1.6, 1.4, 1.1, 0.95, 0.5, 0.95, 1.1, 1.4, 1.6, 3, 10],
  medium: [33, 11, 4, 2, 1.1, 0.55, 0.3, 0.55, 1.1, 2, 4, 11, 33],
  high: [170, 24, 8, 2, 0.63, 0.2, 0.2, 0.2, 0.63, 2, 8, 24, 170],
};

export async function mount(root, { app }) {
  const rules = await currentRules("plinko", { minBet: 1, maxBet: 5000, tables: FALLBACK });
  const tables = rules.tables || FALLBACK;
  let risk = store.get("plinko-risk", "medium");
  let inflight = 0;
  const W = 520, H = 440, top = 26, gap = 32;
  const X = (row, k) => W / 2 + (k - row / 2) * gap;
  const Y = (row) => top + row * gap;

  const svg = h("svg:svg", { viewBox: `0 0 ${W} ${H}`, class: "pl-board", role: "img", "aria-label": "Доска Plinko" });
  for (let r = 0; r < ROWS; r++) for (let k = 0; k <= r; k++) svg.appendChild(h("svg:circle", { cx: X(r, k), cy: Y(r), r: 3.6, class: "pl-peg" }));
  const balls = h("svg:g");
  svg.appendChild(balls);
  const buckets = h("div", { class: "pl-buckets" });
  const memeEl = h("p", { class: "meme-line" });
  const log = h("div", { class: "pl-log" });
  const bet = betInput({ app, min: rules.minBet, max: rules.maxBet, key: "plinko", value: 20 });
  const riskSeg = h("div", { class: "seg" });
  const riskNote = h("p", { class: "muted small" });
  const dropBtn = h("button", { class: "btn primary lg block", type: "button", onclick: () => drop() }, "Бросить шарик");

  function tone(m) { return m >= 10 ? "t5" : m >= 3 ? "t4" : m >= 1.1 ? "t3" : m >= 0.9 ? "t2" : "t1"; }
  function drawBuckets() {
    clear(buckets, tables[risk].map((m, i) => h("div", { class: ["pl-b", tone(m)], dataset: { i } }, "×" + m)));
    clear(riskSeg, Object.entries(RISK).map(([k, l]) => h("button", { type: "button", class: k === risk ? "on" : null, onclick: () => { risk = k; store.set("plinko-risk", k); drawBuckets(); } }, l)));
    riskNote.textContent = RISK_NOTE[risk] + " RTP " + (rules.rtp?.[risk] ?? "≈97") + "%.";
  }

  async function animate(path) {
    const ball = h("svg:circle", { r: 8, class: "pl-ball", cx: W / 2, cy: 4 });
    balls.appendChild(ball);
    let k = 0;
    const pts = [[W / 2, Y(0) - 11]];
    for (let r = 0; r < ROWS; r++) { k += path[r]; pts.push([X(r + 1, k), Y(r + 1) - 11]); }
    if (!reducedMotion()) {
      for (const [x, y] of pts) { ball.setAttribute("cx", x); ball.setAttribute("cy", y); sfx.tick(); await sleep(95); }
    } else { const [x, y] = pts[pts.length - 1]; ball.setAttribute("cx", x); ball.setAttribute("cy", y); }
    setTimeout(() => ball.remove(), 900);
  }

  async function drop() {
    const b = bet.get();
    if (b > app.me.balance) return toast("Шарик требует предоплату. Баланса не хватает.", "error");
    if (inflight >= 5) return toast("Не больше пяти шариков в воронке. Гравитация не успевает.", "");
    inflight++;
    const riskNow = risk;
    let r;
    try {
      r = (await send("rpc_plinko_drop", { p_bet: b, p_risk: riskNow, p_idempotency_key: key("pl") })).round;
    } catch (e) { inflight--; errorToast(e); return; }
    app.setBalance(r.balance - r.payout);           // show the debit while the ball falls; final balance comes right after
    await animate(r.state.path);
    inflight--;
    const m = Number(r.state.multiplier), idx = r.state.bucket;
    const el = buckets.querySelector(`[data-i="${idx}"]`);
    if (el && riskNow === risk) { el.classList.remove("hit"); void el.offsetWidth; el.classList.add("hit"); }
    const ctx = idx === 0 || idx === 12 ? "plinko.edge" : r.payout > r.bet ? "plinko.win" : idx >= 5 && idx <= 7 ? "plinko.center" : "plinko.loss";
    settle(app, r, { ctx, vars: { mult: m }, memeEl, award: idx === 0 || idx === 12 ? "plinkoEdge" : null });
    const net = r.payout - r.bet;
    log.prepend(h("span", { class: ["pl-entry", net > 0 ? "win" : net < 0 ? "loss" : ""] }, "×" + m, " ", h("small", {}, signed(net))));
    while (log.children.length > 12) log.lastChild.remove();
  }

  drawBuckets();
  root.append(h("div", { class: "container stack" },
    ...head({ route: "plinko", eyebrow: "Кредитный отдел", title: "Plinko: Кредитная воронка", sub: "Шарик падает через 12 рядов гвоздей. Каждый гвоздь — это одно честное «налево или направо» из вашего сида.", badge: "RTP ≈97%" }),
    h("section", { class: "gk-layout" },
      h("div", { class: "card gilded gk-stage pl-stage" }, svg, buckets, memeEl, log),
      h("aside", { class: "card gk-panel stack" }, bet.el, h("div", { class: "field" }, h("label", {}, "Риск-профиль"), riskSeg), riskNote, dropBtn,
        h("p", { class: "muted small" }, "Можно бросать несколько шариков подряд. Каждый — отдельный раунд со своим nonce."))),
    footnote(rules, "Путь = 12 × fairInt(2), лунка = число «вправо». Выплата = ⌊ставка × коэффициент лунки⌋.")));
}
