export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-pass",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

export function getAdminSecret() {
  return Deno.env.get("ADMIN_PASSWORD") || Deno.env.get("ADMIN_PANEL_PASSWORD") || "";
}

export function requireAdmin(req: Request) {
  const provided = req.headers.get("x-admin-pass") || "";
  const expected = getAdminSecret();

  if (!expected) {
    return json(
      { ok: false, error: "Admin password secret is not configured" },
      500,
    );
  }

  if (provided !== expected) {
    return json(
      { ok: false, error: "Неверный пароль" },
      403,
    );
  }

  return null;
}
