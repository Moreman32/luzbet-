import { h, clear, fmt, toast, sfx, meme, head, betInput, send, key, activeRound, settle, resultTag, errorToast, footnote, currentRules } from "./game-kit.js?v=2.1.1";
import { store } from "../ui.js?v=2.1.1";

// Display-only multiplier table (the server computes the exact payout).
const mult = (m, k) => { let x = 0.97; for (let i = 0; i < k; i++) x *= (25 - i) / (25 - m - i); return k ? x : 1; };

export async function mount(root, { app }) {
  try { await app.refreshMe(); } catch { /* cached */ }
  const rules = await currentRules("mines", { minBet: 1, maxBet: 5000 });
  let round = activeRound(app, "mines");
  let mines = store.get("mines-count", 3);
  let busy = false;

  const bet = betInput({ app, min: rules.minBet, max: rules.maxBet, key: "mines", value: 50 });
  const grid = h("div", { class: "mn-grid", role: "grid", "aria-label": "Минное поле" });
  const tiles = [];
  for (let i = 0; i < 25; i++) {
    const t = h("button", { class: "mn-tile", type: "button", role: "gridcell", "aria-label": "Клетка " + (i + 1), onclick: () => reveal(i) }, h("span", { class: "f" }));
    tiles.push(t); grid.appendChild(t);
  }
  const memeEl = h("p", { class: "meme-line" });
  const statusEl = h("div", { class: "mn-status" });
  const panel = h("div", { class: "stack" });
  const minesSel = h("div", { class: "mn-count" });

  function drawCount() {
    clear(minesSel, [1, 3, 5, 10, 24].map((n) => h("button", { type: "button", class: ["btn sm", n === mines ? "primary" : ""], onclick: () => { mines = n; store.set("mines-count", n); drawCount(); drawPanel(); } }, n + " 💣")),
      h("input", { class: "input sm num", type: "number", min: 1, max: 24, value: mines, "aria-label": "Количество мин",
        onchange: (e) => { mines = Math.max(1, Math.min(24, Math.floor(+e.target.value) || 1)); store.set("mines-count", mines); drawCount(); drawPanel(); } }));
  }

  function drawGrid() {
    const st = round?.state || {};
    const rev = new Set(st.revealed || []), mp = new Set(st.minePositions || []);
    const playing = round && round.status === "active";
    tiles.forEach((t, i) => {
      t.className = "mn-tile";
      const f = t.firstChild; f.textContent = "";
      t.disabled = !playing || busy || rev.has(i);
      if (rev.has(i)) { t.classList.add("safe"); f.textContent = "💎"; }
      else if (mp.has(i)) { t.classList.add("mine"); f.textContent = "💣"; if (st.hit === i) t.classList.add("hit"); }
      else if (round && !playing) t.classList.add("dim");
    });
  }

  function drawPanel() {
    const playing = round && round.status === "active";
    bet.disable(!!playing || busy);
    if (playing) {
      const st = round.state;
      clear(statusEl,
        h("div", {}, h("small", {}, "Множитель"), h("b", { class: "num gold" }, "×" + Number(st.multiplier).toFixed(2))),
        h("div", {}, h("small", {}, "Следующая"), h("b", { class: "num" }, st.next ? "×" + Number(st.next).toFixed(2) : "—")),
        h("div", {}, h("small", {}, "Забрать"), h("b", { class: "num" }, fmt(st.cashoutValue) + " ЛК")),
        h("div", {}, h("small", {}, "Мин / чистых"), h("b", { class: "num" }, `${st.mines} / ${st.safeLeft}`)));
      clear(panel,
        h("button", { class: "btn primary lg block", type: "button", disabled: busy || !(st.revealed || []).length, onclick: cashout },
          (st.revealed || []).length ? `Забрать ${fmt(st.cashoutValue)} ЛК` : "Откройте хотя бы одну клетку"),
        h("p", { class: "muted small" }, "Ставка ", h("b", {}, fmt(round.bet)), " ЛК · игра сохранится, если закрыть вкладку."));
    } else {
      const preview = [1, 2, 3, 5].filter((k) => k <= 25 - mines).map((k) => h("span", { class: "mn-pv" }, h("small", {}, k + " шаг"), h("b", { class: "num" }, "×" + mult(mines, k).toFixed(2))));
      clear(statusEl, preview);
      clear(panel, bet.el, h("div", { class: "field" }, h("label", {}, "Мины на поле"), minesSel),
        h("button", { class: "btn primary lg block", type: "button", disabled: busy, onclick: start }, "Заминировать поле"),
        h("p", { class: "muted small" }, "Мины расставляются из сида до первой клетки. Ставка списывается сразу."));
    }
    drawGrid();
  }

  async function start() {
    if (busy) return;
    const b = bet.get();
    if (b > app.me.balance) return toast(meme("broke") || "Ставка больше баланса.", "error");
    busy = true; drawPanel(); memeEl.textContent = "";
    try {
      const r = await send("rpc_mines_start", { p_bet: b, p_mines: mines, p_idempotency_key: key("mn") });
      round = r.round; app.setBalance(round.balance); sfx.chip(); memeEl.textContent = meme("mines.start");
    } catch (e) {
      errorToast(e);
      if (e.code === "round_in_progress") { await app.refreshMe(); round = activeRound(app, "mines"); }
    } finally { busy = false; drawPanel(); }
  }

  async function reveal(i) {
    if (busy || !round || round.status !== "active") return;
    busy = true; tiles[i].classList.add("pending"); drawGrid(); tiles[i].classList.add("pending");
    try {
      const r = await send("rpc_mines_reveal", { p_round_id: round.id, p_tile: i, p_idempotency_key: key("mr") });
      round = r.round;
      if (round.status === "active") { sfx.card(); memeEl.textContent = meme("mines.safe"); }
      else finish();
    } catch (e) { errorToast(e); if (e.extra?.round) round = e.extra.round; }
    finally { busy = false; drawPanel(); }
  }

  async function cashout() {
    if (busy || !round) return;
    busy = true; drawPanel();
    try {
      const r = await send("rpc_mines_cashout", { p_round_id: round.id, p_idempotency_key: key("mc") });
      round = r.round; finish();
    } catch (e) { errorToast(e); if (e.extra?.round) round = e.extra.round; }
    finally { busy = false; drawPanel(); }
  }

  function finish() {
    const st = round.state;
    const ctx = st.phase === "BOOM" ? "mines.boom" : st.phase === "CLEARED" ? "mines.cleared" : "mines.cash";
    if (st.phase === "BOOM") { grid.classList.remove("shake"); void grid.offsetWidth; grid.classList.add("shake"); }
    settle(app, round, { ctx, memeEl, award: st.phase === "CASHED" ? "minesCash" : st.phase === "BOOM" && (st.revealed || []).length >= 5 ? "minesGreedy" : null });
    clear(resultBox, resultTag(round));
  }
  const resultBox = h("div");

  drawCount();
  root.append(h("div", { class: "container stack" },
    ...head({ route: "mines", eyebrow: "Отдел внезапных проверок", title: "Минное поле бухгалтерии", sub: "Открывайте клетки, растите множитель и уходите вовремя. Или не уходите — мы не осуждаем, мы зарабатываем.", badge: "RTP 97%" }),
    h("section", { class: "gk-layout" },
      h("div", { class: "card gilded gk-stage mn-stage" }, grid, statusEl, resultBox, memeEl),
      h("aside", { class: "card gk-panel" }, panel)),
    footnote(rules, "Множитель = 0,97 × Π (25−i)/(25−m−i). Выплата округляется вниз до целого ЛК, максимум 5 000 000.")));
  drawPanel();
  if (round) memeEl.textContent = "Вы вернулись на поле. Мины — тоже никуда не делись.";
}
