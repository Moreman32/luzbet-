// TOTP MFA helpers (Supabase Auth). Staff actions require an aal2 session; the DB enforces it.
import { sb } from "../api.js?v=2.1.1";
import { h, clear, toast, actionButton } from "../ui.js?v=2.1.1";

export async function mfaStatus() {
  const [{ data: aal }, { data: factors }] = await Promise.all([sb.auth.mfa.getAuthenticatorAssuranceLevel(), sb.auth.mfa.listFactors()]);
  const verified = (factors?.totp || []).filter((f) => f.status === "verified");
  return { current: aal?.currentLevel, next: aal?.nextLevel, verified };
}

// Renders a self-contained MFA card; calls onDone() when the session reaches aal2.
export async function mfaCard(onDone) {
  const box = h("div", { class: "card gilded stack" });
  const st = await mfaStatus();
  const code = h("input", { class: "input mono", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, placeholder: "000000", "aria-label": "Код из приложения" });
  const err = h("p", { class: "form-error" });

  async function verify(factorId) {
    err.textContent = "";
    const c = code.value.replace(/\D/g, "");
    if (c.length !== 6) { err.textContent = "Введите 6 цифр."; return; }
    const { data: ch, error: e1 } = await sb.auth.mfa.challenge({ factorId });
    if (e1) { err.textContent = "Не удалось начать проверку."; return; }
    const { error: e2 } = await sb.auth.mfa.verify({ factorId, challengeId: ch.id, code: c });
    if (e2) { err.textContent = "Код не подошёл. Проверьте время на телефоне."; return; }
    await sb.auth.refreshSession();
    toast("Второй фактор подтверждён.", "ok");
    onDone && onDone();
  }

  if (st.verified.length) {
    const f = st.verified[0];
    clear(box, h("div", { class: "eyebrow" }, "Подтверждение входа"),
      h("h3", {}, "Код из приложения-аутентификатора"),
      h("p", { class: "muted" }, "Бэк-офис доступен только после второго фактора. Даже владельцу. Особенно владельцу."),
      code, err, actionButton("Подтвердить", () => verify(f.id), { class: "btn primary block" }));
  } else {
    const startBtn = actionButton("Подключить аутентификатор", async () => {
      const { data: stale } = await sb.auth.mfa.listFactors();
      for (const f of (stale?.all || []).filter((x) => x.status === "unverified")) await sb.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "LuzBet " + new Date().toISOString().slice(0, 10) });
      if (error) { err.textContent = "Не удалось начать подключение: " + (error.message || ""); return; }
      clear(box, h("div", { class: "eyebrow" }, "Шаг 2 из 2"), h("h3", {}, "Отсканируйте QR-код"),
        h("p", { class: "muted" }, "Google Authenticator, 1Password, Aegis — подойдёт любое TOTP-приложение."),
        h("div", { style: { background: "#fff", padding: "12px", borderRadius: "12px", width: "220px" } }, h("img", { src: data.totp.qr_code, alt: "QR-код для аутентификатора", width: 196, height: 196 })),
        h("details", { class: "more" }, h("summary", {}, "Не сканируется? Ключ вручную"), h("p", { class: "mono" }, data.totp.secret)),
        code, err, actionButton("Проверить и включить", () => verify(data.id), { class: "btn primary block" }));
      code.focus();
    }, { class: "btn primary block" });
    clear(box, h("div", { class: "eyebrow" }, "Двухфакторная защита"),
      h("h3", {}, "Нужен второй фактор"),
      h("p", { class: "muted" }, "Для бэк-офиса LuzBet требует TOTP-код. Подключение займёт минуту."), err, startBtn);
  }
  return box;
}
