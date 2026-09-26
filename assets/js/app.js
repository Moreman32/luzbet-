import { sb, rpc, login, logout, ApiError } from "./api.js?v=2.1.1";
import { h, clear, icon, fmt, toast, modal, actionButton } from "./ui.js?v=2.1.1";
import { meme, lines } from "./memes.js?v=2.1.1";
import { supportButton } from "./support.js?v=2.1.1";
import { switcher } from "./views/game-kit.js?v=2.1.1";
import { sfx } from "./sound.js?v=2.1.1";

const VIEWS = {
  lobby: () => import("./views/lobby.js?v=2.1.1"),
  roulette: () => import("./views/roulette.js?v=2.1.1"),
  blackjack: () => import("./views/blackjack.js?v=2.1.1"),
  slots: () => import("./views/slots.js?v=2.1.1"),
  crash: () => import("./views/crash.js?v=2.1.1"),
  dice: () => import("./views/dice.js?v=2.1.1"),
  mines: () => import("./views/mines.js?v=2.1.1"),
  higher_lower: () => import("./views/higher-lower.js?v=2.1.1"),
  plinko: () => import("./views/plinko.js?v=2.1.1"),
  horse: () => import("./views/horse.js?v=2.1.1"),
  rating: () => import("./views/rating.js?v=2.1.1"),
  office: () => import("./views/office.js?v=2.1.1"),
  history: () => import("./views/history.js?v=2.1.1"),
  fairness: () => import("./views/fairness.js?v=2.1.1"),
  profile: () => import("./views/profile.js?v=2.1.1"),
  admin: () => import("./views/admin.js?v=2.1.1"),
};
const ALIAS = { showroom: "office", games: "lobby", hilo: "higher_lower", businka: "slots", businka_slots: "slots" };
const GAME_ROUTES = new Set(["roulette", "blackjack", "slots", "crash", "dice", "mines", "higher_lower", "plinko", "horse"]);
const NAV = [["lobby", "Игры"], ["rating", "Рейтинг"], ["history", "История"], ["fairness", "Честность"], ["office", "Контора"]];

export const app = {
  me: null,
  root: document.getElementById("app"),
  cleanup: null,
  balanceEl: null,

  setBalance(v) {
    if (!this.me || v === undefined || v === null) return;
    const changed = this.me.balance !== v;
    this.me.balance = v;
    if (this.balanceEl) {
      this.balanceEl.querySelector(".v").textContent = fmt(v);
      if (changed) { this.balanceEl.classList.remove("bump"); void this.balanceEl.offsetWidth; this.balanceEl.classList.add("bump"); }
    }
  },
  async refreshMe() {
    this.me = await rpc("rpc_me");
    this.setBalance(this.me.balance);
    return this.me;
  },
  go(path) { if (location.hash !== "#/" + path) location.hash = "#/" + path; else this.route(); },
  route() { route(); },
};
window.addEventListener("lb:auth-lost", () => { app.me = null; renderLogin(); });

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "") || "lobby";
  const [path, q = ""] = raw.split("?");
  const parts = path.split("/");
  return { view: parts[0] || "lobby", sub: parts[1] || null, params: new URLSearchParams(q) };
}

function shell(active) {
  const bal = h("div", { class: "balance-pill", title: "Баланс" }, h("span", { class: "v num" }, fmt(app.me.balance)), h("span", { class: "c" }, "ЛК"));
  app.balanceEl = bal;
  const cur = GAME_ROUTES.has(active) ? "lobby" : active;
  const nav = NAV.map(([k, label]) => h("a", { href: "#/" + k, class: cur === k ? "active" : null }, label));
  if (["admin", "owner"].includes(app.me.role)) nav.push(h("a", { href: "#/admin", class: active === "admin" ? "active" : null }, "Бэк-офис"));
  const initials = (app.me.displayName || app.me.username || "?").trim().slice(0, 1).toUpperCase();
  const header = h("header", { class: "hdr" }, h("div", { class: "container" },
    h("a", { class: "logo", href: "#/lobby", "aria-label": "LuzBet" }, "ЛУЗ", h("b", {}, "БЕТ"), h("small", {}, "2.0")),
    h("nav", { class: "nav", "aria-label": "Главное меню" }, nav),
    h("div", { class: "spacer" }),
    bal,
    h("a", { class: "avatar-btn", href: "#/profile", title: "Профиль", "aria-label": "Профиль" }, initials)));
  const tabs = [["lobby","Игры","grid"],["rating","Рейтинг","trophy"],["office","Контора","office"],["history","История","history"],["profile","Профиль","user"]].map(([k, label, ic]) =>
    h("a", { href: "#/" + k, class: cur === k ? "active" : null }, icon(ic), label));
  const main = h("main", { class: "page", id: "main" });
  const tick = lines("office.ticker").sort(() => Math.random() - 0.5).slice(0, 12);   // cosmetic order only
  const ticker = h("div", { class: "ticker", "aria-hidden": "true" }, h("div", { class: "ticker-track" }, [...tick, ...tick].map((t) => h("span", {}, t))));
  clear(app.root, header, ticker, main, h("nav", { class: "tabbar", "aria-label": "Меню" }, tabs), supportButton(app));
  return main;
}

let routeSeq = 0;
async function route() {
  if (!app.me) return renderLogin();
  const { view: rawView, sub, params } = parseHash();
  const view = ALIAS[rawView] || rawView;
  const key = VIEWS[view] ? view : "lobby";
  if (key === "admin" && !["admin", "owner"].includes(app.me.role)) return app.go("lobby");
  const seq = ++routeSeq;
  if (app.cleanup) { try { app.cleanup(); } catch { /* ignore */ } app.cleanup = null; }
  const main = shell(key);
  main.appendChild(h("div", { class: "container muted" }, "Загрузка…"));
  try {
    const mod = await VIEWS[key]();
    if (seq !== routeSeq) return;
    clear(main);
    app.cleanup = (await mod.mount(main, { app, sub, params })) || null;
    if (GAME_ROUTES.has(key) && !main.querySelector(".game-switch") && main.firstElementChild) main.firstElementChild.prepend(switcher(key));
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    clear(main, h("div", { class: "container" }, h("div", { class: "card" }, h("h3", {}, "Не удалось открыть раздел"),
      h("p", { class: "muted" }, e instanceof ApiError ? e.message : meme("error")))));
  }
}

function renderLogin() {
  if (app.cleanup) { try { app.cleanup(); } catch { /* ignore */ } app.cleanup = null; }
  const u = h("input", { class: "input", id: "lg-user", autocomplete: "username", autocapitalize: "none", spellcheck: "false", required: true, maxlength: 24 });
  const p = h("input", { class: "input", id: "lg-pass", type: "password", autocomplete: "current-password", required: true, maxlength: 128 });
  const err = h("p", { class: "form-error", role: "alert" });
  const btn = h("button", { class: "btn primary lg block", type: "submit" }, "Войти");
  const form = h("form", { class: "stack", novalidate: true },
    h("div", { class: "field" }, h("label", { for: "lg-user" }, "Логин"), u),
    h("div", { class: "field" }, h("label", { for: "lg-pass" }, "Пароль"), p), err, btn);
  let busy = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    err.textContent = "";
    if (!u.value.trim() || !p.value) { err.textContent = "Введите логин и пароль."; return; }
    busy = true; btn.disabled = true; btn.replaceChildren(h("span", { class: "spin" }));
    try {
      await login(u.value.trim().toLowerCase(), p.value);
      await boot(true);
    } catch (ex) {
      err.textContent = ex.message; sfx.error();
    } finally { busy = false; btn.disabled = false; btn.replaceChildren("Войти"); }
  });
  clear(app.root, h("div", { class: "auth-wrap" }, h("div", { class: "auth-card" },
    h("div", { class: "brand-big" }, "ЛУЗ", h("b", {}, "БЕТ")),
    h("div", { class: "card gilded stack" },
      h("h1", {}, "Вход"),
      h("p", { class: "muted" }, "Закрытый клуб. Виртуальные ЛК, настоящая математика."),
      form),
    h("p", { class: "muted", style: { textAlign: "center", marginTop: "18px", fontSize: "13px" } },
      "Аккаунты выдаёт администрация. Реальных денег здесь нет и не будет."))));
  u.focus();
}

export function passwordChangeDialog({ forced = false } = {}) {
  const p1 = h("input", { class: "input", type: "password", autocomplete: "new-password", maxlength: 72 });
  const p2 = h("input", { class: "input", type: "password", autocomplete: "new-password", maxlength: 72 });
  const err = h("p", { class: "form-error" });
  let m;
  const save = actionButton("Сохранить пароль", async () => {
    err.textContent = "";
    if (p1.value.length < 8 || p1.value.length > 72) { err.textContent = "Пароль: от 8 до 72 символов."; return; }
    if (p1.value !== p2.value) { err.textContent = "Пароли не совпадают."; return; }
    const { error } = await sb.auth.updateUser({ password: p1.value });
    if (error) { err.textContent = /reauth|nonce/i.test(error.message) ? "Нужно перезайти и повторить." : "Не удалось сменить пароль."; return; }
    await rpc("rpc_mark_password_changed");
    app.me.mustChangePassword = false;
    toast("Пароль обновлён.", "ok");
    m.close();
  }, { class: "btn primary block" });
  m = modal(h("div", { class: "stack" },
    h("h3", {}, forced ? "Смените временный пароль" : "Смена пароля"),
    forced ? h("p", { class: "muted" }, "Этот пароль вам выдали. Придумайте свой — так спокойнее всем, включая отдел безопасности.") : null,
    h("div", { class: "field" }, h("label", {}, "Новый пароль"), p1),
    h("div", { class: "field" }, h("label", {}, "Ещё раз"), p2), err, save));
  return m;
}

async function boot(fresh = false) {
  const { data } = await sb.auth.getSession();
  if (!data.session) { app.me = null; return renderLogin(); }
  try {
    await app.refreshMe();
  } catch (e) {
    if (e instanceof ApiError && ["not_authenticated", "account_disabled", "no_profile"].includes(e.code)) {
      await logout("local"); app.me = null; renderLogin();
      if (e.code === "account_disabled") toast("Аккаунт отключён администрацией.", "error");
      return;
    }
    clear(app.root, h("div", { class: "auth-wrap" }, h("div", { class: "card stack" }, h("h3", {}, "Касса не отвечает"),
      h("p", { class: "muted" }, e.message), h("button", { class: "btn", onclick: () => boot() }, "Повторить"))));
    return;
  }
  route();
  if (fresh) toast(meme("welcome"));
  if (app.me.mustChangePassword) passwordChangeDialog({ forced: true });
}

sb.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") { app.me = null; renderLogin(); }
});
window.addEventListener("hashchange", () => route());
boot();
