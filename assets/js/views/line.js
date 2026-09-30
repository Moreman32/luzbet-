// «Линия» — real pari-mutuel (tote) betting. The server holds the pools, closes betting and settles; this view only shows
// the numbers it gets back and sends intents.
import { rpc } from "../api.js?v=2.3.1";
import { h, clear, fmt, signed, toast, store, newKey, dt } from "../ui.js?v=2.3.1";
import { sfx } from "../sound.js?v=2.3.1";
import { meme } from "../memes.js?v=2.3.1";

const TABS = [["open", "Приём ставок"], ["live", "Идёт подсчёт"], ["settled", "Результаты"], ["mine", "Мои ставки"]];
let offset = 0;                                         // server clock − local clock
const now = () => Date.now() + offset;

function left(ts) {
  let s = Math.max(0, Math.floor((Date.parse(ts) - now()) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const hh = Math.floor(s / 3600); s -= hh * 3600;
  const mm = Math.floor(s / 60);
  return d ? `${d} д ${hh} ч` : hh ? `${hh} ч ${mm} мин` : mm ? `${mm} мин` : "меньше минуты";
}
const hm = (ts) => new Date(ts).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// what a stake x on option i returns if it wins, with the pools as they are right now
export function estimate(e, i, x) {
  const w = e.options[i].pool + x, l = e.total - e.options[i].pool;
  if (!w) return 0;
  return x + Math.floor((l - Math.floor(l * e.commission)) * x / w);
}
const kef = (e, i) => {
  const w = e.options[i].pool, l = e.total - w;
  if (!l) return "×?";                                   // nobody on the other side yet
  const base = w || 100;                                 // empty side: show what a 100 ЛК stake would get
  return "×" + (1 + (l - Math.floor(l * e.commission)) / base).toFixed(2);
};

export function eventCard(e, { app, onChange, compact = false } = {}) {
  let pick = null;
  const card = h("article", { class: ["card ln-card", e.status !== "open" ? "done" : "", compact ? "compact" : ""], id: "ev-" + e.id });
  const amount = h("input", { class: "input num", type: "number", min: 1, step: 1, value: store.get("line-amount", 100), "aria-label": "Сумма ставки" });
  const preview = h("p", { class: "ln-preview muted" });
  const betBtn = h("button", { class: "btn primary block", type: "button", disabled: true }, "Выберите исход");
  const settledWin = e.status === "settled" ? e.result : null;

  function drawPreview() {
    const x = Math.max(0, Math.floor(+amount.value) || 0);
    store.set("line-amount", x || 100);
    if (pick === null) { betBtn.disabled = true; betBtn.textContent = "Выберите исход выше"; preview.textContent = ""; return; }
    betBtn.disabled = x < 1;
    betBtn.textContent = `Поставить ${fmt(x)} ЛК на «${e.options[pick].label}»`;
    const ret = estimate(e, pick, x);
    preview.textContent = `Если сыграет — вернётся ≈ ${fmt(ret)} ЛК (+${fmt(ret - x)}). Это оценка по текущим ставкам: коэффициент тотализатора меняется, пока идёт приём.`;
  }
  const optsEl = h("div", { class: "ln-opts" }, e.options.map((o) => {
    const mineOn = (e.mine || []).filter((b) => b.option === o.idx).reduce((a, b) => a + b.amount, 0);
    const share = e.total ? Math.round((o.pool / e.total) * 100) : 0;
    const b = h("button", { type: "button", class: ["ln-opt", settledWin === o.idx ? "winner" : "", settledWin !== null && settledWin !== o.idx ? "loser" : "", mineOn ? "has-mine" : ""],
      disabled: !e.open, "aria-pressed": "false",
      onclick: () => { pick = o.idx; optsEl.querySelectorAll(".ln-opt").forEach((x, j) => { x.classList.toggle("on", j === o.idx); x.setAttribute("aria-pressed", String(j === o.idx)); }); sfx.chip(); drawPreview(); } },
      h("span", { class: "ln-opt-label" }, settledWin === o.idx ? "✓ " : "", o.label),
      h("b", { class: "ln-kef num" }, kef(e, o.idx)),
      h("span", { class: "ln-bar" }, h("i", { style: { width: share + "%" } })),
      h("small", { class: "muted num" }, `${fmt(o.pool)} ЛК · ${o.people} чел.` + (mineOn ? ` · ваши ${fmt(mineOn)}` : "")));
    return b;
  }));
  amount.addEventListener("input", drawPreview);

  const quick = h("div", { class: "gk-quick" }, [10, 50, 100, 500].map((v) => h("button", { class: "btn sm", type: "button", onclick: () => { amount.value = v; drawPreview(); } }, String(v))));
  betBtn.addEventListener("click", async () => {
    const x = Math.floor(+amount.value);
    if (pick === null || !x) return;
    if (x > app.me.balance) return toast("Касса принимает ставки только из наличных ЛК.", "error");
    betBtn.disabled = true;
    try {
      const r = await rpc("rpc_line_bet", { p_event: e.id, p_option: pick, p_amount: x, p_idempotency_key: newKey("ln") });
      app.setBalance(r.balance); sfx.cash();
      toast(`Ставка принята: ${fmt(x)} ЛК на «${e.options[pick].label}». ${meme("line.bet")}`, "ok");
      onChange && onChange(r.event);
    } catch (err) { toast(err.message, "error"); sfx.error(); betBtn.disabled = false; }
  });

  const status = e.status === "settled" ? h("span", { class: "badge ok" }, "Рассчитано")
    : e.status === "void" ? h("span", { class: "badge" }, "Возврат")
    : e.open ? h("span", { class: "badge gold" }, "Приём ещё " + left(e.closesAt))
    : h("span", { class: "badge" }, e.periodEnd ? "Подсчёт до " + hm(e.periodEnd) : "Ждём результат");
  const when = e.kind === "auto"
    ? `Считаем раунды с ${hm(e.periodStart)} до ${hm(e.periodEnd)} · ставки до ${hm(e.closesAt)}`
    : `Ставки до ${hm(e.closesAt)} · рассчитывает ${e.createdBy || "администрация"}`;
  const mine = (e.mine || []).map((b) => h("li", { class: "ln-mine-" + b.status },
    `${fmt(b.amount)} ЛК на «${e.options[b.option]?.label}» — `,
    b.status === "open" ? "ждём итог" : b.status === "won" ? h("b", { class: "win" }, `выигрыш ${fmt(b.payout)} (${signed(b.payout - b.amount)})`)
      : b.status === "refunded" ? h("span", {}, `возврат ${fmt(b.payout)}`) : h("span", { class: "loss" }, "не сыграла")));
  const settledMine = (e.mine || []).find((b) => b.status !== "open");
  const mineMeme = settledMine ? h("p", { class: "meme-line" }, meme(settledMine.status === "won" ? "line.win" : settledMine.status === "refunded" ? "line.refund" : "line.loss")) : null;

  card.append(...[
    h("div", { class: "ln-top" }, h("span", { class: ["badge", e.kind === "auto" ? "" : "gold"] }, e.kind === "auto" ? "АВТО" : "ОТ АДМИНИСТРАЦИИ"), h("div", { class: "spacer" }), status),
    h("h3", {}, e.title),
    h("p", { class: "ln-when muted" }, when),
    !compact && e.description ? h("p", { class: "ln-desc" }, e.description) : null,
    optsEl,
    e.status !== "open" && e.resultNote ? h("p", { class: ["ln-note", e.status === "void" ? "" : "win"] }, (e.status === "void" ? "Возврат: " : "Итог: ") + e.resultNote) : null,
    e.open && !e.isCreator && !compact ? h("div", { class: "ln-bet" }, h("div", { class: "ln-bet-row" }, amount, quick), betBtn, preview) : null,
    e.open && compact ? h("a", { class: "btn block", href: "#/line?e=" + e.id }, "Сделать ставку →") : null,
    e.isCreator && e.open ? h("p", { class: "muted small" }, "Вы создали это событие, поэтому ставить на него не можете.") : null,
    mine.length ? h("ul", { class: "ln-mine" }, mine) : null,
    mineMeme,
    h("p", { class: "muted small" }, `Банк: ${fmt(e.total)} ЛК · комиссия конторы ${Math.round(e.commission * 100)}% только с проигравших ставок`)].filter(Boolean));
  return card;
}

export async function mount(root, { app, params }) {
  let tab = params?.get("tab") || "open";
  const focus = params?.get("e");
  const body = h("div", { class: "stack" });
  const seg = h("div", { class: "seg" });
  const limitsEl = h("span", { class: "muted small" });
  const drawSeg = () => clear(seg, TABS.map(([k, l]) => h("button", { type: "button", class: k === tab ? "on" : null, onclick: () => { tab = k; drawSeg(); load(); } }, l)));

  async function load() {
    clear(body, h("p", { class: "muted" }, "Букмекер пересчитывает банк…"));
    let r;
    try { r = await rpc("rpc_line_list", { p_scope: tab }); } catch (e) { clear(body, h("p", { class: "loss" }, e.message)); return; }
    offset = Date.parse(r.serverNow) - Date.now();
    limitsEl.textContent = `Ставка ${fmt(r.limits.min)}–${fmt(r.limits.max)} ЛК, до ${fmt(r.limits.perEvent)} ЛК на одно событие.`;
    if (!r.events.length) {
      clear(body, h("div", { class: "card" }, h("p", { class: "muted" }, {
        open: "Сейчас приём ставок закрыт. Новые события появятся к началу следующего периода.",
        live: "Сейчас ничего не считается. Букмекер отдыхает, что с ним бывает редко.",
        settled: "Рассчитанных событий пока нет.",
        mine: "Вы ещё не ставили в линии. Банк скучает." }[tab])));
      return;
    }
    // group by betting deadline / period so the list reads like a real bookmaker line
    const groups = new Map();
    for (const e of r.events) {
      const k = e.kind === "auto" ? `Период ${hm(e.periodStart)} – ${hm(e.periodEnd)}` : "События от администрации";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    clear(body, [...groups].map(([k, evs]) => h("section", { class: "ln-group" }, h("div", { class: "eyebrow" }, k + ` · ${evs.length}`),
      h("div", { class: "ln-grid" }, evs.map((e) => eventCard(e, { app, onChange: () => load() }))))));
    if (focus) document.getElementById("ev-" + focus)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  drawSeg();
  root.append(h("div", { class: "container stack" },
    h("div", { class: "game-head" }, h("div", {}, h("div", { class: "eyebrow" }, "Букмекерская линия · тотализатор"), h("h1", {}, "Линия"),
      h("p", { class: "muted" }, "Настоящие ставки ЛК на события. Все ставки идут в общий банк, выигравшие делят деньги проигравших.")),
      h("div", { class: "spacer" }), seg),
    h("details", { class: "card gk-howto", open: !store.get("howto-line", false), ontoggle: () => store.set("howto-line", true) },
      h("summary", {}, h("span", { class: "gk-howto-q" }, "?"), "Как работает линия — за 30 секунд"),
      h("div", { class: "gk-howto-body" },
        h("ol", {},
          h("li", {}, h("b", {}, "Выберите событие и исход, "), "впишите сумму и нажмите «Поставить». ЛК списываются сразу."),
          h("li", {}, h("b", {}, "Тотализатор: "), "все ставки на событие лежат в общем банке. Когда исход известен, выигравшие получают свою ставку назад плюс долю денег проигравших — пропорционально сумме."),
          h("li", {}, h("b", {}, "Коэффициент плавает: "), "×2.10 сейчас — это «если бы всё закончилось прямо сейчас». Чем больше людей ставит на тот же исход, тем он ниже."),
          h("li", {}, h("b", {}, "Контора берёт 5% "), "только с проигравших ставок. Выигравший никогда не получит меньше, чем поставил."),
          h("li", {}, h("b", {}, "Автособытия "), "считаются по реальным раундам всех игроков за 12 часов. Ставки закрываются ДО начала подсчёта, а вопросы выбраны так, что «накрутить» ответ игрой нельзя — каждый раунд почти монетка."),
          h("li", {}, h("b", {}, "Возврат, если: "), "ничья, мало раундов, все поставили на одно и то же или никто не угадал.")),
        h("p", { class: "gk-howto-joke" }, "💬 В отличие от настоящих букмекеров, наша маржа написана крупным шрифтом. Мелким у нас только шутки."))),
    limitsEl, body));
  store.set("howto-line", true);
  await load();
}
