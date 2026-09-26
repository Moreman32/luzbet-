import { h, clear, fmt, toast, sfx, meme, head, betInput, send, key, activeRound, settle, resultTag, errorToast, footnote, currentRules } from "./game-kit.js";

const rv = (v) => v === 14 ? "A" : v === 13 ? "K" : v === 12 ? "Q" : v === 11 ? "J" : String(v);
const sv = (s) => ({ S: "♠", H: "♥", D: "♦", C: "♣" }[s] || s);
const title = (v) => v === 14 ? "Председатель" : v === 13 ? "Финдиректор" : v === 12 ? "Юротдел" : v === 11 ? "Риск-менеджер" : v <= 4 ? "Стажёр" : "Карточный департамент";

function card(c, big = false) {
  return h("div", { class: "luz-card hl-live-card " + (["H", "D"].includes(c.suit) ? "red " : "") + (big ? "big" : ""), "aria-label": rv(c.rank) + sv(c.suit) },
    h("div", { class: "hl-corner" }, h("b", {}, rv(c.rank)), h("i", {}, sv(c.suit))),
    h("div", { class: "hl-card-center" }, h("span", {}, sv(c.suit)), h("div", { class: "card-face" }, c.rank > 10 ? "ЛК" : "•")),
    h("small", {}, title(c.rank)));
}
const back = () => h("div", { class: "hl-card-back" }, h("div", { class: "hl-back-frame" }, h("b", {}, "ЛК"), h("span", {}, "LUZBET"), h("small", {}, "КАРТОЧНЫЙ ДЕПАРТАМЕНТ")));

export async function mount(root, { app }) {
  try { await app.refreshMe(); } catch { /* cached */ }
  const rules = await currentRules("higher_lower", { minBet: 1, maxBet: 5000 });
  let round = activeRound(app, "higher_lower");
  let busy = false;

  const bet = betInput({ app, min: rules.minBet, max: rules.maxBet, key: "hl", value: 100, label: "Сумма служебной ошибки, ЛК" });
  const stage = h("div", { class: "hl-live-stage" });
  const status = h("div", { class: "hl-live-status" }, "Колода опечатана. Карточный департамент ожидает распоряжений.");
  const controls = h("div", { class: "hl-control-panel stack" });
  const caseNo = h("span", { class: "hl-case" }, "ДЕЛО НЕ ОТКРЫТО");
  const memeEl = h("p", { class: "meme-line" });
  const resultBox = h("div");

  function draw() {
    clear(controls); clear(stage);
    const playing = round && round.status === "active";
    bet.disable(!!playing || busy);
    if (!round) {
      stage.append(h("div", { class: "hl-table-mark" }, "LUZBET • CARD DIVISION"), back());
      controls.append(bet.el,
        h("button", { class: "btn primary lg block hl-start", type: "button", disabled: busy, onclick: start }, "ОТКРЫТЬ ДЕЛО"),
        h("small", { class: "hl-footnote muted" }, "Нажимая кнопку, вы подтверждаете, что математика была вам объяснена, но проигнорирована."));
      return;
    }
    const s = round.state, o = s.options || {}, total = +o.total || 0, hi = +o.higher || 0, lo = +o.lower || 0, m = +s.multiplier || 1;
    caseNo.textContent = "ДЕЛО " + String(round.id || "").slice(0, 8).toUpperCase();
    stage.append(h("div", { class: "hl-table-mark" }, "LUZBET • CARD DIVISION"), h("div", { class: "hl-card-shadow" }), card(s.current, true));
    if (!playing) {
      controls.append(resultBox,
        h("button", { class: "btn primary lg block", type: "button", onclick: () => { round = null; clear(resultBox); caseNo.textContent = "ДЕЛО ЗАКРЫТО"; draw(); } }, "Новое дело"));
    } else {
      const base = s.wins > 0 ? m : 0.97;
      const choices = h("div", { class: "hl-action-grid" });
      for (const [g, label, n, arrow] of [["lower", "МЕНЬШЕ", lo, "↓"], ["higher", "БОЛЬШЕ", hi, "↑"]]) {
        const p = total ? n / total : 0;
        const b = h("button", { class: "hl-choice " + g, type: "button", disabled: !n || busy },
          h("span", { class: "hl-arrow" }, arrow), h("b", {}, label),
          h("strong", {}, n ? Math.round(p * 100) + "%" : "—"),
          h("small", {}, n ? "станет ×" + (base / p).toFixed(2) : "комитет запретил"));
        b.onclick = () => guess(g); choices.append(b);
      }
      controls.append(
        h("div", { class: "hl-decision-label" }, h("span", { class: "eyebrow" }, "Решение комиссии"), h("small", {}, `Что будет со следующей картой? В колоде ещё ${s.remaining}.`)),
        choices,
        h("div", { class: "hl-live-meta" },
          h("div", {}, h("small", {}, "ТЕКУЩИЙ МНОЖИТЕЛЬ"), h("strong", {}, s.wins > 0 ? "×" + m.toFixed(2) : "—")),
          h("div", {}, h("small", {}, "К ВЫПЛАТЕ"), h("strong", {}, s.wins > 0 ? fmt(Math.floor(round.bet * m)) + " ЛК" : "после 1-го шага"))),
        h("button", { class: "btn primary block hl-cash", type: "button", onclick: cash, disabled: busy || !s.wins }, s.wins ? "ЗАФИКСИРОВАТЬ ПОДОЗРИТЕЛЬНО РАЗУМНОЕ РЕШЕНИЕ" : "Забрать можно после первого угадывания"));
    }
    if (s.history?.length > 1) controls.append(h("div", { class: "hl-history-wrap" }, h("span", { class: "eyebrow" }, "Материалы дела"), h("div", { class: "hl-history" }, s.history.slice(-9).map((x) => card(x)))));
  }

  async function start() {
    if (busy) return;
    const n = bet.get();
    if (n > app.me.balance) return toast("Финансовый отдел не обнаружил такой суммы на счёте.", "error");
    busy = true; status.textContent = "Секретарь тасует документы и колоду…"; clear(resultBox); memeEl.textContent = ""; draw();
    try {
      const r = await send("rpc_higher_lower_start", { p_bet: n, p_idempotency_key: key("hl") });
      round = r.round; app.setBalance(round.balance); sfx.card(); status.textContent = meme("hl.start");
    } catch (e) {
      errorToast(e); status.textContent = "Юротдел временно остановил производство.";
      if (e.code === "round_in_progress") { await app.refreshMe(); round = activeRound(app, "higher_lower"); }
    } finally { busy = false; draw(); }
  }

  async function guess(g) {
    if (busy || !round) return;
    busy = true; draw(); status.textContent = "Комитет случайных чисел проводит закрытое заседание…";
    try {
      const r = await send("rpc_higher_lower_guess", { p_round_id: round.id, p_guess: g, p_idempotency_key: key("hg") });
      round = r.round; sfx.card();
      if (round.status === "finished") {
        status.textContent = "Прогноз отклонён. Карточный департамент выражает формальное сочувствие.";
        settle(app, round, { ctx: "hl.loss", memeEl }); clear(resultBox, resultTag(round)); caseNo.textContent = "ДЕЛО ЗАКРЫТО";
      } else {
        status.textContent = "Комиссия вынуждена признать: на этот раз вы были правы."; memeEl.textContent = meme("hl.win");
      }
    } catch (e) { errorToast(e); status.textContent = "Заседание сорвано по техническим причинам."; if (e.extra?.round) round = e.extra.round; }
    finally { busy = false; draw(); }
  }

  async function cash() {
    if (busy || !round) return;
    busy = true; draw();
    try {
      const r = await send("rpc_higher_lower_cashout", { p_round_id: round.id, p_idempotency_key: key("hc") });
      round = r.round;
      settle(app, round, { ctx: "hl.cash", memeEl, award: "hlCash" }); clear(resultBox, resultTag(round));
      caseNo.textContent = "ДЕЛО ЗАКРЫТО С ПРИБЫЛЬЮ"; status.textContent = "Производство прекращено в связи с внезапным проявлением здравого смысла.";
    } catch (e) { errorToast(e); if (e.extra?.round) round = e.extra.round; }
    finally { busy = false; draw(); }
  }

  root.append(h("div", { class: "container hl-live stack" },
    ...head({ route: "higher_lower", eyebrow: "ЛУЗБЕТ • КАРТОЧНЫЙ ДЕПАРТАМЕНТ", title: "Больше / Меньше", sub: "Одна колода, 52 карты. Карты того же номинала пропускаются, а коэффициент считается по реальным остаткам в колоде.", badge: "RTP 97%" }),
    h("section", { class: "hl-live-layout" },
      h("div", { class: "hl-table card gilded" }, stage, status),
      h("aside", { class: "card hl-console" }, h("div", { class: "hl-console-top" }, h("span", { class: "eyebrow" }, "ПАНЕЛЬ ПРИНЯТИЯ РЕШЕНИЙ"), caseNo), controls)),
    memeEl,
    h("div", { class: "hl-regulation" }, h("b", {}, "§ 13.4 ВНУТРЕННЕГО РЕГЛАМЕНТА"), h("span", {}, "Если на столе 8 — следующей не может стать ни одна другая восьмёрка: они сгорают, не открываясь."), h("small", {}, "Даже случайность в ЛузБете сначала проходит комплаенс.")),
    footnote(rules, "Выплата = ⌊ставка × 0,97 / Π(выигрышные карты / допустимые карты)⌋, не более ×10 000.")));
  draw();
  if (round) status.textContent = "Дело восстановлено из архива. Карта на столе та же — сервер помнит всё.";
}
