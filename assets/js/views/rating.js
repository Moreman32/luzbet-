import { rpc } from "../api.js";
import { h, fmt, signed } from "../ui.js";

const medals = ["🥇","🥈","🥉"];
function playerRow(p, i) {
  const rank = Number(p.balanceRank || i + 1);
  return h("div", { class: "rating-row" },
    h("div", { class: "rating-rank" }, medals[rank - 1] || "#" + rank),
    h("div", { class: "rating-person" },
      h("strong", {}, p.displayName || p.username),
      h("span", { class: "muted" }, p.title || "Квалифицированный инвестор в ЛК")),
    h("div", { class: "rating-stat" }, h("strong", { class: "num gold" }, fmt(p.balance)), h("small", {}, "ЛК на руках")),
    h("div", { class: "rating-stat hide-mobile" }, h("strong", { class: ["num", p.net > 0 ? "win" : p.net < 0 ? "loss" : ""] }, signed(p.net)), h("small", {}, "результат")),
    h("div", { class: "rating-stat hide-mobile" }, h("strong", { class: "num" }, fmt(p.wagered)), h("small", {}, "оборот"))
  );
}
export async function mount(root) {
  let period = "all";
  const body = h("div", { class: "rating-board card" });
  const note = h("p", { class: "muted rating-note" });
  async function load() {
    body.replaceChildren(h("p", { class: "muted" }, "Бухгалтерия пересчитывает чужие деньги…"));
    const r = await rpc("rpc_leaderboard", { p_period: period });
    const players = r.players || [];
    body.replaceChildren(...players.map(playerRow));
    const sponsor = [...players].sort((a,b) => a.net - b.net)[0];
    note.textContent = sponsor && sponsor.net < 0
      ? `Отдел благодарностей отдельно отмечает: ${sponsor.displayName || sponsor.username} сегодня особенно полезен экономике ЛузБета.`
      : "Пока никто не профинансировал заведение достаточно убедительно. Это поправимо.";
  }
  const seg = h("div", { class: "seg" });
  [["today","Сегодня"],["7d","7 дней"],["30d","30 дней"],["all","Всё время"]].forEach(([v,label]) => {
    const b=h("button",{type:"button",class:v===period?"on":null},label);
    b.onclick=()=>{period=v; [...seg.children].forEach(x=>x.classList.remove("on")); b.classList.add("on"); load();};
    seg.append(b);
  });
  root.append(h("div",{class:"container stack"},
    h("div",{class:"rating-head"},
      h("div",{},h("div",{class:"eyebrow"},"Отдел сравнительного унижения"),h("h1",{},"Рейтинг"),h("p",{class:"muted"},"Официальная таблица людей, которые решили превратить виртуальные ЛК в вопрос принципа."),h("div",{class:"meme-sticker"},"ФИНАНСОВЫЙ ДАРВИНИЗМ • LIVE")),
      seg),
    h("div",{class:"rating-legend muted"},"Место определяется балансом. При равенстве выше тот, кто убедительнее кормил оборот."),h("div",{class:"meme-ticker"},"⚠ ВНИМАНИЕ: верх таблицы не доказывает интеллект. Низ таблицы тоже, но там уже есть вопросы."),
    body,note,
    h("div",{class:"card tight rating-disclaimer"},h("strong",{},"Юридический отдел напоминает:")," рейтинг не является инвестиционной рекомендацией. Особенно последнее место.")
  ));
  await load();
}