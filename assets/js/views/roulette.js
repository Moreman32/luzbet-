import { rpc, sb, ApiError } from "../api.js";
import { h, clear, fmt, signed, toast, store, newKey, reducedMotion, sleep } from "../ui.js";
import { meme, outcomeContext } from "../memes.js";
import { sfx } from "../sound.js";
import { colorOf } from "../fair.js";
import { bigWin } from "./shared.js";

const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const CHIPS = [1, 5, 25, 100, 500, 1000];
const LABEL = { straight: "Число", split: "Сплит", street: "Стрит", corner: "Корнер", sixline: "Линия", column: "Колонка", dozen: "Дюжина", color: "Цвет", parity: "Чёт/нечет", half: "Половина" };
const RATIO = { straight: 35, split: 17, street: 11, corner: 8, sixline: 5, column: 2, dozen: 2, color: 1, parity: 1, half: 1 };
const V_LABEL = { red: "Красное", black: "Чёрное", odd: "Нечёт", even: "Чёт", low: "1–18", high: "19–36" };

const betKey = (b) => b.t + ":" + (b.n ? b.n.join("-") : b.v);
const betName = (b) => b.n ? `${LABEL[b.t]} ${b.n.join("·")}` : b.t === "column" ? `Колонка ${b.v}` : b.t === "dozen" ? `Дюжина ${b.v}` : V_LABEL[b.v];

function buildWheel() {
  const step = 360 / 37, R = 150;
  const svg = h("svg:svg", { viewBox: "-160 -160 320 320", role: "img", "aria-label": "Колесо рулетки" });
  const defs = h("svg:defs", {},
    h("svg:radialGradient", { id: "rim" }, h("svg:stop", { offset: ".82", "stop-color": "#2a2116" }), h("svg:stop", { offset: "1", "stop-color": "#0c0a07" })),
    h("svg:linearGradient", { id: "gold", x1: 0, y1: 0, x2: 1, y2: 1 }, h("svg:stop", { offset: 0, "stop-color": "#f0d898" }), h("svg:stop", { offset: ".5", "stop-color": "#c89d4f" }), h("svg:stop", { offset: 1, "stop-color": "#8a6428" })));
  svg.append(defs, h("svg:circle", { r: 158, fill: "url(#rim)", stroke: "url(#gold)", "stroke-width": 3 }));
  const rotor = h("svg:g", { class: "rotor" });
  ORDER.forEach((n, i) => {
    const a0 = ((i - 0.5) * step - 90) * Math.PI / 180, a1 = ((i + 0.5) * step - 90) * Math.PI / 180;
    const r0 = 88;
    const d = `M${r0 * Math.cos(a0)} ${r0 * Math.sin(a0)} L${R * Math.cos(a0)} ${R * Math.sin(a0)} A${R} ${R} 0 0 1 ${R * Math.cos(a1)} ${R * Math.sin(a1)} L${r0 * Math.cos(a1)} ${r0 * Math.sin(a1)} A${r0} ${r0} 0 0 0 ${r0 * Math.cos(a0)} ${r0 * Math.sin(a0)}Z`;
    const c = colorOf(n);
    rotor.appendChild(h("svg:path", { d, fill: c === "green" ? "#0f7a47" : c === "red" ? "#a3202b" : "#141311", stroke: "#b8913f", "stroke-width": ".6" }));
    const am = (i * step - 90) * Math.PI / 180, tr = 136;
    rotor.appendChild(h("svg:text", { x: tr * Math.cos(am), y: tr * Math.sin(am), fill: "#f3ecdc", "font-size": 10.5, "font-weight": 700,
      "text-anchor": "middle", "dominant-baseline": "central", transform: `rotate(${i * step} ${tr * Math.cos(am)} ${tr * Math.sin(am)})`, "font-family": "Inter, sans-serif" }, String(n)));
  });
  rotor.append(h("svg:circle", { r: 150, fill: "none", stroke: "none" }), h("svg:circle", { r: 88, fill: "none", stroke: "url(#gold)", "stroke-width": 2 }),
    h("svg:circle", { r: 70, fill: "#1b1611", stroke: "#3b2f1d", "stroke-width": 1 }));
  for (let k = 0; k < 8; k++) {
    const a = k * 45 * Math.PI / 180;
    rotor.appendChild(h("svg:line", { x1: 0, y1: 0, x2: 62 * Math.cos(a), y2: 62 * Math.sin(a), stroke: "url(#gold)", "stroke-width": 3, "stroke-linecap": "round" }));
  }
  rotor.appendChild(h("svg:circle", { r: 14, fill: "url(#gold)" }));
  const ballTrack = h("svg:g", { class: "ball-track" }, h("svg:circle", { r: 150, fill: "none", stroke: "none" }), h("svg:circle", { cx: 0, cy: -112, r: 6.5, fill: "#fbf8f1", stroke: "#bdb4a0", "stroke-width": 1 }));
  svg.append(rotor, ballTrack, h("svg:path", { d: "M-7 -158 L7 -158 L0 -146 Z", fill: "url(#gold)" }));
  return { svg, rotor, ballTrack };
}

export async function mount(root, { app }) {
  const { data: rv } = await sb.from("game_rule_versions").select("id,rules").eq("game_slug", "roulette").eq("is_current", true).single();
  const rules = rv?.rules || { maxBetPerPosition: 5000, maxTotalBet: 10000, maxPositions: 60, minBet: 1 };
  let chip = store.get("rl-chip", 25);
  let bets = new Map();           // key -> {t,n|v,a}
  let history = [];               // undo stack of keys
  let spinning = false;
  let rotation = 0, ballRot = 0;
  let lastBets = store.get("rl-last", null);

  const wheel = buildWheel();
  const outcome = h("div", { class: "outcome", "aria-live": "polite" }, h("span", { class: "muted" }, "Сделайте ставку"));
  const memeEl = h("p", { class: "meme-line" });
  const recentEl = h("div", { class: "recent", "aria-label": "Последние числа" });
  const totalEl = h("span", { class: "v num" }, "0");
  const maxWinEl = h("span", { class: "v num" }, "0");
  const linesEl = h("div", { class: "bet-lines" });
  const seedEl = h("div", { class: "stack", style: { fontSize: "13px" } });
  const tableWrap = h("div", { class: "rtable-wrap" });
  const spinBtn = h("button", { class: "btn primary lg block", type: "button" }, "Крутить");
  const retryBox = h("div");

  const chipsEl = h("div", { class: "chips", role: "radiogroup", "aria-label": "Номинал фишки" }, CHIPS.map((v) =>
    h("button", { class: ["chip", v === chip ? "on" : ""], dataset: { v }, type: "button", role: "radio", "aria-checked": String(v === chip),
      "aria-label": fmt(v) + " ЛК", onclick: (e) => { chip = v; store.set("rl-chip", v); sfx.ui();
        chipsEl.querySelectorAll(".chip").forEach((c) => { c.classList.toggle("on", c === e.currentTarget); c.setAttribute("aria-checked", String(c === e.currentTarget)); }); } },
    v >= 1000 ? v / 1000 + "K" : String(v))));

  const btnUndo = h("button", { class: "btn sm", type: "button", onclick: () => undo() }, "Отменить");
  const btnClear = h("button", { class: "btn sm", type: "button", onclick: () => { bets.clear(); history = []; redraw(); } }, "Очистить");
  const btnRepeat = h("button", { class: "btn sm", type: "button", onclick: () => repeat() }, "Повторить");
  const btnDouble = h("button", { class: "btn sm", type: "button", onclick: () => doubleAll() }, "×2");

  function total() { let t = 0; for (const b of bets.values()) t += b.a; return t; }
  function maxWin() {
    let best = 0;
    for (let n = 0; n <= 36; n++) {
      let w = 0;
      for (const b of bets.values()) if (covers(b).includes(n)) w += b.a * (RATIO[b.t] + 1);
      best = Math.max(best, w);
    }
    return best;
  }
  function covers(b) {
    if (b.n) return b.n;
    const all = Array.from({ length: 36 }, (_, i) => i + 1);
    if (b.t === "column") return all.filter((n) => (n - Number(b.v)) % 3 === 0);
    if (b.t === "dozen") return all.filter((n) => n > (b.v - 1) * 12 && n <= b.v * 12);
    if (b.t === "color") return all.filter((n) => colorOf(n) === b.v);
    if (b.t === "parity") return all.filter((n) => (n % 2 === 1) === (b.v === "odd"));
    if (b.t === "half") return all.filter((n) => (b.v === "low" ? n <= 18 : n >= 19));
    return [];
  }

  function place(spec) {
    if (spinning) return;
    const k = betKey(spec);
    const cur = bets.get(k);
    const next = (cur?.a || 0) + chip;
    if (next > rules.maxBetPerPosition) { toast(`Максимум на позицию — ${fmt(rules.maxBetPerPosition)} ЛК.`); return; }
    if (total() + chip > rules.maxTotalBet) { toast(`Максимум на спин — ${fmt(rules.maxTotalBet)} ЛК.`); return; }
    if (!cur && bets.size >= rules.maxPositions) { toast("Слишком много позиций."); return; }
    if (total() + chip > app.me.balance) { toast("Ставка больше баланса."); return; }
    bets.set(k, { ...spec, a: next });
    history.push([k, chip]);
    sfx.chip();
    redraw();
  }
  function undo() {
    const last = history.pop(); if (!last) return;
    const [k, amt] = last; const b = bets.get(k); if (!b) return;
    if (b.a - amt <= 0) bets.delete(k); else bets.set(k, { ...b, a: b.a - amt });
    redraw();
  }
  function repeat() {
    if (!lastBets || spinning) return;
    const t = lastBets.reduce((a, b) => a + b.a, 0);
    if (t > app.me.balance) { toast("Для повтора не хватает баланса."); return; }
    bets = new Map(lastBets.map((b) => [betKey(b), { ...b }])); history = lastBets.map((b) => [betKey(b), b.a]); redraw();
  }
  function doubleAll() {
    if (spinning || !bets.size) return;
    const nb = new Map([...bets].map(([k, b]) => [k, { ...b, a: b.a * 2 }]));
    const t = [...nb.values()].reduce((a, b) => a + b.a, 0);
    if ([...nb.values()].some((b) => b.a > rules.maxBetPerPosition) || t > rules.maxTotalBet) { toast("Удвоение выходит за лимиты стола."); return; }
    if (t > app.me.balance) { toast("Удвоение больше баланса."); return; }
    for (const [k, b] of bets) history.push([k, b.a]);
    bets = nb; redraw();
  }

  // ---------- table ----------
  let table, cells = new Map(), vertical = false;
  const vq = window.matchMedia("(max-width: 720px)");
  function buildTable() {
    vertical = vq.matches;
    cells = new Map();
    table = h("div", { class: ["rtable", vertical ? "v" : ""], role: "group", "aria-label": "Игровой стол" });
    if (vertical) table.style.gridTemplateColumns = "repeat(3, 1fr) 40px 40px", table.style.gridTemplateRows = "44px repeat(12, 38px) 40px";
    const pos = (el, col, row, cs = 1, rs = 1) => { el.style.gridColumn = `${col} / span ${cs}`; el.style.gridRow = `${row} / span ${rs}`; return el; };
    const cell = (cls, label, spec, aria) => h("button", { class: ["rcell", cls], type: "button", "aria-label": aria || label, onclick: () => place(spec) }, label);
    const zero = cell("zero", h("span", { class: "pip" }, "0"), { t: "straight", n: [0] }, "Зеро");
    table.appendChild(vertical ? pos(zero, 1, 1, 3, 1) : pos(zero, 1, 1, 1, 3));
    cells.set(0, zero);
    for (let c = 0; c < 12; c++) for (let r = 0; r < 3; r++) {
      const n = 3 * c + 3 - r;
      const el = cell(colorOf(n), h("span", { class: "pip" }, String(n)), { t: "straight", n: [n] }, "Число " + n);
      table.appendChild(vertical ? pos(el, 3 - r, c + 2) : pos(el, c + 2, r + 1));
      cells.set(n, el);
    }
    for (let r = 0; r < 3; r++) {
      const v = String(3 - r);
      const el = cell("col", "2:1", { t: "column", v }, "Колонка " + v);
      table.appendChild(vertical ? pos(el, 3 - r, 14) : pos(el, 14, r + 1));
    }
    for (let d = 0; d < 3; d++) {
      const el = cell("dozen", ["1–12", "13–24", "25–36"][d], { t: "dozen", v: String(d + 1) }, "Дюжина " + (d + 1));
      table.appendChild(vertical ? pos(el, 4, 2 + d * 4, 1, 4) : pos(el, 2 + d * 4, 4, 4, 1));
    }
    const outs = [["half", "low", "1–18"], ["parity", "even", "ЧЁТ"], ["color", "red", null], ["color", "black", null], ["parity", "odd", "НЕЧЁТ"], ["half", "high", "19–36"]];
    outs.forEach(([t, v, label], i) => {
      const content = label || h("span", { class: "diamond", style: { background: v === "red" ? "var(--red)" : "#111", border: "1px solid rgba(255,255,255,.4)" } });
      const el = cell("outside", content, { t, v }, V_LABEL[v]);
      table.appendChild(vertical ? pos(el, 5, 2 + i * 2, 1, 2) : pos(el, 2 + i * 2, 5, 2, 1));
    });
    clear(tableWrap, table);
    requestAnimationFrame(layoutHotspots);
  }

  // Hotspots for split / street / corner / six line / zero combos, computed from real cell geometry.
  function combos() {
    const out = [];
    const n = (c, r) => 3 * c + 3 - r;
    for (let c = 0; c < 12; c++) {
      out.push({ t: "street", n: [n(c, 2), n(c, 1), n(c, 0)] });
      for (let r = 0; r < 2; r++) out.push({ t: "split", n: [n(c, r + 1), n(c, r)] });
      if (c < 11) {
        out.push({ t: "sixline", n: [n(c, 2), n(c, 1), n(c, 0), n(c + 1, 2), n(c + 1, 1), n(c + 1, 0)] });
        for (let r = 0; r < 3; r++) out.push({ t: "split", n: [n(c, r), n(c + 1, r)] });
        for (let r = 0; r < 2; r++) out.push({ t: "corner", n: [n(c, r + 1), n(c, r), n(c + 1, r + 1), n(c + 1, r)] });
      }
    }
    out.push({ t: "split", n: [0, 1] }, { t: "split", n: [0, 2] }, { t: "split", n: [0, 3] },
      { t: "street", n: [0, 1, 2] }, { t: "street", n: [0, 2, 3] }, { t: "corner", n: [0, 1, 2, 3] });
    return out.map((b) => ({ ...b, n: [...b.n].sort((a, z) => a - z) }));
  }
  function layoutHotspots() {
    if (!table) return;
    table.querySelectorAll(".hotspot").forEach((x) => x.remove());
    const tb = table.getBoundingClientRect();
    const box = (n) => { const r = cells.get(n).getBoundingClientRect(); return { l: r.left - tb.left, t: r.top - tb.top, r: r.right - tb.left, b: r.bottom - tb.top, cx: (r.left + r.right) / 2 - tb.left, cy: (r.top + r.bottom) / 2 - tb.top }; };
    for (const spec of combos()) {
      const nz = spec.n.filter((x) => x !== 0).map(box);
      let x = nz.reduce((a, b) => a + b.cx, 0) / nz.length, y = nz.reduce((a, b) => a + b.cy, 0) / nz.length;
      const minL = Math.min(...nz.map((b) => b.l)), maxB = Math.max(...nz.map((b) => b.b)), minT = Math.min(...nz.map((b) => b.t));
      const hasZero = spec.n.includes(0);
      if (spec.t === "street" && !hasZero || spec.t === "sixline") { if (vertical) x = minL; else y = maxB; }
      if (hasZero) {
        if (vertical) y = minT; else x = minL;
        if (spec.t === "corner") { if (vertical) x = minL; else y = maxB; }
      }
      const hs = h("button", { class: "hotspot", type: "button", "aria-label": betName(spec), title: betName(spec) + ` (${RATIO[spec.t]}:1)`,
        onclick: (e) => { e.stopPropagation(); place(spec); } });
      hs.style.left = x + "px"; hs.style.top = y + "px"; hs.dataset.key = betKey(spec);
      table.appendChild(hs);
    }
    drawChips();
  }
  function anchorOf(k) {
    const hs = table.querySelector(`.hotspot[data-key="${CSS.escape(k)}"]`);
    if (hs) return { x: parseFloat(hs.style.left), y: parseFloat(hs.style.top) };
    const b = bets.get(k); if (!b) return null;
    let el = null;
    if (b.t === "straight") el = cells.get(b.n[0]);
    else el = [...table.querySelectorAll(".rcell")].find((c) => c.getAttribute("aria-label") === ({ column: "Колонка " + b.v, dozen: "Дюжина " + b.v })[b.t] || c.getAttribute("aria-label") === V_LABEL[b.v]);
    if (!el) return null;
    const tb = table.getBoundingClientRect(), r = el.getBoundingClientRect();
    return { x: (r.left + r.right) / 2 - tb.left, y: (r.top + r.bottom) / 2 - tb.top };
  }
  function drawChips() {
    table.querySelectorAll(".stack-chip").forEach((x) => x.remove());
    for (const [k, b] of bets) {
      const p = anchorOf(k); if (!p) continue;
      const c = CHIPS.slice().reverse().find((v) => b.a >= v) || 1;
      const el = h("span", { class: "stack-chip" }, b.a >= 1000 ? (b.a / 1000).toFixed(b.a % 1000 ? 1 : 0) + "K" : String(b.a));
      el.style.setProperty("--c", getComputedStyle(chipsEl.querySelector(`[data-v="${c}"]`)).getPropertyValue("--c"));
      el.style.left = p.x + "px"; el.style.top = p.y + "px";
      table.appendChild(el);
    }
  }
  function redraw() {
    const t = total();
    totalEl.textContent = fmt(t); maxWinEl.textContent = fmt(maxWin());
    clear(linesEl, [...bets.values()].map((b) => h("div", { class: "l" }, h("span", {}, betName(b)), h("span", { class: "num" }, fmt(b.a), h("span", { class: "muted" }, ` · ${RATIO[b.t]}:1`)))));
    if (!bets.size) linesEl.appendChild(h("p", { class: "muted", style: { fontSize: "13px" } }, "Нажмите на число или границу между числами. Фишка — выбранного номинала."));
    spinBtn.disabled = spinning || !bets.size;
    [btnUndo, btnClear, btnDouble].forEach((b) => b.disabled = spinning || !bets.size);
    btnRepeat.disabled = spinning || !lastBets || bets.size > 0;
    if (table) drawChips();
  }

  // ---------- spin ----------
  async function animateTo(n) {
    const idx = ORDER.indexOf(n), step = 360 / 37;
    const target = -idx * step;
    const turns = reducedMotion() ? 0 : 5;
    const base = Math.ceil(rotation / 360) * 360;
    rotation = base + turns * 360 + ((target % 360) + 360) % 360;
    ballRot = ballRot - (reducedMotion() ? 0 : 7 * 360) - (ballRot % 360);
    const dur = reducedMotion() ? 0 : 4800;
    wheel.rotor.style.transition = `transform ${dur}ms cubic-bezier(.12,.62,.08,1)`;
    wheel.ballTrack.style.transition = `transform ${dur - 300}ms cubic-bezier(.2,.6,.15,1)`;
    wheel.rotor.style.transform = `rotate(${rotation}deg)`;
    wheel.ballTrack.style.transform = `rotate(${ballRot}deg)`;
    if (dur) { for (let i = 0; i < 18; i++) { setTimeout(() => sfx.tick(), 150 + i * i * 12); } await sleep(dur + 150); }
  }

  async function send(pending) {
    spinning = true; redraw(); clear(retryBox);
    clear(outcome, h("span", { class: "muted" }, "Ставки приняты. Колесо вращается…"));
    memeEl.textContent = "";
    let res;
    try {
      res = await rpc("rpc_roulette_spin", { p_bets: pending.bets, p_idempotency_key: pending.key });
    } catch (e) {
      spinning = false;
      if (e instanceof ApiError && e.code === "network") {
        clear(outcome, h("span", { class: "loss" }, "Связь пропала. Ставка могла быть принята."));
        clear(retryBox, h("button", { class: "btn block", onclick: () => send(pending) }, "Узнать результат (безопасный повтор)"));
      } else {
        store.sset("rl-pending", null);
        clear(outcome, h("span", { class: "loss" }, e.message)); sfx.error();
        if (e.extra?.balance !== undefined) app.setBalance(e.extra.balance);
      }
      redraw(); return;
    }
    store.sset("rl-pending", null);
    const r = res.round, st = r.state;
    await animateTo(st.number);
    const net = r.payout - r.bet;
    const numBadge = h("span", { class: ["n-" + st.color], style: { width: "54px", height: "54px", borderRadius: "50%", display: "grid", placeItems: "center", font: "800 24px/1 var(--f-ui)" } }, String(st.number));
    clear(outcome, h("div", { class: "row", style: { justifyContent: "center", gap: "16px" } }, numBadge,
      h("div", { style: { textAlign: "left" } },
        h("div", { class: ["big", net > 0 ? "win" : net < 0 ? "loss" : ""] }, r.payout > 0 ? "+" + fmt(r.payout) + " ЛК" : signed(net) + " ЛК"),
        h("div", { class: "muted", style: { fontSize: "13px" } }, `Ставка ${fmt(r.bet)} · итог ${signed(net)}`))));
    let ctx = outcomeContext({ bet: r.bet, payout: r.payout });
    if (st.number === 0 && r.payout < r.bet) ctx = "roulette.zero";
    else if (r.payout === 0 && st.lines?.length >= 8) ctx = "roulette.disaster";
    else if (r.payout > 0 && st.lines.some((l) => l.t === "straight" && l.win > 0)) ctx = st.number === 17 ? "roulette.17" : (ctx === "win.big" ? ctx : "roulette.straight");
    memeEl.textContent = meme(ctx, { win: r.payout });
    const cell = cells.get(st.number); if (cell) { cell.classList.remove("win-flash"); void cell.offsetWidth; cell.classList.add("win-flash"); }
    app.setBalance(r.balance);
    if (r.payout > r.bet) (ctx === "win.big" ? sfx.bigWin : sfx.win)(); else sfx.loss();
    if (ctx === "win.big") bigWin(r.payout);
    if (r.balance === 67) toast(meme("balance67"));
    lastBets = pending.bets; store.set("rl-last", lastBets);
    bets.clear(); history = [];
    spinning = false; redraw(); loadRecent(); renderSeed();
  }

  spinBtn.addEventListener("click", () => {
    if (spinning || !bets.size) return;
    const pending = { key: newKey("rl"), bets: [...bets.values()].map((b) => ({ ...b })) };
    store.sset("rl-pending", pending);   // survives refresh / network loss
    send(pending);
  });

  async function loadRecent() {
    try {
      const list = await rpc("rpc_roulette_recent", { p_limit: 16 });
      clear(recentEl, list.map((n) => h("span", { class: "n-" + colorOf(n) }, String(n))));
    } catch { /* cosmetic */ }
  }
  async function renderSeed() {
    try { await app.refreshMe(); } catch { return; }
    const s = app.me.seed;
    clear(seedEl, h("div", { class: "eyebrow" }, "Честность"),
      h("div", {}, h("span", { class: "muted" }, "Хеш серверного сида: "), h("span", { class: "mono" }, s.serverSeedHash.slice(0, 24) + "…")),
      h("div", {}, h("span", { class: "muted" }, "Следующий nonce: "), h("span", { class: "num" }, String(s.nextNonce))),
      h("a", { href: "#/fairness" }, "Проверить, что касса тебя не наебала →"));
  }

  const onResize = () => { if (vq.matches !== vertical) buildTable(); else layoutHotspots(); };
  const ro = new ResizeObserver(() => layoutHotspots());
  vq.addEventListener("change", onResize);

  root.append(h("div", { class: "container" },
    h("div", { class: "game-head" }, h("div", {}, h("div", { class: "eyebrow" }, "Правила " + (rv?.id || "")), h("h1", {}, "Европейская рулетка")),
      h("div", { class: "spacer" }), h("span", { class: "badge" }, "Мин. 1 · до " + fmt(rules.maxBetPerPosition) + " на позицию · до " + fmt(rules.maxTotalBet) + " на спин")),
    h("div", { class: "game-layout" },
      h("div", { class: "stack" },
        h("div", { class: "card" }, h("div", { class: "wheel-wrap" }, h("div", { class: "wheel" }, wheel.svg)), outcome, memeEl, recentEl),
        h("div", { class: "card stack" }, tableWrap, chipsEl,
          h("div", { class: "row wrap", style: { justifyContent: "center" } }, btnUndo, btnClear, btnRepeat, btnDouble))),
      h("aside", { class: "stack" },
        h("div", { class: "card stack" },
          h("div", { class: "bet-summary" },
            h("div", {}, h("div", { class: "eyebrow" }, "Ставка"), totalEl),
            h("div", {}, h("div", { class: "eyebrow" }, "Макс. выплата"), maxWinEl)),
          spinBtn, retryBox),
        h("div", { class: "card stack" }, h("div", { class: "eyebrow" }, "Ставки на столе"), linesEl),
        h("div", { class: "card" }, seedEl)))));
  buildTable();
  ro.observe(tableWrap);
  redraw(); loadRecent(); renderSeed();

  // Recovery: a spin that was sent but whose answer never arrived is re-sent with the SAME key.
  const pending = store.sget("rl-pending", null);
  if (pending && pending.key && Array.isArray(pending.bets)) send(pending);

  return () => { ro.disconnect(); vq.removeEventListener("change", onResize); };
}
