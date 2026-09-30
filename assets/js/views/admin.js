import { rpc, admin } from "../api.js?v=2.3.1";
import { h, clear, fmt, signed, dt, toast, modal, drawer, actionButton, newKey } from "../ui.js?v=2.3.1";
import { mfaCard } from "./mfa.js?v=2.3.1";
import { roundSummary } from "./history.js?v=2.3.1";

const ROLE = { player: "Игрок", moderator: "Модератор", admin: "Админ", owner: "Владелец" };
const TX = { opening: "Стартовый баланс", bet: "Ставка", payout: "Выплата", refund: "Возврат", bonus: "Бонус", cashback: "Кэшбэк", jackpot: "Джекпот", achievement: "Достижение", admin_adjustment: "Корректировка" };

function genPassword() {
  const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = new Uint32Array(14); crypto.getRandomValues(b);
  return [...b].map((x) => abc[x % abc.length]).join("");
}

export async function mount(root, { app }) {
  const wrap = h("div", { class: "container stack" });
  root.appendChild(wrap);
  if (app.me.mfaRequired && app.me.aal !== "aal2") {
    wrap.append(h("div", { class: "game-head" }, h("h1", {}, "Бэк-офис")),
      h("div", { style: { maxWidth: "480px" } }, await mfaCard(async () => { await app.refreshMe(); app.route(); })));
    return;
  }
  let tab = "overview";
  const body = h("div", { class: "stack" });
  const tabs = h("div", { class: "seg" });
  const TABS = [["overview", "Обзор"], ["players", "Игроки"], ["line", "Линия"], ["audit", "Аудит"], ["security", "Безопасность"]];
  const drawTabs = () => clear(tabs, TABS.map(([k, l]) => h("button", { class: k === tab ? "on" : "", type: "button", onclick: () => { tab = k; drawTabs(); show(); } }, l)));
  drawTabs();
  wrap.append(h("div", { class: "game-head" }, h("div", {}, h("div", { class: "eyebrow" }, "Internal · " + ROLE[app.me.role]), h("h1", {}, "Бэк-офис")),
    h("div", { class: "spacer" }), tabs), body,
    h("p", { class: "muted", style: { fontSize: "12px" } }, "Бэк-офис не умеет выбирать исходы, карты, числа или победителей. Такой функции нет ни в интерфейсе, ни в базе."));

  async function show() {
    clear(body, h("p", { class: "muted" }, "Загрузка…"));
    try {
      if (tab === "overview") await overview();
      if (tab === "players") await players();
      if (tab === "line") await lineAdmin();
      if (tab === "audit") await audit();
      if (tab === "security") await security();
    } catch (e) { clear(body, h("div", { class: "card" }, h("p", { class: "loss" }, e.message))); }
  }

  async function lineAdmin() {
    const r = await rpc("rpc_admin_line_list");
    const title = h("input", { class: "input", maxlength: 140, placeholder: "Например: Придёт ли Вася на пятничную игру вовремя?" });
    const desc = h("textarea", { class: "input", rows: 2, maxlength: 600, placeholder: "Условия: что считается исходом, когда и как проверяем" });
    const opts = h("input", { class: "input", placeholder: "Исходы через точку с запятой: Да; Нет" , value: "Да; Нет" });
    const d = new Date(Date.now() + 24 * 3600e3); d.setMinutes(0, 0, 0);
    const pad = (n) => String(n).padStart(2, "0");
    const closes = h("input", { class: "input", type: "datetime-local", value: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00` });
    const reason = h("input", { class: "input", placeholder: "Причина для аудита (например: пятничная игра)" });
    const create = actionButton("Создать событие", async () => {
      const options = opts.value.split(";").map((x) => x.trim()).filter(Boolean);
      try {
        await rpc("rpc_admin_line_create", { p_title: title.value, p_description: desc.value || null, p_options: options,
          p_closes_at: new Date(closes.value).toISOString(), p_reason: reason.value });
        toast("Событие создано и появилось в линии.", "ok"); show();
      } catch (e) { toast(e.message, "error"); }
    }, { class: "btn primary" });
    const settleBox = (e) => {
      if (e.status !== "open") return h("p", { class: "muted small" }, (e.status === "void" ? "Возврат: " : "Итог: ") + (e.resultNote || "") + (e.settledBy ? " · " + e.settledBy : ""));
      const note = h("input", { class: "input sm", placeholder: "Комментарий к итогу (виден всем)", style: { width: "100%" } });
      const closed = Date.parse(e.closesAt) <= Date.now();
      return h("div", { class: "stack" }, note, h("div", { class: "row wrap" },
        closed ? e.options.map((o) => actionButton("Победил: " + o.label, async () => {
          if (!confirm(`Рассчитать «${e.title}» с исходом «${o.label}»? Это необратимо: деньги сразу уйдут выигравшим.`)) return;
          try { await rpc("rpc_admin_line_settle", { p_event: e.id, p_result: o.idx, p_note: note.value }); toast("Рассчитано.", "ok"); show(); } catch (x) { toast(x.message, "error"); }
        }, { class: "btn sm primary" })) : h("span", { class: "muted small" }, "Рассчитать можно после " + dt(e.closesAt)),
        actionButton("Отменить с возвратом", async () => {
          if (!confirm("Отменить событие и вернуть все ставки?")) return;
          try { await rpc("rpc_admin_line_settle", { p_event: e.id, p_result: null, p_note: note.value }); toast("Ставки возвращены.", "ok"); show(); } catch (x) { toast(x.message, "error"); }
        }, { class: "btn sm danger" })));
    };
    clear(body,
      h("div", { class: "card stack" }, h("div", { class: "eyebrow" }, "Новое событие в линии"),
        h("div", { class: "field" }, h("label", {}, "Вопрос"), title), h("div", { class: "field" }, h("label", {}, "Условия"), desc),
        h("div", { class: "field" }, h("label", {}, "Исходы (2–8)"), opts), h("div", { class: "field" }, h("label", {}, "Приём ставок до"), closes),
        h("div", { class: "field" }, h("label", {}, "Причина"), reason), create,
        h("p", { class: "muted small" }, "Правила честности: вы не можете ставить на свои события; рассчитать может создатель или владелец; каждое действие попадает в аудит, а имя рассчитавшего видно всем игрокам.")),
      (r.events || []).length ? r.events.map((e) => h("div", { class: "card stack" },
        h("div", { class: "row" }, h("b", {}, e.title), h("div", { class: "spacer" }), h("span", { class: "badge" }, e.status === "open" ? (Date.parse(e.closesAt) > Date.now() ? "приём ставок" : "ждёт расчёта") : e.status)),
        h("div", { class: "muted small" }, `Банк ${fmt(e.total)} ЛК · ` + e.options.map((o) => `${o.label}: ${fmt(o.pool)}`).join(" · ") + ` · закрытие ${dt(e.closesAt)}`),
        settleBox(e))) : h("p", { class: "muted" }, "Своих событий пока нет. Автособытия по статистике сайта создаются и рассчитываются сами."));
  }

  async function overview() {
    const o = await rpc("rpc_admin_overview");
    const k = (l, v, cls) => h("div", { class: "kpi card tight" }, h("span", { class: "muted" }, l), h("span", { class: ["v", cls] }, v));
    clear(body, h("div", { class: "kpis" }, k("Игроков", fmt(o.players)), k("Активны 7 дней", fmt(o.activePlayers7d)), k("ЛК на руках", fmt(o.totalBalance)),
      k("Раундов за 24ч", fmt(o.rounds24h)), k("Результат казино", signed(o.casinoNet), o.casinoNet >= 0 ? "win" : "loss"), k("Событий безопасности 24ч", fmt(o.securityEvents24h))),
    h("div", { class: "card", style: { padding: 0 } }, h("div", { class: "table-wrap" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {}, h("th", {}, "Игра"), h("th", { class: "r" }, "Раунды"), h("th", { class: "r" }, "Поставлено"), h("th", { class: "r" }, "Выплачено"), h("th", { class: "r" }, "Наблюдаемый RTP"))),
      h("tbody", {}, Object.entries(o.byGame || {}).map(([g, v]) => h("tr", {}, h("td", {}, g), h("td", { class: "r num" }, fmt(v.rounds)),
        h("td", { class: "r num" }, fmt(v.wagered)), h("td", { class: "r num" }, fmt(v.paid)), h("td", { class: "r num" }, v.observedRtp === null ? "—" : v.observedRtp + "%"))))))));
  }

  async function players() {
    const list = await rpc("rpc_admin_players");
    const createBtn = h("button", { class: "btn primary", type: "button", onclick: () => createDialog() }, "Создать игрока");
    clear(body, h("div", { class: "row" }, h("span", { class: "muted" }, fmt(list.length) + " игроков"), h("div", { class: "spacer" }), createBtn),
      h("div", { class: "card", style: { padding: 0 } }, h("div", { class: "table-wrap" }, h("table", { class: "table" },
        h("thead", {}, h("tr", {}, h("th", {}, "Игрок"), h("th", {}, "Роль"), h("th", {}, "Статус"), h("th", { class: "r" }, "Баланс"), h("th", { class: "r" }, "Итог игр"), h("th", {}, "Был"))),
        h("tbody", {}, list.map((p) => h("tr", { class: "click", tabindex: 0, onclick: () => playerDrawer(p), onkeydown: (e) => e.key === "Enter" && playerDrawer(p) },
          h("td", {}, h("div", {}, p.displayName), h("div", { class: "muted", style: { fontSize: "12px" } }, "@" + p.username)),
          h("td", {}, ROLE[p.role]), h("td", {}, h("span", { class: ["badge", p.status === "active" ? "ok" : "bad"] }, p.status === "active" ? "Активен" : "Отключён")),
          h("td", { class: "r num" }, fmt(p.balance)), h("td", { class: ["r num", p.net > 0 ? "win" : p.net < 0 ? "loss" : ""] }, signed(p.net)),
          h("td", { class: "muted" }, p.lastSeenAt ? dt(p.lastSeenAt) : "—"))))))));
  }

  function createDialog() {
    const u = h("input", { class: "input", maxlength: 24, autocapitalize: "none", placeholder: "латиница, цифры, _" });
    const n = h("input", { class: "input", maxlength: 32 });
    const p = h("input", { class: "input mono", value: genPassword(), maxlength: 72 });
    const err = h("p", { class: "form-error" });
    const m = modal(h("div", { class: "stack" }, h("h3", {}, "Новый игрок"),
      h("div", { class: "field" }, h("label", {}, "Логин"), u), h("div", { class: "field" }, h("label", {}, "Имя"), n),
      h("div", { class: "field" }, h("label", {}, "Временный пароль"), p),
      h("p", { class: "muted", style: { fontSize: "13px" } }, "Стартовый баланс — 1 000 ЛК. При первом входе игрок сменит пароль."), err,
      actionButton("Создать", async () => {
        err.textContent = "";
        try {
          const r = await admin("create_player", { username: u.value.trim().toLowerCase(), displayName: n.value.trim(), password: p.value });
          m.close();
          modal(h("div", { class: "stack" }, h("h3", {}, "Игрок создан"), h("p", {}, "Передайте данные лично:"),
            h("pre", { class: "code" }, `Сайт: https://luzbet.lol\nЛогин: ${r.username}\nПароль: ${p.value}`)));
          show();
        } catch (e) { err.textContent = e.message; }
      }, { class: "btn primary block" })));
  }

  async function playerDrawer(p) {
    const d = await rpc("rpc_admin_player_detail", { p_user: p.id });
    const amount = h("input", { class: "input num", type: "number", step: 1, placeholder: "например 500 или -200" });
    const reason = h("input", { class: "input", maxlength: 200, placeholder: "причина (обязательно)" });
    const statusReason = h("input", { class: "input", maxlength: 200, placeholder: "причина" });
    const roleSel = h("select", { class: "input" }, ["player", "moderator", "admin"].map((r) => h("option", { value: r, selected: r === p.role }, ROLE[r])));
    let dr;
    const adjustKey = newKey("adj");
    dr = drawer(h("div", { class: "stack" },
      h("div", { class: "eyebrow" }, ROLE[p.role] + " · @" + p.username), h("h2", {}, p.displayName),
      h("div", { class: "kpis" },
        h("div", { class: "kpi" }, h("span", { class: "muted" }, "Баланс"), h("span", { class: "v" }, fmt(p.balance))),
        h("div", { class: "kpi" }, h("span", { class: "muted" }, "Раундов"), h("span", { class: "v" }, fmt(p.rounds))),
        h("div", { class: "kpi" }, h("span", { class: "muted" }, "Итог игр"), h("span", { class: ["v", p.net >= 0 ? "win" : "loss"] }, signed(p.net)))),
      h("div", { class: "card stack" }, h("div", { class: "eyebrow" }, "Корректировка баланса"),
        h("div", { class: "row" }, amount, reason),
        actionButton("Провести через ledger", async () => {
          const a = Number(amount.value);
          if (!Number.isSafeInteger(a) || a === 0) return toast("Введите целую сумму.", "error");
          try {
            const r = await rpc("rpc_admin_adjust_balance", { p_user: p.id, p_amount: a, p_reason: reason.value, p_idempotency_key: adjustKey });
            toast(r.replayed ? "Эта корректировка уже проведена." : `Проведено. Новый баланс: ${fmt(r.balance)} ЛК`, "ok");
            dr.close(); show();
          } catch (e) { toast(e.message, "error"); }
        }, { class: "btn primary" })),
      h("div", { class: "card stack" }, h("div", { class: "eyebrow" }, "Доступ"),
        h("div", { class: "row wrap" },
          actionButton("Выдать временный пароль", async () => {
            const pw = genPassword();
            try { await admin("set_password", { userId: p.id, password: pw }); modal(h("div", { class: "stack" }, h("h3", {}, "Новый временный пароль"), h("pre", { class: "code" }, `Логин: ${p.username}\nПароль: ${pw}`))); }
            catch (e) { toast(e.message, "error"); }
          }),
          statusReason,
          actionButton(p.status === "active" ? "Отключить" : "Включить", async () => {
            try { await admin("set_status", { userId: p.id, status: p.status === "active" ? "disabled" : "active", reason: statusReason.value }); toast("Статус изменён.", "ok"); dr.close(); show(); }
            catch (e) { toast(e.message, "error"); }
          }, { class: "btn danger" })),
        app.me.role === "owner" ? h("div", { class: "row" }, roleSel, actionButton("Сменить роль", async () => {
          try { await rpc("rpc_admin_set_role", { p_user: p.id, p_role: roleSel.value, p_reason: "role change" }); toast("Роль изменена.", "ok"); dr.close(); show(); }
          catch (e) { toast(e.message, "error"); }
        })) : null),
      h("div", { class: "eyebrow" }, "Ledger (последние 100)"),
      h("div", { class: "table-wrap" }, h("table", { class: "table" }, h("tbody", {}, d.ledger.map((t) => h("tr", {},
        h("td", { class: "muted" }, dt(t.created_at)), h("td", {}, TX[t.type] || t.type, t.metadata?.reason ? h("div", { class: "muted", style: { fontSize: "12px" } }, t.metadata.reason) : null),
        h("td", { class: ["r num", t.amount > 0 ? "win" : "loss"] }, signed(t.amount)), h("td", { class: "r num muted" }, fmt(t.balance_after))))))),
      h("div", { class: "eyebrow" }, "Раунды (последние 50)"),
      h("div", { class: "table-wrap" }, h("table", { class: "table" }, h("tbody", {}, d.rounds.map((r) => h("tr", {},
        h("td", { class: "muted" }, dt(r.createdAt)), h("td", {}, r.game), h("td", { class: "muted" }, roundSummary(r)),
        h("td", { class: "r num" }, fmt(r.bet)), h("td", { class: ["r num", r.payout - r.bet > 0 ? "win" : "loss"] }, signed(r.payout - r.bet)))))))));
  }

  async function audit() {
    const list = await rpc("rpc_admin_audit", { p_limit: 200 });
    clear(body, h("div", { class: "card", style: { padding: 0 } }, h("div", { class: "table-wrap" }, h("table", { class: "table" },
      h("thead", {}, h("tr", {}, h("th", {}, "Когда"), h("th", {}, "Кто"), h("th", {}, "Действие"), h("th", {}, "Цель"), h("th", {}, "До → после"), h("th", {}, "Причина"))),
      h("tbody", {}, list.map((a) => h("tr", {}, h("td", { class: "muted" }, dt(a.created_at)), h("td", {}, a.actor || "система"), h("td", {}, a.action),
        h("td", {}, a.target || a.entity_id || ""), h("td", { class: "mono" }, `${a.before ? JSON.stringify(a.before) : "—"} → ${a.after ? JSON.stringify(a.after) : "—"}`),
        h("td", {}, a.reason || ""))))))));
  }

  async function security() {
    const list = await rpc("rpc_admin_security_events", { p_limit: 200 });
    clear(body, h("p", { class: "muted", style: { fontSize: "13px" } }, "Автокликер — не преступление. Здесь видно, что он пытался сделать и почему у него не вышло."),
      h("div", { class: "card", style: { padding: 0 } }, h("div", { class: "table-wrap" }, h("table", { class: "table" },
        h("thead", {}, h("tr", {}, h("th", {}, "Когда"), h("th", {}, "Событие"), h("th", {}, "Игрок"), h("th", {}, "IP"), h("th", {}, "Детали"))),
        h("tbody", {}, list.map((e) => h("tr", {}, h("td", { class: "muted" }, dt(e.created_at)),
          h("td", {}, h("span", { class: ["badge", e.severity === "warn" ? "bad" : ""] }, e.event_type)), h("td", {}, e.username || "—"),
          h("td", { class: "mono" }, e.ip || "—"), h("td", { class: "mono" }, JSON.stringify(e.metadata)))))))));
  }
  show();
}
