import { h, clear, fmt, toast, sfx, meme, head, betInput, send, key, settle, resultTag, errorToast, footnote, currentRules } from "./game-kit.js?v=2.1.1";
import { store, reducedMotion, sleep } from "../ui.js?v=2.1.1";

export async function mount(root, { app }) {
  const rules = await currentRules("dice", { minBet: 1, maxBet: 7500, minChance: 2, maxChance: 95 });
  let chance = store.get("dice-chance", 50), dir = store.get("dice-dir", "under"), busy = false;

  const bet = betInput({ app, min: rules.minBet, max: rules.maxBet, key: "dice", value: 100, onChange: sync });
  const pct = h("input", { class: "dice-range", type: "range", min: rules.minChance, max: rules.maxChance, value: chance, "aria-label": "Шанс, %" });
  const chanceEl = h("strong", { class: "dice-chance num" });
  const multEl = h("strong", { class: "gold num" });
  const payEl = h("strong", { class: "num" });
  const bar = h("div", { class: "dc-bar" }, h("div", { class: "dc-zone" }), h("div", { class: "dc-marker hidden" }, h("span", {})));
  const result = h("div", { class: "dice-result idle" }, h("span", {}, "—"), h("small", {}, "ожидаем решение статистического комитета"));
  const memeEl = h("p", { class: "meme-line" });
  const resultBox = h("div");
  const under = h("button", { class: "btn", type: "button", onclick: () => setDir("under") }, "НИЖЕ ⬇");
  const over = h("button", { class: "btn", type: "button", onclick: () => setDir("over") }, "ВЫШЕ ⬆");

  function sync() {
    chance = Number(pct.value); store.set("dice-chance", chance);
    chanceEl.textContent = chance + "%";
    multEl.textContent = (97 / chance).toFixed(4).replace(/0+$/, "").replace(/\.$/, "") + "×";
    payEl.textContent = fmt(Math.floor((bet.get() * 97) / chance)) + " ЛК";
    const z = bar.firstChild;
    if (dir === "under") { z.style.left = "0%"; z.style.width = chance + "%"; } else { z.style.left = (100 - chance) + "%"; z.style.width = chance + "%"; }
  }
  function setDir(v) { dir = v; store.set("dice-dir", v); under.className = "btn " + (v === "under" ? "primary" : ""); over.className = "btn " + (v === "over" ? "primary" : ""); sync(); }
  pct.addEventListener("input", sync);

  const play = h("button", { class: "btn primary lg block", type: "button", onclick: () => roll() }, "ПЕРЕДАТЬ ДЕЛО В ОТДЕЛ ВЕРОЯТНОСТЕЙ");
  async function roll() {
    if (busy) return;
    const amount = bet.get();
    if (amount > app.me.balance) return toast("Ставка должна существовать хотя бы юридически. И на балансе.", "error");
    busy = true; play.disabled = true; clear(resultBox); memeEl.textContent = "";
    let r;
    try { r = (await send("rpc_dice_roll", { p_bet: amount, p_chance: chance, p_direction: dir, p_idempotency_key: key("dc") })).round; }
    catch (e) { errorToast(e); busy = false; play.disabled = false; return; }
    const x = r.state.roll / 100, won = r.state.won;
    const mk = bar.children[1]; mk.classList.remove("hidden");
    if (!reducedMotion()) { for (let i = 0; i < 8; i++) { mk.style.left = (Math.random() * 100) + "%"; mk.firstChild.textContent = (Math.random() * 100).toFixed(2); await sleep(55); } }
    mk.style.left = x + "%"; mk.firstChild.textContent = x.toFixed(2); mk.className = "dc-marker " + (won ? "won" : "lost");
    result.className = "dice-result " + (won ? "won" : "lost");
    result.replaceChildren(h("span", {}, x.toFixed(2)), h("small", {}, won ? "ПОСТАНОВЛЕНИЕ: ВЫПЛАТИТЬ" : "ПОСТАНОВЛЕНИЕ: ОТКАЗАТЬ"));
    const ctx = won && chance <= 15 ? "dice.longshotWin" : !won && chance >= 80 ? "dice.safeLoss" : won ? "dice.win" : "dice.loss";
    settle(app, r, { ctx, memeEl, award: won && chance <= 15 ? "diceLong" : !won && chance >= 80 ? "diceSafeLoss" : null });
    clear(resultBox, resultTag(r));
    busy = false; play.disabled = false;
  }

  root.append(h("div", { class: "container stack dice-page" },
    ...head({ route: "dice", eyebrow: "Комитет по случайным числам", title: "Dice", sub: "Вы задаёте вероятность. Мы предоставляем число от 0,00 до 99,99. Ответственность за выводы остаётся на заявителе.", badge: "RTP 97%" }),
    h("section", { class: "dice-layout" },
      h("div", { class: "card gilded dice-stage" }, h("div", { class: "dice-orb" }, result), bar, h("div", { class: "dice-scale" }, h("span", {}, "0"), h("span", {}, "25"), h("span", {}, "50"), h("span", {}, "75"), h("span", {}, "100")), resultBox, memeEl),
      h("div", { class: "card stack" }, bet.el,
        h("div", { class: "dice-metrics" }, h("div", {}, h("small", { class: "muted" }, "Шанс"), chanceEl), h("div", {}, h("small", { class: "muted" }, "Множитель"), multEl), h("div", {}, h("small", { class: "muted" }, "Выплата"), payEl)),
        pct, h("div", { class: "row" }, under, over), play,
        h("p", { class: "muted dice-legal" }, "House edge 3%. Отдел магии расформирован."))),
    h("div", { class: "card tight dice-memo" }, h("b", {}, "Служебная пометка:"), " вероятность выигрыша регулируется ползунком. Вероятность сделать после выигрыша неправильные выводы — нет."),
    footnote(rules, "Число = fairInt(10000)/100. «Ниже»: выигрыш, если число < шанса; «выше»: если ≥ 100 − шанс. Выплата = ⌊ставка × 97 / шанс⌋.")));
  setDir(dir);
}
