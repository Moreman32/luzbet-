import { rpc, sb, ApiError } from "../api.js";
import { h, clear, fmt, signed, toast, store, newKey } from "../ui.js";
import { meme, outcomeContext, sessionMeme } from "../memes.js";
import { sfx } from "../sound.js";
import { cardEl, bigWin } from "./shared.js";

const CHIPS = [1, 5, 25, 100, 500, 1000];
const RESULT = { win: "Выигрыш", lose: "Проигрыш", push: "Ничья", bust: "Перебор", blackjack: "Блэкджек" };

export async function mount(root, { app }) {
  try { await app.refreshMe(); } catch { /* use cached */ }
  const { data: rv } = await sb.from("game_rule_versions").select("id,rules").eq("game_slug", "blackjack").eq("is_current", true).single();
  const rules = rv?.rules || { minBet: 1, maxBet: 5000 };
  let bet = store.get("bj-bet", 50);
  let round = null;
  let busy = false;
  const seen = new Set();

  const dealerCards = h("div", { class: "cards", "aria-label": "Карты дилера" });
  const dealerTotal = h("span", { class: "total-tag" }, "—");
  const handsEl = h("div", { class: "bj-hands" });
  const outcome = h("div", { class: "outcome", "aria-live": "polite" });
  const memeEl = h("p", { class: "meme-line" });
  const betVal = h("span", { class: "v num" }, fmt(bet));
  const controls = h("div", { class: "stack" });
  const retryBox = h("div");

  const act = {
    hit: h("button", { class: "btn lg", type: "button", onclick: () => action("hit") }, "Ещё"),
    stand: h("button", { class: "btn lg", type: "button", onclick: () => action("stand") }, "Хватит"),
    double: h("button", { class: "btn lg", type: "button", onclick: () => action("double") }, "Удвоить"),
    split: h("button", { class: "btn lg", type: "button", onclick: () => action("split") }, "Сплит"),
  };
  const dealBtn = h("button", { class: "btn primary lg block", type: "button", onclick: () => deal() }, "Раздать");

  function setBet(v) { bet = Math.max(0, Math.min(rules.maxBet, v)); store.set("bj-bet", bet); betVal.textContent = fmt(bet); dealBtn.disabled = busy || bet < rules.minBet; }

  function renderControls() {
    const active = round && round.status === "active";
    if (active) {
      const allowed = new Set(round.state.allowed || []);
      for (const [k, b] of Object.entries(act)) b.disabled = busy || !allowed.has(k);
      clear(controls, h("div", { class: "bj-actions" }, act.hit, act.stand, act.double, act.split),
        h("p", { class: "muted", style: { fontSize: "12px", textAlign: "center" } }, "Удвоение и сплит списывают ещё одну ставку."), retryBox);
    } else {
      clear(controls,
        h("div", { class: "bet-summary" }, h("div", {}, h("div", { class: "eyebrow" }, "Ставка"), betVal),
          h("div", {}, h("div", { class: "eyebrow" }, "Лимиты"), h("span", { class: "muted" }, `${fmt(rules.minBet)} – ${fmt(rules.maxBet)} ЛК`))),
        h("div", { class: "chips" }, CHIPS.map((v) => h("button", { class: "chip", dataset: { v }, type: "button", "aria-label": "+" + fmt(v),
          onclick: () => { if (bet + v > app.me.balance) return toast("Ставка больше баланса."); sfx.chip(); setBet(bet + v); } }, v >= 1000 ? v / 1000 + "K" : String(v)))),
        h("div", { class: "row", style: { justifyContent: "center" } },
          h("button", { class: "btn sm", type: "button", onclick: () => setBet(0) }, "Сбросить"),
          h("button", { class: "btn sm", type: "button", onclick: () => setBet(Math.min(bet * 2, app.me.balance)) }, "×2"),
          h("button", { class: "btn sm", type: "button", onclick: () => setBet(Math.floor(bet / 2)) }, "½")),
        dealBtn, retryBox);
      setBet(bet);
    }
  }

  function renderTable() {
    const st = round?.state;
    if (!st) {
      clear(dealerCards); dealerTotal.textContent = "—";
      clear(handsEl, h("p", { class: "muted" }, "Сделайте ставку и нажмите «Раздать»."));
      return;
    }
    let delay = 0;
    const mk = (c) => { const isNew = c !== null && !seen.has(c); const el = cardEl(c, isNew ? delay : 0); if (isNew) { delay += 260; seen.add(c); setTimeout(() => sfx.card(), delay - 260); } else el.style.animation = "none"; return el; };
    const dealer = st.dealer.map(mk);
    if (st.holeHidden) dealer.push(cardEl(null, 0));
    clear(dealerCards, dealer);
    dealerTotal.textContent = st.holeHidden ? String(st.dealerTotal) + " + ?" : String(st.dealerTotal);
    clear(handsEl, st.hands.map((hd, i) => h("div", { class: ["bj-hand", st.phase === "PLAYER_TURN" && i === st.active ? "active" : ""] },
      h("div", { class: "cards" }, hd.cards.map(mk)),
      h("div", { class: "row" },
        h("span", { class: "total-tag" }, (hd.soft && hd.total <= 21 ? "мягкие " : "") + hd.total),
        h("span", { class: "badge" }, fmt(hd.bet) + " ЛК" + (hd.doubled ? " ×2" : "")),
        hd.result ? h("span", { class: ["result-tag", hd.result] }, RESULT[hd.result]) : null))));
  }

  function finish() {
    const r = round, st = r.state;
    const net = r.payout - r.bet;
    clear(outcome, h("div", {}, h("div", { class: ["big", net > 0 ? "win" : net < 0 ? "loss" : ""] }, (net > 0 ? "+" : "") + (net === 0 ? "0" : signed(net)) + " ЛК"),
      h("div", { class: "muted", style: { fontSize: "13px" } }, `Ставка ${fmt(r.bet)} · выплата ${fmt(r.payout)}`)));
    const res = st.hands.map((x) => x.result);
    let ctx = outcomeContext({ bet: r.bet, payout: r.payout });
    if (res.includes("blackjack")) ctx = "bj.blackjack";
    else if (res.every((x) => x === "bust")) ctx = st.hands.some((x)=>x.total===22) ? "bj.bust22" : "bj.bust";
    else if (r.payout === r.bet && net === 0) ctx = "bj.push";
    else if (st.dealerTotal > 21 && net > 0 && ctx !== "win.big") ctx = "bj.dealerBust";
    else if (st.hands.some((x) => x.doubled)) ctx = net > 0 ? (ctx === "win.big" ? ctx : "bj.doubleWin") : "bj.doubleLoss";
    memeEl.textContent = sessionMeme({won:net>0,lost:net<0,balance:r.balance,award:ctx==="bj.bust22"?"bust22":null}) || meme(ctx, { win: r.payout });
    app.setBalance(r.balance);
    if (net > 0) (ctx === "win.big" ? sfx.bigWin : sfx.win)(); else if (net < 0) sfx.loss();
    if (ctx === "win.big") bigWin(r.payout);
  }

  function apply(r) {
    round = r;
    renderTable();
    if (r.status === "finished") setTimeout(finish, 800);
    else { app.setBalance(r.balance); clear(outcome); memeEl.textContent = ""; }
    renderControls();
  }

  async function call(kind, pending) {
    busy = true; renderControls(); clear(retryBox);
    try {
      const res = kind === "start"
        ? await rpc("rpc_blackjack_start", { p_bet: pending.bet, p_idempotency_key: pending.key })
        : await rpc("rpc_blackjack_action", { p_round_id: pending.roundId, p_action: pending.action, p_idempotency_key: pending.key });
      store.sset("bj-pending", null);
      busy = false;
      if (kind === "start") { seen.clear(); memeEl.textContent = ""; clear(outcome); }
      apply(res.round);
    } catch (e) {
      busy = false;
      if (e instanceof ApiError && e.code === "network") {
        clear(retryBox, h("button", { class: "btn block", onclick: () => call(kind, pending) }, "Повторить (безопасно, тот же запрос)"));
      } else {
        store.sset("bj-pending", null);
        toast(e.message, "error"); sfx.error();
        if (e.code === "round_in_progress" && e.extra?.round) apply(e.extra.round);
        if (e.code === "round_finished" && e.extra?.round) apply(e.extra.round);
        if (e.extra?.balance !== undefined) app.setBalance(e.extra.balance);
      }
      renderControls();
    }
  }
  function deal() {
    if (busy || bet < rules.minBet) return;
    if (bet > app.me.balance) return toast("Ставка больше баланса.");
    const p = { kind: "start", key: newKey("bj"), bet };
    store.sset("bj-pending", p); call("start", p);
  }
  function action(a) {
    if (busy || !round || round.status !== "active") return;
    const p = { kind: "action", key: newKey("bja"), roundId: round.id, action: a };
    store.sset("bj-pending", p); call("action", p);
  }

  const onKey = (e) => {
    if (e.target.closest("input,textarea")) return;
    const map = { h: "hit", s: "stand", d: "double", p: "split" };
    if (round?.status === "active" && map[e.key]) { const b = act[map[e.key]]; if (!b.disabled) action(map[e.key]); }
    if (e.key === "Enter" && (!round || round.status !== "active") && document.activeElement === document.body) deal();
  };
  document.addEventListener("keydown", onKey);

  root.append(h("div", { class: "container" },
    h("div", { class: "game-head" }, h("div", {}, h("div", { class: "eyebrow" }, "Правила " + (rv?.id || "")), h("h1", {}, "Блэкджек")),
      h("div", { class: "spacer" }), h("span", { class: "badge" }, "6 колод · S17 · 3:2 · DAS · сплит 1 раз")),
    h("div", { class: "game-layout" },
      h("div", { class: "stack" },
        h("div", { class: "bj-table" },
          h("div", { class: "bj-zone" }, h("span", { class: "eyebrow", style: { color: "rgba(233,220,189,.6)" } }, "Дилер"), dealerCards, dealerTotal),
          h("div"),
          h("div", { class: "bj-zone" }, handsEl)),
        outcome, memeEl),
      h("aside", { class: "stack" }, h("div", { class: "card stack" }, controls),
        h("details", { class: "more" }, h("summary", {}, "Правила стола"),
          h("div", { class: "stack muted", style: { fontSize: "14px" } },
            h("p", {}, "Шуз из 6 колод перемешивается заново для каждой раздачи из вашего provably-fair сида."),
            h("p", {}, "Дилер проверяет блэкджек при тузе или десятке. Дилер стоит на любых 17."),
            h("p", {}, "Блэкджек платит 3:2 (дробная часть округляется вниз). Удвоение на любых двух картах, в том числе после сплита."),
            h("p", {}, "Сплит — один раз, включая любые две десятки. Разделённые тузы получают по одной карте; 21 после сплита — не блэкджек."),
            h("p", {}, "Страховки и сдачи нет. Клавиши: H — ещё, S — хватит, D — удвоить, P — сплит.")))))));

  renderTable(); renderControls();

  // Recovery order: unanswered request -> active round from server -> idle.
  const pending = store.sget("bj-pending", null);
  if (pending?.kind === "start" || pending?.kind === "action") call(pending.kind, pending);
  else {
    const active = (app.me.activeRounds || []).find((r) => r.game === "blackjack");
    if (active) { toast("Восстановлена незавершённая раздача."); apply(active); }
  }
  return () => document.removeEventListener("keydown", onKey);
}
