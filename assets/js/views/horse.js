import { h, clear, fmt, toast, sfx, meme, head, send, key, settle, resultTag, flash, errorToast, footnote, currentRules } from "./game-kit.js?v=2.3.8";
import { store, reducedMotion, signed } from "../ui.js?v=2.3.8";
import { HORSES } from "../memes-office.js?v=2.3.8";

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
    lanes.appendChild(h("div", { class: "hr-lane", dataset: { h: i } }, h("span", { class: "hr-lane-name" }, names[i] || hs.name, h("em", { class: "hr-mine" })), runner, h("span", { class: "hr-finish" })));
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
    lanes.querySelectorAll(".hr-lane").forEach((ln) => { const a = stakes[ln.dataset.h]; ln.classList.toggle("mine", !!a); ln.querySelector(".hr-mine").textContent = a ? ` ★ ваша ставка ${fmt(a)}` : ""; });
    board.querySelectorAll(".hr-card").forEach((c, i) => c.classList.toggle("on", !!stakes[i]));
  }

  const QUIRK_CLASS = { spook: "spooked", graze: "grazing", turbo: "turbo" };
  async function animate(order) {
    runners.forEach((r) => { r.style.transition = "none"; r.style.left = "0%"; r.classList.remove("win", "spooked", "grazing", "turbo"); delete r.dataset.quirkShown; });
    void lanes.offsetWidth;
    if (reducedMotion()) { order.forEach((hIdx, place) => { runners[hIdx].style.left = (88 - place * 5) + "%"; }); return; }
    // cosmetic race only: final positions always follow the server's finishing order (`order`).
    // Everything below — pacing, wobble, and the rare per-horse "quirk" (spooks backward off-track,
    // stops to graze, or bursts forward) — is visual flavor driven by requestAnimationFrame for
    // smooth motion; it never changes who actually won.
    const place = new Map(order.map((hIdx, p) => [hIdx, p]));
    const DURATION = 4300;
    const phase = runners.map(() => Math.random() * Math.PI * 2);
    const quirk = runners.map(() => { // ~3% chance each, mutually exclusive, cosmetic only
      const roll = Math.random();
      return roll < 0.03 ? "spook" : roll < 0.06 ? "graze" : roll < 0.09 ? "turbo" : null;
    });
    const qAt = runners.map(() => 0.2 + Math.random() * 0.42);
    const qLen = runners.map(() => 0.1 + Math.random() * 0.08);
    const grazeFrozen = new Array(runners.length).fill(null);
    lanes.classList.add("racing");
    await new Promise((resolve) => {
      const t0 = performance.now();
      let lastTick = t0;
      function frame(now) {
        const tt = Math.min(1, (now - t0) / DURATION);
        const ease = 1 - Math.pow(1 - tt, 3);
        runners.forEach((r, i) => {
          const target = 88 - place.get(i) * 5;
          let x = ease * target + Math.sin(tt * 11 + phase[i]) * (3.5 * (1 - tt));
          const q = quirk[i], active = q && tt >= qAt[i] && tt < qAt[i] + qLen[i];
          if (active) {
            const lt = (tt - qAt[i]) / qLen[i];
            if (q === "spook") { x -= Math.sin(lt * Math.PI) * 34; }
            else if (q === "turbo") { x = Math.min(92, x + Math.sin(lt * Math.PI) * 14); }
            else if (q === "graze") {
              if (grazeFrozen[i] === null) grazeFrozen[i] = x;
              x = grazeFrozen[i] + (x - grazeFrozen[i]) * (lt * lt); // eases from frozen back onto the curve — no teleport
            }
            const cls = QUIRK_CLASS[q];
            if (!r.classList.contains(cls)) {
              r.classList.add(cls);
              if (!r.dataset.quirkShown) {
                r.dataset.quirkShown = "1";
                memeEl.textContent = `«${names[i] || HORSES[i].name}» ${meme("horse." + q)}`;
                if (q === "spook") sfx.error(); else sfx.tick();
              }
            }
          } else {
            const cls = q && QUIRK_CLASS[q];
            if (cls && r.classList.contains(cls)) r.classList.remove(cls);
          }
          r.style.left = Math.max(-18, x) + "%";
        });
        if (now - lastTick > 460) { sfx.tick(); lastTick = now; }
        if (tt < 1) requestAnimationFrame(frame); else resolve();
      }
      requestAnimationFrame(frame);
    });
    lanes.classList.remove("racing");
    runners.forEach((r, i) => { r.classList.remove("spooked", "grazing", "turbo"); r.style.left = (88 - place.get(i) * 5) + "%"; });
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
    const wl = (r.state.lines || []).find((l) => l.h === winner);
    const why = wl ? `Первой пришла «${names[winner] || HORSES[winner].name}» — ваша ставка ${fmt(wl.a)} × ${Number(wl.odds).toFixed(2)} = ${fmt(wl.win)} ЛК.`
      : `Первой пришла «${names[winner] || HORSES[winner].name}», а на неё вы не ставили.`;
    lanes.querySelectorAll(".hr-lane").forEach((ln) => ln.classList.toggle("won", Number(ln.dataset.h) === winner));
    flash(root.querySelector(".hr-stage"), r);
    clear(resultBox, resultTag(r, why), h("ol", { class: "hr-result" }, r.state.order.map((hIdx) => {
      const line = (r.state.lines || []).find((l) => l.h === hIdx);
      return h("li", { class: [hIdx === winner ? "first" : "", line ? (line.win > 0 ? "mine win" : "mine lose") : ""] }, h("b", { class: "hr-no", style: { background: HORSES[hIdx].color } }, String(hIdx + 1)), " ", names[hIdx] || HORSES[hIdx].name,
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
