import { rpc, logout } from "../api.js";
import { h, clear, fmt, toast, actionButton } from "../ui.js";
import { soundSettings, sfx } from "../sound.js";
import { passwordChangeDialog } from "../app.js";
import { mfaCard, mfaStatus } from "./mfa.js";

const ROLE = { player: "Игрок", moderator: "Модератор", admin: "Администратор", owner: "Владелец" };

export async function mount(root, { app }) {
  await app.refreshMe();
  const me = app.me;
  const nameIn = h("input", { class: "input", value: me.displayName, maxlength: 32 });
  const snd = soundSettings.get();
  const mute = h("input", { type: "checkbox", checked: snd.muted, id: "mute" });
  const vol = h("input", { type: "range", min: 0, max: 1, step: 0.05, value: snd.volume, "aria-label": "Громкость", style: { width: "100%" } });
  mute.addEventListener("change", () => { soundSettings.setMuted(mute.checked); if (!mute.checked) sfx.ui(); });
  vol.addEventListener("change", () => { soundSettings.setVolume(Number(vol.value)); sfx.win(); });

  const mfaBox = h("div");
  const st = await mfaStatus().catch(() => null);
  if (st && st.verified.length) {
    mfaBox.appendChild(h("div", { class: "card stack" }, h("div", { class: "eyebrow" }, "Двухфакторная защита"),
      h("p", {}, h("span", { class: "badge ok" }, "Включена"), " ", h("span", { class: "muted" }, st.current === "aal2" ? "Текущая сессия подтверждена." : "Текущая сессия ещё не подтверждена кодом."))));
  } else {
    mfaBox.appendChild(await mfaCard(() => app.route()));
  }

  root.append(h("div", { class: "container stack" },
    h("div", { class: "game-head" }, h("div", {}, h("div", { class: "eyebrow" }, ROLE[me.role] || me.role), h("h1", {}, me.displayName)),
      h("div", { class: "spacer" }), h("span", { class: "badge gold" }, "@" + me.username)),
    h("div", { class: "grid", style: { gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" } },
      h("div", { class: "card stack" },
        h("div", { class: "eyebrow" }, "Профиль"),
        h("div", { class: "field" }, h("label", {}, "Отображаемое имя"), nameIn),
        actionButton("Сохранить имя", async () => {
          try { const r = await rpc("rpc_set_display_name", { p_name: nameIn.value }); me.displayName = r.displayName; toast("Имя обновлено.", "ok"); }
          catch (e) { toast(e.message, "error"); }
        }),
        h("div", { class: "muted", style: { fontSize: "13px" } }, "Баланс: ", h("b", { class: "gold" }, fmt(me.balance) + " ЛК"))),
      h("div", { class: "card stack" },
        h("div", { class: "eyebrow" }, "Безопасность"),
        h("button", { class: "btn", type: "button", onclick: () => passwordChangeDialog() }, "Сменить пароль"),
        actionButton("Выйти", async () => { await logout("local"); }, { class: "btn" }),
        actionButton("Выйти на всех устройствах", async () => { await logout("global"); toast("Все сессии завершены."); }, { class: "btn danger" }),
        h("p", { class: "muted", style: { fontSize: "12px" } }, "«На всех устройствах» отзывает все refresh-токены. Уже выданный токен доступа истекает сам в течение часа.")),
      h("div", { class: "card stack" },
        h("div", { class: "eyebrow" }, "Звук"),
        h("label", { class: "row", for: "mute" }, mute, "Без звука"),
        h("div", { class: "field" }, h("label", {}, "Громкость"), vol),
        h("p", { class: "muted", style: { fontSize: "12px" } }, "Исходы всегда показываются текстом — звук только для атмосферы.")),
      mfaBox)));
}
