import { getCorsHeaders, json as baseJson, requireTrustedProxy } from "./http-security.ts";

export function corsHeaders(req: Request) {
  return getCorsHeaders(req, {
    allowHeaders: ["x-admin-pass"],
  });
}

export function json(req: Request, body: unknown, status = 200) {
  return baseJson(req, body, status, {
    allowHeaders: ["x-admin-pass"],
  });
}

export function getAdminSecret() {
  return Deno.env.get("ADMIN_PASSWORD") || Deno.env.get("ADMIN_PANEL_PASSWORD") || "";
}

export function requireAdmin(req: Request) {
  const proxyError = requireTrustedProxy(req, {
    allowHeaders: ["x-admin-pass"],
  });
  if (proxyError) return proxyError;

  const provided = req.headers.get("x-admin-pass") || "";
  const expected = getAdminSecret();

  if (!expected) {
    return json(
      req,
      { ok: false, error: "Admin password secret is not configured" },
      500,
    );
  }

  if (provided !== expected) {
    return json(
      req,
      { ok: false, error: "Неверный пароль" },
      403,
    );
  }

  return null;
}
