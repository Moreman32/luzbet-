import { sb, rpc } from "../api.js";
import { h, clear, fmt, signed, dt, drawer } from "../ui.js";
import { meme } from "../memes.js";
import { cardLabel } from "./shared.js";

const GAME = { roulette: "Рулетка", blackjack: "Блэкджек" };
const PERIODS = [["today", "Сегодня"], ["7d", "7 дней"], ["30d", "30 дней"], ["all", "Всё время"]];

export function roundSummary(r) {
  const st = r.state || {};
  if (r.game_slug === "roulette" || r.game === "roulette") return st.number !== undefined ? `Выпало ${st.number}` : "—";
  if (st.hands) return st.hands.map((x) => x.cards.map(cardLabel).join(" ") + ` (${x.total})`).join(" | ") + (st.phase === "FINISHED" ? ` vs ${st.dealerTotal}` : " · в игре");
  return "—";
}

export async function mount(root) {
  let game = "all", period = "all", page = 0;
  const PAGE = 40;
  const statsEl = h("div", { class: "kpis" });
  const body = h("tbody");
  const more = h("button", { class: "btn block", type: "button", onclick: () => load(false) }, "Показать ещё");

  async function loadStats() {
    const s = await rpc("rpc_my_stats", { p_period: period });
    clear(statsEl,
      [["Раунды", fmt(s.rounds)], ["Поставлено", fmt(s.wagered)], ["Выплачено", fmt(s.won)],
        ["Итог", signed(s.net), s.net > 0 ? "win" : s.net < 0 ? "loss" : ""],
        ["Наблюдаемый RTP", s.observedRtp === null ? "—" : s.observedRtp + "%"], ["Доля выигрышей", s.winRate === null ? "—" : s.winRate + "%"],
        ["Лучший выигрыш", fmt(s.biggestWin)], ["Макс. множитель", s.biggestMultiplier ? "×" + s.biggestMultiplier : "—"]]
        .map(([k, v, cls]) => h("div", { class: "kpi card tight" }, h("span", { class: "muted" }, k), h("span", { class: ["v", cls] }, v))));
    if (s.net < 0 && s.rounds > 20) statsEl.appendChild(h("p", { class: "meme-line", style: { gridColumn: "1 / -1" } }, "Стратегия требует дополнительного финансирования."));
  }

  async function load(reset = true) {
    if (reset) { page = 0; clear(body); }
    let q = sb.from("casino_rounds").select("id,game_slug,status,bet_total,payout,created_at,state,nonce").order("created_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (game !== "all") q = q.eq("game_slug", game);
    const { data, error } = await q;
    if (error) { body.appendChild(h("tr", {}, h("td", { colspan: 5 }, "Не удалось загрузить историю."))); return; }
    if (reset && !data.length) body.appendChild(h("tr", {}, h("td", { colspan: 5, class: "muted" }, meme("history.empty"))));
    for (const r of data) {
      const net = r.payout - r.bet_total;
      body.appendChild(h("tr", { class: "click", tabindex: 0, onclick: () => details(r.id), onkeydown: (e) => e.key === "Enter" && details(r.id) },
        h("td", {}, dt(r.created_at)), h("td", {}, GAME[r.game_slug] || r.game_slug),
        h("td", { class: "muted" }, roundSummary(r)),
        h("td", { class: "r num" }, fmt(r.bet_total)),
        h("td", { class: ["r num", r.status !== "finished" ? "" : net > 0 ? "win" : net < 0 ? "loss" : ""] }, r.status === "finished" ? signed(net) : "в игре")));
    }
    more.classList.toggle("hidden", data.length < PAGE);
    page++;
  }

  const seg = (items, cur, on) => {
    const el = h("div", { class: "seg" });
    const draw = (v) => clear(el, items.map(([k, l]) => h("button", { class: k === v ? "on" : "", type: "button", onclick: () => { draw(k); on(k); } }, l)));
    draw(cur); return el;
  };
  root.append(h("div", { class: "container stack" },
    h("div", { class: "game-head" }, h("h1", {}, "История")),
    h("div", { class: "row wrap" }, seg(PERIODS, period, (v) => { period = v; loadStats(); }), h("div", { class: "spacer" }),
      seg([["all", "Все игры"], ["roulette", "Рулетка"], ["blackjack", "Блэкджек"]], game, (v) => { game = v; load(); })),
    statsEl,
    h("p", { class: "muted", style: { fontSize: "13px" } }, "Наблюдаемый RTP — это история, а не прогноз. Следующий раунд о ней ничего не знает."),
    h("div", { class: "card", style: { padding: 0 } }, h("div", { class: "table-wrap" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {}, h("th", {}, "Время"), h("th", {}, "Игра"), h("th", {}, "Исход"), h("th", { class: "r" }, "Ставка"), h("th", { class: "r" }, "Итог"))), body))),
    more));
  await Promise.all([loadStats(), load()]);
}

export async function details(id) {
  const [{ data: r }, { data: actions }] = await Promise.all([
    sb.from("casino_rounds").select("*").eq("id", id).single(),
    sb.from("casino_actions").select("seq,action,created_at").eq("round_id", id).order("seq")]);
  if (!r) return;
  const net = r.payout - r.bet_total;
  const lines = r.game_slug === "roulette" ? (r.state.lines || []).map((l) => h("div", { class: "l" },
    h("span", {}, `${l.t} ${(l.n.length <= 6 ? l.n.join("·") : l.n.length + " чисел")}`), h("span", { class: "num" }, `${fmt(l.a)} → ${fmt(l.win)}`))) : [];
  drawer(h("div", { class: "stack" },
    h("div", { class: "eyebrow" }, (GAME[r.game_slug] || r.game_slug) + " · " + dt(r.created_at)),
    h("h2", {}, r.status === "finished" ? signed(net) + " ЛК" : "Раунд в игре"),
    h("dl", { class: "kv" },
      h("dt", {}, "Исход"), h("dd", {}, roundSummary(r)),
      h("dt", {}, "Ставка / выплата"), h("dd", { class: "num" }, `${fmt(r.bet_total)} / ${fmt(r.payout)}`),
      h("dt", {}, "Правила"), h("dd", { class: "mono" }, r.rule_version_id),
      h("dt", {}, "Хеш сида"), h("dd", { class: "mono" }, r.server_seed_hash),
      h("dt", {}, "Client seed"), h("dd", { class: "mono" }, r.client_seed),
      h("dt", {}, "Nonce"), h("dd", { class: "mono" }, String(r.nonce)),
      h("dt", {}, "Действия"), h("dd", {}, (actions || []).map((a) => a.action).join(" → ") || "—"),
      h("dt", {}, "ID раунда"), h("dd", { class: "mono" }, r.id)),
    lines.length ? h("div", { class: "bet-lines" }, lines) : null,
    r.status === "finished" ? h("a", { class: "btn primary block", href: "#/fairness/verify?round=" + r.id }, "Проверить раунд") : null));
}
