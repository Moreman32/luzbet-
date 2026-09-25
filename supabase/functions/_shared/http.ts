// Shared HTTP helpers for LuzBet 2.0 Edge Functions.
export const ALLOWED_ORIGINS = [
  "https://luzbet.lol",
  "https://www.luzbet.lol",
  "https://moreman32.github.io",
];

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(req) });
}

export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for") ?? "";
  return (req.headers.get("cf-connecting-ip") ?? xf.split(",")[0] ?? "").trim().slice(0, 64) || "unknown";
}

export async function readJson(req: Request, maxBytes = 4096): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > maxBytes) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

export const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
