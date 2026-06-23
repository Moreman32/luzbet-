const DEFAULT_ALLOWED_ORIGINS = [
  "https://luzbet.lol",
  "https://www.luzbet.lol",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

type HeaderValue = string | undefined;

type HeaderMap = Record<string, HeaderValue>;

type CorsOptions = {
  allowHeaders?: string[];
  allowMethods?: string[];
};

type GuardOptions = CorsOptions & {
  requireProxy?: boolean;
  maxBodyBytes?: number;
};

function uniq(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function allowedOrigins() {
  const raw = Deno.env.get("ALLOWED_ORIGINS") || "";
  const configured = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_ALLOWED_ORIGINS;
}

export function isAllowedOrigin(origin: string | null) {
  if (!origin) return false;
  return allowedOrigins().includes(origin);
}

export function getCorsHeaders(req: Request, options: CorsOptions = {}): Record<string, string> {
  const allowHeaders = uniq([
    "authorization",
    "x-client-info",
    "apikey",
    "content-type",
    "x-admin-pass",
    "x-luzbet-proxy-secret",
    ...(options.allowHeaders || []),
  ]);
  const allowMethods = uniq(["POST", "OPTIONS", ...(options.allowMethods || [])]);
  const origin = req.headers.get("origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": allowHeaders.join(", "),
    "Access-Control-Allow-Methods": allowMethods.join(", "),
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };

  if (origin && isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

export function json(req: Request, body: unknown, status = 200, options: CorsOptions = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: getCorsHeaders(req, options),
  });
}

export function handleOptions(req: Request, options: CorsOptions = {}) {
  if (req.method !== "OPTIONS") return null;
  const origin = req.headers.get("origin");
  if (origin && !isAllowedOrigin(origin)) {
    return json(req, { ok: false, error: "Origin not allowed" }, 403, options);
  }
  return new Response("ok", { headers: getCorsHeaders(req, options) });
}

export function requireTrustedProxy(req: Request, options: CorsOptions = {}) {
  const expected = Deno.env.get("LUZBET_PROXY_SHARED_SECRET") || "";
  if (!expected) {
    return json(req, { ok: false, error: "Proxy secret is not configured" }, 500, options);
  }
  const provided = req.headers.get("x-luzbet-proxy-secret") || "";
  if (provided !== expected) {
    return json(req, { ok: false, error: "Direct access is disabled" }, 403, options);
  }
  return null;
}

export function guardRequest(req: Request, options: GuardOptions = {}) {
  const opts = {
    maxBodyBytes: 32_768,
    ...options,
  };

  const optionsResponse = handleOptions(req, opts);
  if (optionsResponse) return optionsResponse;

  if (req.method !== "POST") {
    return json(req, { ok: false, error: "Method not allowed" }, 405, opts);
  }

  const origin = req.headers.get("origin");
  if (origin && !isAllowedOrigin(origin)) {
    return json(req, { ok: false, error: "Origin not allowed" }, 403, opts);
  }

  const contentLength = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > opts.maxBodyBytes) {
    return json(req, { ok: false, error: "Payload too large" }, 413, opts);
  }

  if (opts.requireProxy) {
    const proxyError = requireTrustedProxy(req, opts);
    if (proxyError) return proxyError;
  }

  return null;
}
