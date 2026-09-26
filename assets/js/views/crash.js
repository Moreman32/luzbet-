import { h, clear, fmt, toast, sfx, meme, head, betInput, send, key, activeRound, settle, resultTag, errorToast, footnote, currentRules } from "./game-kit.js?v=2.1.1";
import { rpc, sb } from "../api.js?v=2.1.1";
import { store, reducedMotion } from "../ui.js?v=2.1.1";

const K = 0.00006;                                  // same curve as the server: floor(100·e^(K·ms))/100
const multAt = (ms) => Math.floor(100 * Math.exp(K * Math.max(0, ms))) / 100;

export async function mount(root, { app }) {
  try { await app.refreshMe(); } catch { /* cached */ }
  const rules = await currentRules("crash", { minBet: 1, maxBet: 5000 });
  let round = activeRound(app, "crash");
  let offset = 0, raf = 0, poll = 0, busy = false, alive = true;
  let autoOn = store.get("crash-auto-on", false), autoVal = store.get("crash-auto", 2);

  const bet = betInput({ app, min: rules.minBet, max: rules.maxBet, key: "crash", value: 50 });
  const canvas = h("canvas", { class: "cr-canvas", width: 900, height: 420, "aria-hidden": "true" });
  const big = h("div", { class: "cr-mult num" }, "×1.00");
  const sub = h("div", { class: "cr-sub" }, "Рынок закрыт. Сделайте ставку, чтобы открыть торги.");
  const memeEl = h("p", { class: "meme-line" });
  const panel = h("div", { class: "stack" });
  const resultBox = h("div");
  const histEl = h("div", { class: "cr-hist", "aria-label": "Ваши последние раунды" });
  const autoChk = h("input", { type: "checkbox", id: "cr-auto", checked: autoOn, onchange: (e) => { autoOn = e.target.checked; store.set("crash-auto-on", autoOn); autoInp.disabled = !autoOn; } });
  const autoInp = h("input", { class: "input num", type: "number", min: 1.01, max: 10000, step: 0.01, value: autoVal, disabled: !autoOn, "aria-label": "Автовывод",
    onchange: (e) => { autoVal = Math.max(1.01, Math.min(10000, Math.floor(+e.target.value * 100) / 100 || 2)); e.target.value = autoVal; store.set("crash-auto", autoVal); } });

  const ctx2d = canvas.getContext("2d");
  function drawCurve(ms, state) {
    const W = canvas.width, H = canvas.height;
    ctx2d.clearRect(0, 0, W, H);
    const tMax = Math.max(8000, ms * 1.15), mMax = Math.max(2, multAt(tMax) * 1.05);
    const X = (t) => 50 + (t / tMax) * (W - 70), Y = (m) => H - 40 - ((m - 1) / (mMax - 1)) * (H - 70);
    ctx2d.strokeStyle = "rgba(210,173,98,.12)"; ctx2d.lineWidth = 1; ctx2d.fillStyle = "rgba(201,192,174,.55)"; ctx2d.font = "20px Inter, sans-serif";
    const step = mMax > 20 ? Math.pow(10, Math.floor(Math.log10(mMax))) : mMax > 5 ? 2 : 0.5;
    for (let m = 1; m <= mMax; m += step) { ctx2d.beginPath(); ctx2d.moveTo(50, Y(m)); ctx2d.lineTo(W - 20, Y(m)); ctx2d.stroke(); ctx2d.fillText("×" + (Math.round(m * 100) / 100), 4, Y(m) + 6); }
    if (ms <= 0) return;
    const crashed = state === "CRASHED";
    const grad = ctx2d.createLinearGradient(0, H, W, 0);
    grad.addColorStop(0, crashed ? "#7a1c26" : "#9c7733"); grad.addColorStop(1, crashed ? "#d07a7a" : "#f0d898");
    ctx2d.beginPath(); ctx2d.moveTo(X(0), Y(1));
    const n = 120; for (let i = 1; i <= n; i++) { const t = (ms * i) / n; ctx2d.lineTo(X(t), Y(Math.exp(K * t))); }
    ctx2d.lineWidth = 6; ctx2d.strokeStyle = grad; ctx2d.lineCap = "round"; ctx2d.stroke();
    ctx2d.lineTo(X(ms), Y(1)); ctx2d.closePath(); ctx2d.fillStyle = crashed ? "rgba(160,42,54,.12)" : "rgba(210,173,98,.10)"; ctx2d.fill();
    ctx2d.font = "34px serif"; ctx2d.fillText(crashed ? "💥" : "🚀", X(ms) - 14, Y(Math.exp(K * ms)) - 8);
  }

  const serverMs = () => Date.now() + offset - Date.parse(round.state.startedAt);
  function loop() {
    if (!alive || !round) return;
    if (round.status === "active") {
      const ms = serverMs();
      big.textContent = "×" + multAt(ms).toFixed(2);
      big.className = "cr-mult num running";
      drawCurve(ms, "RUNNING");
      const cb = panel.querySelector(".cr-cash");
      if (cb) cb.firstChild && (cb.querySelector(".v").textContent = fmt(Math.floor(round.bet * multAt(ms))) + " ЛК");
      raf = requestAnimationFrame(loop);
    }
  }

  function drawFinished() {
    const st = round.state, crashAt = Number(st.crash);
    const ms = Math.log(Math.max(1, crashAt)) / K;
    drawCurve(Math.max(ms, 1), st.phase === "CRASHED" ? "CRASHED" : "CASHED");
    big.textContent = "×" + crashAt.toFixed(2);
    big.className = "cr-mult num " + (st.phase === "CASHED" ? "cashed" : "crashed");
    sub.textContent = st.phase === "CASHED" ? `Вы забрали на ×${Number(st.cashout).toFixed(2)} · крах был на ×${crashAt.toFixed(2)}` : `Крах на ×${crashAt.toFixed(2)}`;
  }

  function drawPanel() {
    const running = round && round.status === "active";
    bet.disable(!!running || busy);
    if (running) {
      clear(panel,
        h("button", { class: "btn primary lg block cr-cash", type: "button", disabled: busy, onclick: cashout }, "Забрать ", h("span", { class: "v num" }, "…")),
        round.state.auto ? h("p", { class: "muted small" }, `Автовывод на ×${Number(round.state.auto).toFixed(2)} — сработает на сервере, даже если закрыть вкладку.`) : null,
        h("p", { class: "muted small" }, "Ставка ", h("b", {}, fmt(round.bet)), " ЛК. Время считает сервер, а не ваш интернет."));
    } else {
      clear(panel, bet.el,
        h("div", { class: "field" }, h("label", { class: "row", for: "cr-auto" }, autoChk, "Автовывод на ×"), autoInp),
        h("button", { class: "btn primary lg block", type: "button", disabled: busy, onclick: start }, "Купить ЛК по рынку"),
        h("p", { class: "muted small" }, "Точка краха определена сидом до старта. В 3% раундов рынок падает сразу на ×1.00."));
    }
  }

  async function history() {
    const { data } = await sb.from("casino_rounds").select("state,payout,bet_total").eq("game_slug", "crash").eq("status", "finished").order("created_at", { ascending: false }).limit(14);
    clear(histEl, h("span", { class: "eyebrow" }, "Ваши крахи"), (data || []).map((r) => {
      const c = Number(r.state?.crash || 0);
      return h("span", { class: ["cr-chip", r.payout > r.bet_total ? "w" : "", c >= 2 ? "hi" : ""] }, "×" + c.toFixed(2));
    }));
  }

  function startPolling() {
    clearInterval(poll);
    poll = setInterval(async () => {
      if (!round || round.status !== "active" || busy) return;
      try {
        const r = await rpc("rpc_crash_status", { p_round_id: round.id });
        offset = Date.parse(r.serverNow) - Date.now();
        if (r.round.status !== "active") { round = r.round; finished(); }
      } catch { /* next tick */ }
    }, 450);
  }

  function run() {
    sub.textContent = "Торги идут. Нажмите «Забрать», пока график не вспомнил про гравитацию.";
    clear(resultBox); drawPanel(); cancelAnimationFrame(raf);
    if (reducedMotion()) { big.textContent = "×…"; }
    raf = requestAnimationFrame(loop); startPolling();
  }

  function finished() {
    cancelAnimationFrame(raf); clearInterval(poll);
    const st = round.state, crashAt = Number(st.crash);
    drawFinished(); drawPanel();
    let ctx = "crash.crashed", vars = {};
    if (st.phase === "CASHED") {
      const m = Number(st.cashout); vars.mult = m.toFixed(2);
      ctx = m >= 10 ? "crash.moon" : m < 1.2 ? "crash.paper" : "crash.cash";
    } else if (crashAt <= 1) ctx = "crash.instant";
    settle(app, round, { ctx, vars, memeEl, award: st.phase === "CASHED" && Number(st.cashout) >= 10 ? "crashMoon" : st.phase === "CRASHED" && crashAt <= 1 ? "crashInstant" : null });
    clear(resultBox, resultTag(round));
    history();
  }

  async function start() {
    if (busy) return;
    const b = bet.get();
    if (b > app.me.balance) return toast("Ставка больше баланса. Кредитное плечо не предусмотрено.", "error");
    busy = true; drawPanel(); memeEl.textContent = "";
    try {
      const r = await send("rpc_crash_start", { p_bet: b, p_auto: autoOn ? autoVal : null, p_idempotency_key: key("cr") });
      offset = Date.parse(r.serverNow) - Date.now();
      round = r.round; app.setBalance(round.balance); sfx.chip(); memeEl.textContent = meme("crash.start");
    } catch (e) { errorToast(e); busy = false; drawPanel(); return; }
    busy = false;
    if (round.status === "active") run(); else finished();
  }

  async function cashout() {
    if (busy || !round || round.status !== "active") return;
    busy = true;
    const btn = panel.querySelector(".cr-cash"); if (btn) btn.disabled = true;
    try {
      const r = await send("rpc_crash_cashout", { p_round_id: round.id, p_idempotency_key: key("cc") });
      round = r.round;
      if (r.late && round.state.phase === "CRASHED") toast(meme("crash.late"), "error");
    } catch (e) {
      errorToast(e);
    } finally { busy = false; }
    if (round.status !== "active") finished(); else drawPanel();
  }

  root.append(h("div", { class: "container stack" },
    ...head({ route: "crash", eyebrow: "Биржа виртуальных надежд", title: "Crash: Курс ЛК", sub: "Курс растёт по экспоненте, пока не рухнет. Когда — знает только хеш, показанный до ставки.", badge: "RTP 97%" }),
    h("section", { class: "gk-layout" },
      h("div", { class: "card gilded gk-stage cr-stage" }, h("div", { class: "cr-screen" }, canvas, h("div", { class: "cr-overlay" }, big, sub)), resultBox, memeEl, histEl),
      h("aside", { class: "card gk-panel" }, panel)),
    footnote(rules, "Точка краха = max(1, ⌊97·N/(N−r)⌋/100), r = fairInt(N), N = 2³¹−1. Кривая: ×e^(0,00006·мс). Выплата: ⌊ставка × множитель⌋.")));
  drawCurve(0); drawPanel(); history();
  if (round) {
    try { const r = await rpc("rpc_crash_status", { p_round_id: round.id }); offset = Date.parse(r.serverNow) - Date.now(); round = r.round; } catch { /* ignore */ }
    if (round.status === "active") run(); else finished();
  }
  return () => { alive = false; cancelAnimationFrame(raf); clearInterval(poll); };
}
