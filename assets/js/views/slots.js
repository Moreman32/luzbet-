import { h, clear, fmt, toast, sfx, meme, head, betInput, send, key, settle, resultTag, flash, errorToast, footnote, currentRules } from "./game-kit.js?v=2.3.8";
import { reducedMotion, sleep } from "../ui.js?v=2.3.8";

const SYM = [
  { e: "🐾", n: "Лапа (WILD)" }, { e: "🧶", n: "Клубок (SCATTER)" }, { e: "🐈", n: "Бусинка" }, { e: "👑", n: "Корона" },
  { e: "7", n: "Семёрка" }, { e: "💰", n: "Мешок ЛК" }, { e: "🥣", n: "Миска" }, { e: "🐟", n: "Рыбка" },
];
// Icons that never appear in the real symbol set (SYM) or any payline — used only for the rare
// cosmetic "glitch" below, so there's no chance of a player mistaking one for a real result.
const GLITCH = ["🐸", "👽", "🍕", "🎃", "🦄", "🛸", "🤡", "🦖", "🍩"];

export async function mount(root, { app }) {
  const rules = await currentRules("businka_slots", { minBet: 10, maxBet: 5000 });
  const strips = rules.strips || [[7, 6, 5], [7, 6, 5], [7, 6, 5], [7, 6, 5], [7, 6, 5]];
  const lines = rules.paylines || [];
  let busy = false;

  const bet = betInput({ app, min: rules.minBet, max: rules.maxBet, key: "slots", value: 50 });
  const cells = [];
  const reels = h("div", { class: "sl-reels" });
  for (let r = 0; r < 5; r++) {
    const col = h("div", { class: "sl-reel" });
    for (let row = 0; row < 3; row++) { const c = h("div", { class: "sl-cell" }, SYM[strips[r][row % strips[r].length]].e); cells.push(c); col.appendChild(c); }
    reels.appendChild(col);
  }
  const cell = (r, row) => cells[r * 3 + row];
  const info = h("div", { class: "sl-info" }, "Кошачья фортуна ждёт подношения.");
  const fsEl = h("div", { class: "sl-fs hidden" });
  const memeEl = h("p", { class: "meme-line" });
  const resultBox = h("div");
  const spinBtn = h("button", { class: "btn primary lg block sl-spin", type: "button", onclick: () => spin() }, "Крутить (пробел)");

  function paint(win) { for (let r = 0; r < 5; r++) for (let row = 0; row < 3; row++) { const c = cell(r, row); c.textContent = SYM[win[r * 3 + row]].e; c.className = "sl-cell s" + win[r * 3 + row]; } }

  async function roll(spinData, fast) {
    const win = spinData.window;
    cells.forEach((c) => c.classList.remove("hit"));
    if (reducedMotion() || fast) { paint(win); return; }
    const timers = [];
    // ~4% chance one reel briefly "glitches" and shows off-catalog icons during the blur — purely
    // cosmetic (this blur phase was already random filler, not the real result) and always snaps
    // to the true win[] values below regardless.
    const glitchReel = Math.random() < 0.04 ? Math.floor(Math.random() * 5) : -1;
    for (let r = 0; r < 5; r++) {
      let i = Math.floor(Math.random() * strips[r].length);            // cosmetic blur only; the result is already decided
      const isGlitch = r === glitchReel;
      timers.push(setInterval(() => {
        i = (i + 1) % strips[r].length;
        for (let row = 0; row < 3; row++) cell(r, row).textContent = isGlitch ? GLITCH[Math.floor(Math.random() * GLITCH.length)] : SYM[strips[r][(i + row) % strips[r].length]].e;
      }, 55));
      reels.children[r].classList.add("spin");
      if (isGlitch) { reels.children[r].classList.add("sl-glitch"); sfx.error(); }
    }
    for (let r = 0; r < 5; r++) {
      await sleep(r === 0 ? 520 : 230);
      clearInterval(timers[r]); reels.children[r].classList.remove("spin", "sl-glitch");
      for (let row = 0; row < 3; row++) { const c = cell(r, row); c.textContent = SYM[win[r * 3 + row]].e; c.className = "sl-cell s" + win[r * 3 + row]; }
      sfx.tick();
    }
    if (glitchReel >= 0) toast(meme("slots.glitch") || "Барабан на миг показал что-то не из этой игры.", "error");
  }

  function highlight(spinData) {
    const any = (spinData.lines || []).length || spinData.scatters >= 3;
    cells.forEach((c) => c.classList.toggle("dim", !!any));
    for (const [li, , n] of spinData.lines || []) for (let r = 0; r < n; r++) { cell(r, lines[li][r]).classList.add("hit"); cell(r, lines[li][r]).classList.remove("dim"); }
    if (spinData.scatters >= 3) spinData.window.forEach((s, i) => { if (s === 1) { cells[i].classList.add("hit"); cells[i].classList.remove("dim"); } });
  }

  async function spin() {
    if (busy) return;
    const b = bet.get();
    if (b > app.me.balance) return toast("Бусинка не принимает ставки в кредит. Даже рыбой.", "error");
    busy = true; spinBtn.disabled = true; bet.disable(true); clear(resultBox); memeEl.textContent = ""; fsEl.classList.add("hidden");
    let r;
    try { r = (await send("rpc_slots_spin", { p_bet: b, p_idempotency_key: key("sl") })).round; }
    catch (e) { errorToast(e); busy = false; spinBtn.disabled = false; bet.disable(false); return; }
    app.setBalance(r.balance - r.payout);
    const spins = r.state.spins || [];
    let acc = 0;
    for (let i = 0; i < spins.length; i++) {
      const s = spins[i];
      if (i === 1) { fsEl.classList.remove("hidden"); sfx.bigWin(); memeEl.textContent = meme("slots.feature"); await sleep(reducedMotion() ? 0 : 900); }
      if (i > 0) fsEl.textContent = `Фриспин ${i} из ${spins.length - 1} · ×${s.mult}`;
      await roll(s, i > 0 && spins.length > 15);
      highlight(s);
      const u = Number(s.units);
      acc += Math.floor(b * u);
      info.textContent = u > 0 ? `${i ? "Фриспин" : "Спин"}: ×${u} ставки` + (s.scatters >= 3 ? ` · клубков: ${s.scatters}` : "") : (i ? "Фриспин пустой. Кот зевнул." : "Ни одной линии.");
      if (u > 0) sfx.win();
      await sleep(reducedMotion() ? 0 : (i ? 380 : 200));
    }
    const units = Number(r.state.totalUnits);
    const ctx = spins.length > 1 ? (r.payout > r.bet * 10 ? "slots.big" : "slots.feature") : r.payout === 0 ? "slots.nothing" : r.payout > r.bet * 10 ? "slots.big" : "slots.small";
    settle(app, r, { ctx, memeEl, award: spins.length > 1 ? "slotsFeature" : null });
    info.textContent = r.payout > 0 ? `Итог: ×${units} ставки` + (spins.length > 1 ? ` за ${spins.length - 1} фриспинов` : "") : info.textContent;
    const hits = spins.reduce((a, s) => a + (s.lines || []).length, 0), feats = spins.length - 1;
    const last = spins[spins.length - 1] || {};
    const lineTxt = (last.lines || []).slice(0, 3).map(([li, sym, n, p]) => `линия ${li + 1}: ${SYM[sym].e}×${n} = ×${p / 10}`).join(", ");
    const why = r.payout === 0 ? "Ни одной линии из 3+ одинаковых символов слева направо."
      : feats ? `Бонус: ${feats} фриспинов с множителем ×2, выигрышных линий за раунд — ${hits}.`
      : `Выигрышных линий: ${hits}${lineTxt ? " (" + lineTxt + ")" : ""}` + (last.scatters >= 3 ? `, клубков: ${last.scatters}` : "") + ".";
    clear(resultBox, resultTag(r, why));
    flash(root.querySelector(".gk-stage"), r);
    busy = false; spinBtn.disabled = false; bet.disable(false);
  }

  const onKey = (e) => { if (e.code === "Space" && !["INPUT", "TEXTAREA", "BUTTON"].includes(document.activeElement?.tagName)) { e.preventDefault(); spin(); } };
  document.addEventListener("keydown", onKey);

  const pay = rules.pay || {};
  const table = h("div", { class: "sl-paytable" },
    [2, 3, 4, 5, 6, 7].map((s) => h("div", { class: "sl-pay" }, h("span", { class: "e" }, SYM[s].e),
      h("small", {}, SYM[s].n), h("span", { class: "num muted" }, ["3", "4", "5"].map((n) => `${n}× ${pay[s]?.[n] ?? "?"}`).join(" · ")))),
    h("div", { class: "sl-pay" }, h("span", { class: "e" }, "🐾"), h("small", {}, "WILD заменяет всё, кроме клубка; 3+ лапы с начала линии платят как Бусинка")),
    h("div", { class: "sl-pay" }, h("span", { class: "e" }, "🧶"), h("small", {}, "3/4/5 клубков в любом месте: ×2/×10/×50 ставки и 8/10/12 фриспинов с множителем ×2 (повтор +5, максимум 50)")));

  root.append(h("div", { class: "container stack" },
    ...head({ route: "slots", eyebrow: "Премиальный слот под надзором кошки", title: "Бусинка: Кошачья фортуна", sub: "5 барабанов, 10 линий. Выплаты линий указаны в долях ставки на линию (ставка / 10).", badge: "RTP 96,23%" }),
    h("section", { class: "gk-layout" },
      h("div", { class: "card gilded gk-stage sl-stage" }, fsEl, reels, info, resultBox, memeEl),
      h("aside", { class: "card gk-panel stack" }, bet.el, spinBtn,
        h("p", { class: "muted small" }, "Весь бонус с фриспинами разыгрывается одним раундом: выигрыш зачисляется сразу, анимация — просто для красоты."))),
    h("details", { class: "card more" }, h("summary", {}, "Таблица выплат"), table),
    footnote(rules, "Остановки барабанов = fairInt(длина ленты) из одного HMAC-потока; ленты и таблица опубликованы в правилах.")));
  return () => document.removeEventListener("keydown", onKey);
}
