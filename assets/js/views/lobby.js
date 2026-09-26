import { rpc } from "../api.js?v=2.1.1";
import { h, clear, fmt, signed, toast, actionButton, dt } from "../ui.js?v=2.1.1";
import { meme, pick } from "../memes.js?v=2.1.1";
import { sfx } from "../sound.js?v=2.1.1";
import { GAMES } from "./game-kit.js?v=2.1.1";
import { jokeLine } from "./office.js?v=2.1.1";

const ART = {
  roulette: "🎡", blackjack: "🂡", businka_slots: "🐈", crash: "📈", dice: "🎲", mines: "💣", higher_lower: "⇅", plinko: "🔻", horse: "🐎",
};

function greeting(name) {
  const hr = new Date().getHours();
  const t = hr < 5 ? "Доброй ночи" : hr < 12 ? "Доброе утро" : hr < 18 ? "Добрый день" : "Добрый вечер";
  const tail = hr < 5 ? "Здоровый сон — единственная ставка с положительным ожиданием." : hr < 12 ? "Кофе ещё не допит, а решения уже принимаются." : hr < 18 ? "Рабочий день идёт. Ваш — тоже, судя по всему, здесь." : "Касса уже нервничает.";
  return [t + ", " + name + ".", tail];
}

export async function mount(root, { app }) {
  try { await app.refreshMe(); } catch { /* cached */ }
  const me = app.me;
  const stats = await rpc("rpc_my_stats", { p_period: "today" }).catch(() => null);
  const active = new Map((me.activeRounds || []).map((r) => [r.game, r]));

  // ---- wallet: daily help + rescue fund (both real, both server-side)
  const walletBox = h("div", { class: "stack" });
  function renderWallet() {
    const daily = me.daily || {}, rescue = me.rescue || null;
    clear(walletBox,
      h("div", { class: "lb-help" },
        h("div", {}, h("div", { class: "eyebrow" }, "Ежедневная финансовая помощь"), h("div", { class: "v gold num" }, "+" + fmt(daily.amount) + " ЛК")),
        daily.claimedToday ? h("span", { class: "badge" }, "Выдано. Завтра снова")
          : actionButton("Получить", async () => {
            try { const r = await rpc("rpc_claim_daily"); app.setBalance(r.balance); daily.claimedToday = true; sfx.cash(); toast(meme("daily"), "ok"); await app.refreshMe(); renderWallet(); }
            catch (e) { toast(e.message, "error"); if (e.code === "already_claimed") { daily.claimedToday = true; renderWallet(); } }
          }, { class: "btn primary" })),
      rescue ? h("div", { class: ["lb-help", "rescue", rescue.eligible ? "ready" : ""] },
        h("div", {}, h("div", { class: "eyebrow" }, "Фонд помощи пострадавшим от собственных решений"),
          h("div", { class: "v num" }, "+" + fmt(rescue.amount) + " ЛК"),
          h("small", { class: "muted" }, rescue.eligible ? "Баланс ниже " + fmt(rescue.threshold) + " ЛК — фонд готов помочь."
            : rescue.nextAt && new Date(rescue.nextAt) > new Date() ? "Следующая помощь после " + dt(rescue.nextAt) + "."
              : "Доступно, когда баланс ниже " + fmt(rescue.threshold) + " ЛК и нет незавершённых игр.")),
        rescue.eligible ? actionButton("Спасите", async () => {
          try { const r = await rpc("rpc_claim_rescue"); app.setBalance(r.balance); me.rescue = r.rescue; sfx.cash(); toast(meme("rescue.claimed", { win: r.amount }), "ok"); renderWallet(); }
          catch (e) { toast(e.message, "error"); if (e.extra?.rescue) { me.rescue = e.extra.rescue; renderWallet(); } }
        }, { class: "btn primary" }) : h("span", { class: "badge" }, "Держитесь")) : null);
  }
  renderWallet();

  const [hello, tail] = greeting(me.displayName || me.username);
  const [promoT, promoF] = pick("office.promo") || ["", ""];
  const net = stats ? stats.net : 0;

  root.append(h("div", { class: "container stack lobby" },
    h("section", { class: "lb-hero" },
      h("div", { class: "card gilded stack lb-welcome" },
        h("div", { class: "eyebrow" }, hello),
        h("h1", { class: "hero-title" }, "Контора, которая ", h("em", {}, "не подкручивает"), "."),
        h("p", { class: "muted" }, tail + " Каждый исход фиксируется хешем до ставки и проверяется после. Смеяться над вашими решениями — можем. Подкручивать — нет."),
        h("div", { class: "row wrap" },
          h("a", { class: "btn primary lg", href: "#/" + (GAMES.find((g) => active.has(g.slug))?.route || "roulette") }, active.size ? "Вернуться к игре" : "Играть"),
          h("a", { class: "btn ghost", href: "#/fairness" }, "Как проверить"),
          h("a", { class: "btn ghost", href: "#/office" }, "Контора"))),
      h("div", { class: "card stack lb-wallet" }, walletBox, h("hr", { class: "divider" }),
        h("div", { class: "kpis" },
          h("div", { class: "kpi" }, h("span", { class: "muted" }, "Раундов сегодня"), h("span", { class: "v num" }, fmt(stats?.rounds ?? 0))),
          h("div", { class: "kpi" }, h("span", { class: "muted" }, "Итог дня"), h("span", { class: ["v num", net > 0 ? "win" : net < 0 ? "loss" : ""] }, signed(net)))))),
    promoT ? h("a", { class: "lb-promo", href: "#/office/promo" }, h("b", {}, promoT), h("small", {}, promoF)) : null,
    h("section", { class: "stack", id: "games" },
      h("div", { class: "row" }, h("div", { class: "eyebrow" }, "Столы и аппараты · " + GAMES.length), h("div", { class: "spacer" }), h("a", { class: "small", href: "#/office/rules" }, "RTP всех игр →")),
      h("div", { class: "lb-games" }, GAMES.map((g) => h("a", { class: ["lb-tile", "g-" + g.slug], href: "#/" + g.route, "aria-label": g.name },
        h("span", { class: "lb-art", "aria-hidden": "true" }, ART[g.slug] || g.emoji),
        active.has(g.slug) ? h("span", { class: "badge ok lb-live" }, "игра не закончена") : null,
        h("h3", {}, g.name), h("p", { class: "muted" }, g.desc),
        h("div", { class: "meta" }, h("span", { class: "badge gold" }, "RTP " + g.tag)))))),
    h("section", { class: "lb-bottom" },
      h("div", { class: "stack" }, h("div", { class: "row" }, h("div", { class: "eyebrow" }, "Линия дня · ставки не принимаются"), h("div", { class: "spacer" }), h("a", { class: "small", href: "#/office/line" }, "вся линия →")), jokeLine(4)),
      h("div", { class: "card stack lb-memo" }, h("div", { class: "eyebrow" }, "Служебная записка № 67"),
        h("h3", {}, "Почему мы смеёмся, но не обманываем"),
        h("p", { class: "muted" }, "Настоящие конторы шутят в рекламе и серьёзны в выплатах. Мы наоборот: шутим везде, кроме математики. Сид, хеш, nonce и пересчёт в браузере — в разделе «Честность»."),
        h("a", { class: "btn sm", href: "#/fairness" }, "Проверить любой раунд")))));
}
