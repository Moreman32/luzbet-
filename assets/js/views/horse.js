import { h, clear, fmt, toast, sfx, meme, head, send, key, settle, resultTag, errorToast, footnote, currentRules } from "./game-kit.js";
import { store, reducedMotion, sleep, signed } from "../ui.js";
import { HORSES } from "../memes-office.js";

const FALLBACK_W = [300, 200, 150, 120, 90, 70, 45, 25];

export async function mount(root, { app }) {
  const rules = await currentRules("horse", { minBet: 1, maxBet: 10000, maxPerHorse: 5000 });
  const weights = (rules.horses || []).map((x) => x.w);
  const W = weights.length === 8 ? weights : FALLBACK_W;
  const tot = W.reduce((a, b) => a + b, 0);
  const odds = W.map((w) => Math.floor(95000 / w) / 100);
  const names = (rules.horses || []).map((x) => x.name);
  let stakes = store.get("horse-stakes", {});
  let racing = false;

  const lanes = h("div", { class: "hr-track", "aria-label": "Ипподром" });
  const runners = [];
  HORSES.forEach((hs, i) => {
    const runner = h("div", { class: "hr-runner", style: { left: "0%" } }, h("span", { class: "hr-horse", "aria-hidden": "true" }, i === 3 ? "🐈" : "🐎"), h("b", { class: "hr-no", style: { background: hs.color } }, String(i + 1)));
    runners.push(runner);
    lanes.appendChild(h("div", { class: "hr-lane" }, h("span", { class: "hr-lane-name" }, names[i] || hs.name), runner, h("span", { class: "hr-finish" })));
  });
  const board = h("div", { class: "hr-board" });
  const totalEl = h("b", { class: "num" });
  const memeEl = h("p", { class: "meme-line" });
  const resultBox = h("div");
  const raceBtn = h("button", { class: "btn primary lg block", type: "button", onclick: () => race() }, "Принять ставку");

  const total = () => Object.values(stakes).reduce((a, b) => a + (Number(b) || 0), 0);
  function drawBoard() {
    clear(board, HORSES.map((hs, i) => {
      const inp = h("input", { class: "input sm num", type: "number", min: 0, max: rules.maxPerHorse, value: stakes[i] || "", placeholder: "0", "aria-label": "Ставка на " + (names[i] || hs.name),
        oninput: (e) => { const v = Math.max(0, Math.min(rules.maxPerHorse, Math.floor(+e.target.value) || 0)); if (v) stakes[i] = v; else delete stakes[i]; store.set("horse-stakes", stakes); drawTotal(); } });
      const add = (d) => h("button", { class: "btn sm", type: "button", disabled: racing, onclick: () => { stakes[i] = Math.min(rules.maxPerHorse, (stakes[i] || 0) + d); inp.value = stakes[i]; store.set("horse-stakes", stakes); drawTotal(); sfx.chip(); } }, "+" + d);
      inp.disabled = racing;
      return h("div", { class: ["hr-card", stakes[i] ? "on" : ""] },
        h("div", { class: "hr-card-top" }, h("b", { class: "hr-no", style: { background: hs.color } }, String(i + 1)),
          h("div", {}, h("strong", {}, names[i] || hs.name), h("small", { class: "muted" }, hs.note)),
          h("div", { class: "hr-odds" }, h("b", { class: "num gold" }, odds[i].toFixed(2)), h("small", { class: "muted" }, (W[i] / tot * 100).toFixed(1) + "%"))),
        h("div", { class: "hr-stake" }, inp, add(10), add(100)));
    }));
    drawTotal();
  }
  function drawTotal() {
    const t = total();
    totalEl.textContent = fmt(t) + " ЛК";
    raceBtn.disabled = racing || t < 1 || t > rules.maxBet;
    board.querySelectorAll(".hr-card").forEach((c, i) => c.classList.toggle("on", !!stakes[i]));
  }

  async function animate(order) {
    runners.forEach((r) => { r.style.transition = "none"; r.style.left = "0%"; r.classList.remove("win"); });
    void lanes.offsetWidth;
    if (reducedMotion()) { order.forEach((hIdx, place) => { runners[hIdx].style.left = (88 - place * 5) + "%"; }); return; }
    // cosmetic race: positions follow the server's finishing order; jitter is visual only
    const place = new Map(order.map((hIdx, p) => [hIdx, p]));
    const steps = 9;
    for (let s = 1; s <= steps; s++) {
      runners.forEach((r, i) => {
        const p = place.get(i), base = (s / steps) * (88 - p * 5);
        const wobble = s < steps ? (Math.sin(i * 7.3 + s * 1.7) * 4) : 0;
        r.style.transition = "left 480ms cubic-bezier(.3,.6,.4,1)";
        r.style.left = Math.max(0, base + wobble) + "%";
      });
      sfx.tick(); await sleep(480);
    }
    runners[order[0]].classList.add("win");
  }

  async function race() {
    if (racing) return;
    const bets = Object.entries(stakes).filter(([, a]) => a > 0).map(([hIdx, a]) => ({ h: Number(hIdx), a: Number(a) }));
    const t = total();
    if (!bets.length) return toast("Выберите лошадь. Любую. Они все одинаково не знают о вашем существовании.");
    if (t > app.me.balance) return toast("Касса не принимает ставки в долг. Даже на Ипотеку.", "error");
    racing = true; drawBoard(); memeEl.textContent = "Лошади в стартовых боксах. Букмекер пересчитывает маржу."; clear(resultBox);
    let r;
    try { r = (await send("rpc_horse_bet", { p_bets: bets, p_idempotency_key: key("hr") })).round; }
    catch (e) { racing = false; drawBoard(); errorToast(e); return; }
    app.setBalance(r.balance - r.payout);
    await animate(r.state.order);
    racing = false; drawBoard();
    const winner = r.state.winner;
    const ctx = r.payout > 0 ? (winner >= 6 ? "horse.underdog" : "horse.win") : winner === 0 ? "horse.fav" : winner >= 6 ? "horse.underdog" : "horse.loss";
    settle(app, r, { ctx, memeEl, award: r.payout > 0 && winner === 7 ? "horseZhdun" : null });
    clear(resultBox, resultTag(r), h("ol", { class: "hr-result" }, r.state.order.map((hIdx) => {
      const line = (r.state.lines || []).find((l) => l.h === hIdx);
      return h("li", {}, h("b", { class: "hr-no", style: { background: HORSES[hIdx].color } }, String(hIdx + 1)), " ", names[hIdx] || HORSES[hIdx].name,
        line ? h("span", { class: ["num", line.win > 0 ? "win" : "loss"] }, ` · ставка ${fmt(line.a)} → ${line.win > 0 ? "+" + fmt(line.win) : signed(-line.a)}`) : null);
    })));
  }

  drawBoard();
  root.append(h("div", { class: "container stack" },
    ...head({ route: "horse", eyebrow: "Ипподром имени неправильных выводов", title: "Скачки", sub: "Восемь лошадей с опубликованными весами. Коэффициенты честно включают 5% маржи букмекера — как у настоящих, только мы в этом признаёмся.", badge: "RTP 95%" }),
    h("div", { class: "card gilded hr-stage" }, lanes, resultBox, memeEl),
    h("section", { class: "gk-layout hr-layout" },
      h("div", { class: "card" }, h("div", { class: "eyebrow" }, "Линия"), board),
      h("aside", { class: "card gk-panel stack" },
        h("div", { class: "bet-summary" }, h("div", {}, h("div", { class: "eyebrow" }, "Всего в купоне"), totalEl),
          h("div", {}, h("div", { class: "eyebrow" }, "Лимиты"), h("span", { class: "muted" }, `до ${fmt(rules.maxPerHorse)} на лошадь, до ${fmt(rules.maxBet)} всего`))),
        raceBtn,
        h("button", { class: "btn block", type: "button", onclick: () => { stakes = {}; store.set("horse-stakes", stakes); drawBoard(); } }, "Очистить купон"),
        h("p", { class: "muted small" }, "Можно ставить на нескольких лошадей. Выигрывает только первая. «Экспресс на всех» гарантирует проигрыш маржи — проверено математикой."))),
    footnote(rules, "Коэффициент = ⌊95000 / вес⌋ / 100. Порядок финиша — последовательные взвешенные выборы fairInt(сумма весов оставшихся).")));
}
