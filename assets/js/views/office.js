// «Контора» — bookmaker parody. Nothing on these pages moves money or pretends to: every joke says what is real.
import { h, clear, fmt, toast, store } from "../ui.js";
import { meme, lines, pick } from "../memes.js";
import { JOKE_LINE } from "../memes-office.js";
import { GAMES, switcher } from "./game-kit.js";
import { openSupport } from "../support.js";
import { sfx } from "../sound.js";

const SECTIONS = [
  ["withdraw", "💸", "Вывод средств", "Подайте заявку и наблюдайте за работой службы безопасности. Вечно."],
  ["rules", "📜", "Правила конторы", "Мелкий шрифт, крупные проценты и честный RTP каждой игры."],
  ["kyc", "🪪", "Верификация (KYC)", "Подтвердите личность, не присылая ни одного документа."],
  ["promo", "🎁", "Акции и бонусы*", "Звёздочка обязательна. Две акции даже настоящие."],
  ["line", "📊", "Линия дня", "Коэффициенты на события вашей жизни. Ставки не принимаются."],
  ["support", "🎧", "Поддержка 24/7*", "*24 секунды из 7 дней. Отвечает бот, который этого не скрывает."],
];

export async function mount(root, { app, sub }) {
  const page = { withdraw, rules, kyc, promo, line }[sub];
  const wrap = h("div", { class: "container stack office" });
  root.append(wrap);
  wrap.append(h("div", { class: "office-crumbs" }, h("a", { href: "#/office" }, "Контора"), sub ? " / " + (SECTIONS.find((s) => s[0] === sub)?.[2] || "") : null));
  if (page) return page(wrap, app);
  wrap.append(
    h("section", { class: "office-hero card gilded" },
      h("div", { class: "eyebrow" }, "ООО «ЛузБет Букмекерская Контора» · лицензия выдана самим себе"),
      h("h1", {}, "Контора"),
      h("p", { class: "muted" }, "Здесь мы пародируем всё, за что не любят букмекеров: вечный вывод, мелкий шрифт, бонусы со звёздочкой и поддержку, которая не поддерживает. Разница одна: у нас это шутка, а исходы игр — честные и проверяемые."),
      h("div", { class: "office-stamp", "aria-hidden": "true" }, "ОДОБРЕНО", h("br"), "ОТДЕЛОМ САТИРЫ")),
    h("div", { class: "office-grid" }, SECTIONS.map(([k, e, t, d]) => h("a", {
      class: "office-tile card", href: k === "support" ? "#/office" : "#/office/" + k,
      onclick: k === "support" ? (ev) => { ev.preventDefault(); openSupport(app); } : null,
    }, h("span", { class: "office-e", "aria-hidden": "true" }, e), h("h3", {}, t), h("p", { class: "muted" }, d)))));
}

// ------------------------------------------------------------------ Withdrawal: eternal security check (honest: nothing is sent)
function withdraw(wrap, app) {
  const state = store.sget("withdraw", null);
  const box = h("div", { class: "stack" });
  wrap.append(
    h("div", { class: "game-head" }, h("div", {}, h("div", { class: "eyebrow" }, "Финансовый отдел · окно №67"), h("h1", {}, "Вывод средств"))),
    h("div", { class: "card tight office-truth" }, h("b", {}, "Честно: "), "ЛК — виртуальная валюта. Вывести её нельзя никуда и никогда. Эта страница — пародия: заявка ничего не списывает и никуда не отправляется, баланс не меняется."),
    box);
  let timer = 0;
  function form() {
    const amount = h("input", { class: "input num", type: "number", min: 1, value: Math.max(1, Math.min(app.me.balance, 1000)), "aria-label": "Сумма" });
    const method = h("select", { class: "input", "aria-label": "Способ" },
      ["На карту Бусинки (комиссия — одна креветка)", "Наличными в конверте из-под пиццы", "Криптой (кошачьей, курс плавающий)", "Обратно в казино (рекомендуем!)"].map((x) => h("option", {}, x)));
    clear(box, h("div", { class: "card stack" },
      h("div", { class: "field" }, h("label", {}, "Сумма к выводу, ЛК"), amount),
      h("div", { class: "field" }, h("label", {}, "Способ получения"), method),
      h("label", { class: "row small muted" }, h("input", { type: "checkbox", checked: true, disabled: true }), "Я согласен на проверку службой безопасности сроком до конца времён"),
      h("button", { class: "btn primary lg block", type: "button", onclick: () => {
        const a = Math.floor(+amount.value);
        if (!a || a < 1) return toast("Минимальная сумма вывода — 1 ЛК. Максимальная — тоже символическая.", "error");
        if (a > app.me.balance) return toast("Нельзя вывести больше, чем есть. Даже понарошку.", "error");
        const s = { amount: a, method: method.value, at: Date.now(), no: "ВЫВ-" + (100000 + Math.floor(Math.random() * 899999)) };
        store.sset("withdraw", s); sfx.ui(); tracker(s);
      } }, "Подать заявку на вывод")));
  }
  function tracker(s) {
    const steps = lines("withdraw.steps");
    const list = h("ol", { class: "wd-steps" });
    const bar = h("div", { class: "wd-bar" }, h("i"));
    const pctEl = h("b", { class: "num" });
    const eta = h("small", { class: "muted" });
    clear(box, h("div", { class: "card gilded stack" },
      h("div", { class: "row wrap" }, h("div", {}, h("div", { class: "eyebrow" }, "Заявка " + s.no), h("h3", {}, fmt(s.amount) + " ЛК · " + s.method)), h("div", { class: "spacer" }), h("span", { class: "badge" }, "НА ПРОВЕРКЕ")),
      bar, h("div", { class: "row" }, pctEl, h("span", { class: "spacer" }), eta), list,
      h("div", { class: "row wrap" },
        h("button", { class: "btn", type: "button", onclick: () => toast(pick("support.withdraw")) }, "Ускорить проверку"),
        h("button", { class: "btn danger", type: "button", onclick: () => { store.sset("withdraw", null); clearInterval(timer); toast("Заявка отменена. Средства возвращены на баланс. Они, впрочем, никуда и не уходили.", "ok"); form(); } }, "Отменить заявку"))));
    const tick = () => {
      const sec = (Date.now() - s.at) / 1000;
      const p = 99.9 * (1 - Math.exp(-sec / 40));             // asymptotically approaches 99.9% and never arrives
      bar.firstChild.style.width = p.toFixed(2) + "%";
      pctEl.textContent = p.toFixed(p > 99 ? 4 : 1) + "%";
      eta.textContent = "Осталось примерно: " + ["5 минут", "3–5 рабочих дней", "один экономический цикл", "до следующего полнолуния", "∞ (уточняется)"][Math.min(4, Math.floor(sec / 25))];
      const n = Math.min(steps.length, 1 + Math.floor(sec / 6));
      if (list.children.length !== n) clear(list, steps.slice(0, n).map((t, i) => h("li", { class: i < n - 1 ? "done" : "now" }, t, i < n - 1 ? h("small", { class: "muted" }, " — пройдено, но это ничего не значит") : h("small", { class: "muted" }, " — в процессе…"))));
      if (n === steps.length && sec > steps.length * 6 + 8) { s.at = Date.now() - 6000; store.sset("withdraw", s); toast("Проверка обнаружила, что проверка не проверена. Начинаем заново."); }
    };
    tick(); clearInterval(timer); timer = setInterval(tick, 1000);
  }
  state ? tracker(state) : form();
  return () => clearInterval(timer);
}

// ------------------------------------------------------------------ Rules: fine print + the real numbers
function rules(wrap) {
  const RTP = {
    roulette: ["97,30%", "Европейская, один ноль. Прямая ставка 35:1."], blackjack: ["≈99,4%", "6 колод, дилер стоит на soft 17, BJ 3:2, сплит один раз."],
    businka_slots: ["96,23%", "Точный расчёт по лентам; фриспины ×2."], crash: ["97%", "P(краш ≥ x) = 0,97 / x."], dice: ["97%", "Выплата 97/шанс."],
    mines: ["97%", "Множитель 0,97 × обратная вероятность."], higher_lower: ["97%", "0,97 / вероятность пути."], plinko: ["≈97,05–97,10%", "12 рядов, три профиля риска."],
    horse: ["95%", "Маржа 5% в коэффициентах, публично."],
  };
  wrap.append(
    h("div", { class: "game-head" }, h("div", {}, h("div", { class: "eyebrow" }, "Юридический отдел · редакция 67"), h("h1", {}, "Правила конторы"))),
    h("div", { class: "card stack" }, h("div", { class: "eyebrow" }, "Главное, крупным шрифтом"),
      h("ul", { class: "office-big" },
        h("li", {}, "ЛК — виртуальные очки. Их нельзя купить, вывести или обменять."),
        h("li", {}, "Каждый исход вычисляется из сида, хеш которого показан до ставки. Контора не может подкрутить результат — и вы можете это проверить."),
        h("li", {}, "Юмор относится к вашим решениям, а не к математике. Шутки никогда не влияют на исход."),
        h("li", {}, "Никаких фейковых победителей, фейковых джекпотов и «сейчас играют 1000 человек». Рейтинг показывает только реальных игроков клуба."))),
    h("div", { class: "card", style: { padding: 0 } }, h("div", { class: "table-wrap" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {}, h("th", {}, "Игра"), h("th", { class: "r" }, "RTP"), h("th", {}, "Суть"))),
      h("tbody", {}, GAMES.map((g) => h("tr", {}, h("td", {}, g.emoji + " ", h("a", { href: "#/" + g.route }, g.name)), h("td", { class: "r num gold" }, RTP[g.slug]?.[0] || g.tag), h("td", { class: "muted" }, RTP[g.slug]?.[1] || g.desc))))))),
    h("div", { class: "card stack office-fine" }, h("div", { class: "eyebrow" }, "Мелкий шрифт"),
      h("ol", {}, lines("office.fine").map((t) => h("li", {}, t)))),
    h("p", { class: "muted small" }, "Если игра перестаёт быть развлечением — остановитесь. Лучший коэффициент в этой конторе — у кнопки «Выйти»."));
}

// ------------------------------------------------------------------ KYC: verification without documents
function kyc(wrap) {
  const items = lines("kyc.items");
  const saved = store.get("kyc", []);
  const box = h("div", { class: "card stack" });
  const verdict = h("div");
  const draw = () => {
    const done = items.every((_, i) => saved.includes(i));
    clear(verdict, done ? h("div", { class: "verdict pass" }, h("h2", {}, "✓ Личность подтверждена"), h("p", { class: "meme-line" }, meme("kyc.done"))) : null);
  };
  clear(box, items.map((t, i) => h("label", { class: "kyc-item" },
    h("input", { type: "checkbox", checked: saved.includes(i), onchange: (e) => { const k = saved.indexOf(i); if (e.target.checked && k < 0) saved.push(i); if (!e.target.checked && k >= 0) saved.splice(k, 1); store.set("kyc", saved); sfx.ui(); draw(); } }),
    h("span", {}, t))));
  wrap.append(
    h("div", { class: "game-head" }, h("div", {}, h("div", { class: "eyebrow" }, "Служба безопасности · KYC"), h("h1", {}, "Верификация личности"))),
    h("div", { class: "card tight office-truth" }, h("b", {}, "Честно: "), "мы ничего не загружаем и не храним. Настоящий KYC тут не нужен — ЛК не деньги. Галочки хранятся только в вашем браузере."),
    h("p", { class: "muted" }, "Для прохождения верификации подтвердите следующие утверждения. Селфи с паспортом не требуется: мы и так видим по вашей истории ставок, кто вы."),
    box, verdict);
  draw();
}

// ------------------------------------------------------------------ Promotions with honest asterisks
function promo(wrap, app) {
  wrap.append(
    h("div", { class: "game-head" }, h("div", {}, h("div", { class: "eyebrow" }, "Отдел маркетинга (под надзором юристов)"), h("h1", {}, "Акции и бонусы*"))),
    h("div", { class: "promo-grid" }, lines("office.promo").map(([t, fine], i) => h("div", { class: ["promo-card card", i >= 8 ? "real" : ""] },
      h("span", { class: "badge " + (i >= 8 ? "ok" : "") }, i >= 8 ? "НАСТОЯЩАЯ" : "ПАРОДИЯ"),
      h("h3", {}, t), h("p", { class: "promo-fine" }, fine),
      i >= 8 ? h("a", { class: "btn sm primary", href: "#/lobby" }, "Забрать в лобби") : null))),
    h("p", { class: "muted small" }, "* Звёздочка — это место, куда настоящие конторы прячут правду. Мы прячем туда правду тоже, но хотя бы показываем её."));
}

// ------------------------------------------------------------------ Joke line of the day
function line(wrap) {
  wrap.append(
    h("div", { class: "game-head" }, h("div", {}, h("div", { class: "eyebrow" }, "Трейдинговый отдел"), h("h1", {}, "Линия дня"))),
    h("div", { class: "card tight office-truth" }, h("b", {}, "Честно: "), "это шутка. Ставки на эти события не принимаются, кнопки ничего не делают, кроме звука."),
    jokeLine());
}

export function jokeLine(limit = 99) {
  return h("div", { class: "card jl" }, h("div", { class: "jl-head" }, h("span", {}, "Событие"), h("span", {}, "Да"), h("span", {}, "Нет")),
    JOKE_LINE.slice(0, limit).map(([t, y, n]) => h("div", { class: "jl-row" }, h("span", {}, t),
      h("button", { class: "jl-odd", type: "button", onclick: () => { sfx.chip(); toast("Ставки на жизнь не принимаются. Её исход не проверить хешем."); } }, y),
      h("button", { class: "jl-odd", type: "button", onclick: () => { sfx.chip(); toast("Трейдер отклонил ставку. Шутка: трейдера нет, и ставок тоже."); } }, n))));
}

export { switcher };
