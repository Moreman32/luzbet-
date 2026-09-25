// API layer. The browser is untrusted: it only sends intents; every number that matters comes back from the DB.
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "luzbet2-auth" },
});

const MESSAGES = {
  invalid_credentials: "Неверный логин или пароль.",
  too_many_attempts: "Слишком много попыток. Отдел безопасности предлагает выдохнуть 15 минут.",
  service_unavailable: "Касса временно недоступна. Попробуйте чуть позже.",
  insufficient_funds: "Недостаточно ЛК. Финансовый отдел сочувствует, но не более того.",
  bet_limits: "Ставка вне лимитов стола.",
  invalid_bets: "Такую ставку стол не принимает.",
  invalid_action: "Это действие сейчас недоступно.",
  idempotency_conflict: "Повтор запроса с другими данными отклонён.",
  round_not_found: "Раунд не найден.",
  round_finished: "Раунд уже завершён.",
  round_in_progress: "Сначала доиграйте текущую раздачу.",
  already_claimed: "Сегодня помощь уже выдана. Завтра — снова.",
  game_unavailable: "Игра временно закрыта.",
  account_disabled: "Аккаунт отключён.",
  not_authenticated: "Сессия истекла. Войдите снова.",
  no_profile: "Профиль не найден.",
  forbidden: "Недостаточно прав.",
  mfa_required: "Нужно подтверждение вторым фактором (MFA).",
  reason_required: "Укажите причину.",
  invalid_amount: "Некорректная сумма.",
  self_adjustment_forbidden: "Себе начислять нельзя. Даже очень хочется.",
  username_taken: "Такой логин уже занят.",
  invalid_username: "Логин: 3–24 символа, латиница, цифры и _.",
  weak_password: "Пароль: от 8 до 72 символов.",
  invalid_display_name: "Имя: 1–32 символа, без < >.",
  invalid_client_seed: "Client seed: до 64 символов.",
  network: "Нет связи с кассой. Запрос можно безопасно повторить.",
};

export class ApiError extends Error {
  constructor(code, extra = {}) { super(MESSAGES[code] || "Что-то пошло не так. Попробуйте ещё раз."); this.code = code; this.extra = extra; }
}

function codeFromMessage(msg = "") {
  const m = String(msg);
  for (const k of Object.keys(MESSAGES)) if (m.includes(k)) return k;
  if (/fetch|network|Failed to fetch|NetworkError/i.test(m)) return "network";
  return "unknown";
}

export async function rpc(name, args = {}) {
  let res;
  try { res = await sb.rpc(name, args); } catch (e) { throw new ApiError("network"); }
  if (res.error) {
    const code = codeFromMessage(res.error.message);
    if (code === "not_authenticated" || code === "account_disabled" || code === "no_profile") window.dispatchEvent(new CustomEvent("lb:auth-lost", { detail: code }));
    throw new ApiError(code === "unknown" && res.status === 0 ? "network" : code);
  }
  if (res.data && res.data.ok === false) throw new ApiError(res.data.error, res.data);
  return res.data;
}

export async function login(username, password) {
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/functions/v1/v2-login`, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
      body: JSON.stringify({ username, password }),
    });
  } catch { throw new ApiError("network"); }
  let d = {};
  try { d = await r.json(); } catch { /* ignore */ }
  if (!r.ok) throw new ApiError(d.error || "invalid_credentials");
  const { error } = await sb.auth.setSession({ access_token: d.access_token, refresh_token: d.refresh_token });
  if (error) throw new ApiError("service_unavailable");
}

export async function logout(scope = "local") {
  try { await sb.auth.signOut({ scope }); } catch { /* ignore */ }
}

export async function admin(action, body = {}) {
  const { data, error } = await sb.functions.invoke("v2-admin", { body: { action, ...body } });
  if (error) {
    let code = "unknown";
    try { code = (await error.context.json()).error || code; } catch { /* ignore */ }
    throw new ApiError(code);
  }
  if (data && data.ok === false) throw new ApiError(data.error);
  return data;
}
