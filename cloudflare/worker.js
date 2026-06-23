const ALLOWED_FUNCTIONS = new Set([
  "admin-auth",
  "admin-results-delete",
  "admin-results-list",
  "admin-results-save",
  "check-code",
  "claim-casino-cashback",
  "claim-daily-bonus",
  "create-pvp-blackjack-room",
  "create-pvp-chicken-room",
  "create-pvp-dice-room",
  "finish-casino-round",
  "get-achievements",
  "get-casino",
  "get-casino-stats",
  "get-durak-game",
  "get-my-casino-stats",
  "get-pending-match-rewards",
  "get-playoff",
  "get-prediction",
  "get-pvp-blackjack-room",
  "get-pvp-chicken-room",
  "get-pvp-dice-room",
  "list-pvp-blackjack-rooms",
  "list-pvp-chicken-rooms",
  "list-pvp-dice-rooms",
  "log-casino-event",
  "mark-match-rewards-shown",
  "play-durak-turn",
  "play-pvp-blackjack-turn",
  "play-pvp-chicken-turn",
  "play-pvp-dice-turn",
  "public-site-data",
  "save-casino",
  "save-playoff",
  "save-prediction",
  "start-casino-round",
  "start-durak-game",
  "sync-achievements",
  "accept-pvp-blackjack-room",
  "accept-pvp-chicken-room",
  "accept-pvp-dice-room",
]);

const CACHEABLE_FUNCTIONS = new Map([
  ["public-site-data", 20],
]);

function allowedOrigins(env) {
  const raw = String(env.ALLOWED_ORIGINS || "").trim();
  if (!raw) {
    return ["https://luzbet.lol", "https://www.luzbet.lol"];
  }
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

function isAllowedOrigin(origin, env) {
  if (!origin) return true;
  return allowedOrigins(env).includes(origin);
}

function corsHeaders(origin, env) {
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-admin-pass",
    "Vary": "Origin",
  };
  if (origin && isAllowedOrigin(origin, env)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function json(body, status, origin, env, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin, env),
      ...extraHeaders,
    },
  });
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

async function maybeReadCached(request, env, functionName) {
  const ttl = CACHEABLE_FUNCTIONS.get(functionName);
  if (!ttl) return null;
  const body = await request.clone().text();
  if (body && body !== "{}") return null;
  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  return { cache, cacheKey, ttl };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (!url.pathname.startsWith("/api/")) {
      return json({ ok: false, error: "Not found" }, 404, origin, env);
    }

    if (request.method === "OPTIONS") {
      if (!isAllowedOrigin(origin, env)) {
        return json({ ok: false, error: "Origin not allowed" }, 403, origin, env);
      }
      return new Response("ok", { headers: corsHeaders(origin, env) });
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed" }, 405, origin, env);
    }

    if (!isAllowedOrigin(origin, env)) {
      return json({ ok: false, error: "Origin not allowed" }, 403, origin, env);
    }

    const functionName = url.pathname.slice("/api/".length).trim();
    if (!ALLOWED_FUNCTIONS.has(functionName)) {
      return json({ ok: false, error: "Unknown function" }, 404, origin, env);
    }

    const targetBaseUrl = normalizeBaseUrl(env.SUPABASE_FUNCTIONS_BASE_URL);
    const publishableKey = String(env.SUPABASE_PUBLISHABLE_KEY || "");
    const proxySecret = String(env.LUZBET_PROXY_SHARED_SECRET || "");
    if (!targetBaseUrl || !publishableKey || !proxySecret) {
      return json({ ok: false, error: "Worker secrets are not configured" }, 500, origin, env);
    }

    const cached = await maybeReadCached(request, env, functionName);
    if (cached instanceof Response) {
      return cached;
    }

    const bodyText = await request.text();
    const upstreamHeaders = new Headers({
      "Content-Type": "application/json",
      "apikey": publishableKey,
      "Authorization": `Bearer ${publishableKey}`,
      "x-luzbet-proxy-secret": proxySecret,
    });

    const adminPass = request.headers.get("x-admin-pass");
    if (adminPass) {
      upstreamHeaders.set("x-admin-pass", adminPass);
    }

    const upstream = await fetch(`${targetBaseUrl}/${functionName}`, {
      method: "POST",
      headers: upstreamHeaders,
      body: bodyText || "{}",
    });

    const responseHeaders = new Headers(corsHeaders(origin, env));
    responseHeaders.set("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");

    let response = new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });

    if (cached && upstream.ok) {
      responseHeaders.set("Cache-Control", `public, max-age=${cached.ttl}`);
      response = new Response(response.body, {
        status: response.status,
        headers: responseHeaders,
      });
      ctx.waitUntil(cached.cache.put(cached.cacheKey, response.clone()));
    }

    return response;
  },
};
