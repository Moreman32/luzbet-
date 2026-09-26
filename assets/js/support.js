// «Поддержка 24/7*» — a canned-answer bot that openly admits being one. Purely client-side, sends nothing anywhere.
import { h, fmt, icon } from "./ui.js";
import { meme } from "./memes.js";
import { sfx } from "./sound.js";

let panel = null, ticket = 0;

const RULES = [
  [/вывод|вывести|вывес|снять|withdraw|деньги верн|верните/i, "support.withdraw"],
  [/бонус|фрибет|промо|акци|кэшбэк|кешбек/i, "support.bonus"],
  [/подкру|скам|обман|наеб|развод|честн|рандом|rigged|чит/i, "support.rigged"],
  [/оператор|человек|живой|менеджер|позов/i, "support.human"],
  [/спасибо|благодар|пока|ясно/i, "support.thanks"],
  [/[!?]{3,}|бля|сука|хер|ненавиж|идиот|тупые|верни/i, "support.angry"],
];

function reply(app, text) {
  if (/баланс|сколько у меня|сколько лк/i.test(text)) return `По данным бухгалтерии на вашем счёте ${fmt(app.me?.balance)} ЛК. Это единственная цифра, которую я знаю наверняка.`;
  if (/проверить|хеш|сид|seed|hash/i.test(text)) return "Раздел «Честность» → раскройте сид → в «Истории» нажмите на раунд → «Проверить». Пересчёт идёт в вашем браузере, без нашего участия.";
  for (const [re, ctx] of RULES) if (re.test(text)) return meme(ctx);
  return meme(Math.random() < 0.3 ? "support.queue" : "support.generic", { n: ++ticket + 6700 });
}

export function openSupport(app) {
  if (panel) { panel.classList.add("open"); panel.querySelector("input")?.focus(); return; }
  const log = h("div", { class: "sp-log", role: "log", "aria-live": "polite" });
  const say = (who, text) => { log.appendChild(h("div", { class: "sp-msg " + who }, text)); log.scrollTop = log.scrollHeight; };
  const input = h("input", { class: "input", maxlength: 300, placeholder: "Опишите проблему (мы всё равно ответим шаблоном)", "aria-label": "Сообщение в поддержку" });
  const form = h("form", { class: "sp-form" }, input, h("button", { class: "btn primary", type: "submit" }, "→"));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const t = input.value.trim(); if (!t) return;
    say("me", t); input.value = "";
    const typing = h("div", { class: "sp-msg bot typing" }, "Оператор печатает…"); log.appendChild(typing); log.scrollTop = log.scrollHeight;
    setTimeout(() => { typing.remove(); say("bot", reply(app, t)); sfx.ui(); }, 700 + Math.random() * 900);   // cosmetic delay
  });
  const quick = h("div", { class: "sp-quick" }, ["Где мой вывод?", "Вы подкручиваете?", "Позовите человека", "Какой у меня баланс?"].map((q) =>
    h("button", { class: "btn sm", type: "button", onclick: () => { input.value = q; form.requestSubmit(); } }, q)));
  panel = h("aside", { class: "sp-panel open", role: "dialog", "aria-label": "Поддержка" },
    h("header", {}, h("div", {}, h("b", {}, "Поддержка 24/7*"), h("small", {}, "*бот с заготовками, живых операторов нет")),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Закрыть", onclick: () => panel.classList.remove("open") }, icon("close"))),
    log, quick, form);
  document.body.appendChild(panel);
  say("bot", meme("support.greet"));
  input.focus();
}

export function supportButton(app) {
  return h("button", { class: "sp-fab", type: "button", "aria-label": "Поддержка", title: "Поддержка 24/7*", onclick: () => openSupport(app) }, icon("chat"));
}
