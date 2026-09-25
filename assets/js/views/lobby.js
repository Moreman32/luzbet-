import { rpc } from "../api.js";
import { h, fmt, signed, toast, actionButton } from "../ui.js";
import { meme } from "../memes.js";
import { sfx } from "../sound.js";

function wheelArt() {
  const svg = h("svg:svg", { viewBox: "0 0 400 240", preserveAspectRatio: "xMaxYMid slice", class: "art" });
  const defs = h("svg:defs", {}, h("svg:radialGradient", { id: "wa", cx: "80%", cy: "40%", r: "70%" },
    h("svg:stop", { offset: "0", "stop-color": "#2a1b12" }), h("svg:stop", { offset: "1", "stop-color": "#0d0b09" })));
  svg.append(defs, h("svg:rect", { width: 400, height: 240, fill: "url(#wa)" }));
  const g = h("svg:g", { transform: "translate(320 110)" });
  for (let i = 0; i < 37; i++) {
    const a0 = (i / 37) * Math.PI * 2, a1 = ((i + 1) / 37) * Math.PI * 2, r = 120;
    g.appendChild(h("svg:path", {
      d: `M0 0 L${r * Math.cos(a0)} ${r * Math.sin(a0)} A${r} ${r} 0 0 1 ${r * Math.cos(a1)} ${r * Math.sin(a1)}Z`,
      fill: i === 0 ? "#0f7a47" : i % 2 ? "#8f1d27" : "#161412", opacity: ".85",
    }));
  }
  g.append(h("svg:circle", { r: 124, fill: "none", stroke: "#b8913f", "stroke-width": 4 }),
    h("svg:circle", { r: 60, fill: "#1a1612", stroke: "#b8913f", "stroke-width": 2 }),
    h("svg:circle", { r: 8, fill: "#e8cd8f" }));
  svg.appendChild(g);
  return svg;
}
function cardsArt() {
  const svg = h("svg:svg", { viewBox: "0 0 400 240", preserveAspectRatio: "xMaxYMid slice", class: "art" });
  svg.append(h("svg:defs", {}, h("svg:radialGradient", { id: "fa", cx: "75%", cy: "30%", r: "80%" },
    h("svg:stop", { offset: "0", "stop-color": "#135038" }), h("svg:stop", { offset: "1", "stop-color": "#07140f" }))),
  h("svg:rect", { width: 400, height: 240, fill: "url(#fa)" }));
  [[250, 40, -12, "A", "♠"], [300, 36, 8, "K", "♥"]].forEach(([x, y, rot, r, s]) => {
    const g = h("svg:g", { transform: `translate(${x} ${y}) rotate(${rot})` });
    g.append(h("svg:rect", { width: 92, height: 130, rx: 9, fill: "#f6efe0" }),
      h("svg:text", { x: 10, y: 28, "font-size": 24, "font-weight": 700, fill: s === "♥" ? "#b3232f" : "#141414", "font-family": "Georgia" }, r),
      h("svg:text", { x: 46, y: 84, "font-size": 44, "text-anchor": "middle", fill: s === "♥" ? "#b3232f" : "#141414" }, s));
    svg.appendChild(g);
  });
  return svg;
}

export async function mount(root, { app }) {
  const me = app.me;
  const [stats, games] = await Promise.all([rpc("rpc_my_stats", { p_period: "today" }).catch(() => null),
    (await import("../api.js")).sb.from("game_definitions").select("slug,name,status,sort_order").order("sort_order")]);

  const daily = me.daily || {};
  const dailyBox = h("div", { class: "stack" });
  function renderDaily(claimed) {
    dailyBox.replaceChildren(
      h("div", { class: "eyebrow" }, "Ежедневная финансовая помощь"),
      h("div", { class: "kpi" }, h("div", { class: "v gold" }, "+" + fmt(daily.amount), " ЛК")),
      claimed ? h("p", { class: "muted" }, "Выдано сегодня. Следующая — завтра по Никосии.")
        : actionButton("Получить", async () => {
          try {
            const r = await rpc("rpc_claim_daily");
            app.setBalance(r.balance); sfx.cash(); toast(meme("daily"), "ok"); renderDaily(true);
          } catch (e) { toast(e.message, "error"); if (e.code === "already_claimed") renderDaily(true); }
        }, { class: "btn primary" }));
  }
  renderDaily(!!daily.claimedToday);

  const tiles = [
    ["roulette", "Европейская рулетка", "Один ноль. 37 чисел. Никаких сюрпризов, кроме зеро.", wheelArt, "97,30% RTP"],
    ["blackjack", "Блэкджек", "6 колод, дилер стоит на 17, блэкджек платит 3:2.", cardsArt, "≈99,4% RTP при базовой стратегии"],
  ];
  const soon = (games.data || []).filter((g) => g.status !== "enabled").map((g) => h("span", { class: "soon" }, g.name));

  const net = stats ? stats.net : 0;
  root.append(h("div", { class: "container stack" },
    h("section", { class: "hero" },
      h("div", { class: "card gilded stack" },
        h("div", { class: "eyebrow" }, "Добрый вечер, " + (me.displayName || me.username)),
        h("h1", { class: "hero-title" }, "Казино, которое ", h("em", {}, "не подкручивает"), "."),
        h("p", { class: "muted", style: { maxWidth: "520px" } }, "Каждый исход фиксируется хешем до ставки и проверяется после. Смеяться над вами мы можем. Обманывать — нет."),
        h("div", { class: "row wrap", style: { marginTop: "22px" } },
          h("a", { class: "btn primary lg", href: "#/roulette" }, "Играть"),
          h("a", { class: "btn ghost", href: "#/fairness" }, "Как это проверить"))),
      h("div", { class: "card stack" },
        dailyBox,
        h("hr", { class: "divider" }),
        h("div", { class: "eyebrow" }, "Сегодня"),
        h("div", { class: "kpis" },
          h("div", { class: "kpi" }, h("span", { class: "muted" }, "Раунды"), h("span", { class: "v" }, fmt(stats?.rounds ?? 0))),
          h("div", { class: "kpi" }, h("span", { class: "muted" }, "Итог"), h("span", { class: ["v", net > 0 ? "win" : net < 0 ? "loss" : ""] }, signed(net)))))),
    h("section", { class: "stack", style: { marginTop: "32px" } },
      h("div", { class: "eyebrow" }, "Столы"),
      h("div", { class: "games" }, tiles.map(([slug, name, desc, art, tag]) =>
        h("a", { class: "game-tile", href: "#/" + slug, "aria-label": name }, art(),
          h("h3", {}, name), h("p", { class: "muted" }, desc), h("div", { class: "meta" }, h("span", { class: "badge gold" }, tag)))))),
    soon.length ? h("section", { class: "stack", style: { marginTop: "28px" } },
      h("div", { class: "eyebrow" }, "В разработке"), h("div", { class: "soon-list" }, soon),
      h("p", { class: "muted", style: { fontSize: "13px" } }, "Появятся, когда пройдут те же проверки честности, что рулетка и блэкджек. Не раньше.")) : null));
}
