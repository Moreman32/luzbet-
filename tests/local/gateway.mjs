// Local Supabase-like gateway for E2E tests (NOT for production).
// Serves the static site, proxies /rest/v1 -> PostgREST, /functions/v1/<name> -> Deno functions,
// and implements the subset of GoTrue used by LuzBet (password grant, refresh, user, logout, MFA TOTP mock, admin users).
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = path.resolve(process.argv[2] || ".");
const PORT = Number(process.env.PORT || 8080);
const SECRET = process.env.JWT_SECRET || "local-test-secret-local-test-secret-000";
const PGRST = process.env.PGRST || "http://127.0.0.1:3000";
const FUNCS = { "v2-login": { url: "http://127.0.0.1:8001", verifyJwt: false }, "v2-admin": { url: "http://127.0.0.1:8002", verifyJwt: true } };
const db = new pg.Pool({ host: "/tmp", port: 5499, user: "postgres", database: "lb2" });

const b64u = (b) => Buffer.from(b).toString("base64url");
export function sign(claims) {
  const head = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64u(JSON.stringify(claims));
  return `${head}.${body}.${b64u(crypto.createHmac("sha256", SECRET).update(`${head}.${body}`).digest())}`;
}
function verify(tok) {
  try {
    const [hd, bd, sg] = tok.split(".");
    if (b64u(crypto.createHmac("sha256", SECRET).update(`${hd}.${bd}`).digest()) !== sg) return null;
    const c = JSON.parse(Buffer.from(bd, "base64url"));
    return c.exp && c.exp < Date.now() / 1000 ? null : c;
  } catch { return null; }
}
export const ANON = sign({ role: "anon", iss: "local", exp: 4102444800 });
export const SERVICE = sign({ role: "service_role", iss: "local", exp: 4102444800 });

const refresh = new Map();   // token -> {sub, aal, sid}
const factors = new Map();   // userId -> [{id, status, friendly_name, factor_type}]
const sessions = new Map();  // sid -> sub

async function userObj(sub) {
  const { rows } = await db.query("select id, email, raw_app_meta_data, created_at from auth.users where id=$1", [sub]);
  if (!rows[0]) return null;
  return { id: rows[0].id, aud: "authenticated", role: "authenticated", email: rows[0].email, app_metadata: rows[0].raw_app_meta_data || {},
    user_metadata: {}, created_at: rows[0].created_at, factors: (factors.get(sub) || []).map((f) => ({ ...f, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })) };
}
async function issue(sub, aal = "aal1", sid = crypto.randomUUID()) {
  const now = Math.floor(Date.now() / 1000);
  sessions.set(sid, sub);
  const amr = aal === "aal2" ? [{ method: "totp", timestamp: now }, { method: "password", timestamp: now }] : [{ method: "password", timestamp: now }];
  const access_token = sign({ sub, role: "authenticated", aud: "authenticated", aal, amr, session_id: sid, iat: now, exp: now + 3600 });
  const rt = crypto.randomBytes(16).toString("hex");
  refresh.set(rt, { sub, aal, sid });
  return { access_token, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: rt, user: await userObj(sub) };
}
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const readBody = (req) => new Promise((ok) => { let d = ""; req.on("data", (c) => d += c); req.on("end", () => ok(d)); });
const bearer = (req) => (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

async function auth(req, res, url) {
  const p = url.pathname.replace("/auth/v1", "");
  const raw = await readBody(req);
  const body = raw ? JSON.parse(raw) : {};
  if (p === "/token" && url.searchParams.get("grant_type") === "password") {
    const { rows } = await db.query("select id from auth.users where email=$1 and encrypted_password = extensions.crypt($2, encrypted_password) and (banned_until is null or banned_until < now())", [body.email, body.password]);
    if (!rows[0]) return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials" });
    return send(res, 200, await issue(rows[0].id));
  }
  if (p === "/token" && url.searchParams.get("grant_type") === "refresh_token") {
    const r = refresh.get(body.refresh_token);
    if (!r || !sessions.has(r.sid)) return send(res, 400, { error: "invalid_grant", error_description: "Invalid Refresh Token" });
    refresh.delete(body.refresh_token);
    return send(res, 200, await issue(r.sub, r.aal, r.sid));
  }
  if (p.startsWith("/admin/")) {
    const c = verify(bearer(req)) || (req.headers.apikey === SERVICE ? { role: "service_role" } : null);
    if (!c || c.role !== "service_role") return send(res, 401, { msg: "not admin" });
    if (p === "/admin/users" && req.method === "POST") {
      const id = crypto.randomUUID();
      await db.query("insert into auth.users(id,email,encrypted_password,aud,role,email_confirmed_at,raw_app_meta_data) values ($1,$2,extensions.crypt($3, extensions.gen_salt('bf')),'authenticated','authenticated',now(),$4)",
        [id, body.email, body.password, JSON.stringify(body.app_metadata || {})]);
      return send(res, 200, await userObj(id));
    }
    const m = p.match(/^\/admin\/users\/([0-9a-f-]+)$/);
    if (m && req.method === "PUT") {
      if (body.password) await db.query("update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')) where id=$1", [m[1], body.password]);
      if (body.ban_duration) await db.query("update auth.users set banned_until = case when $2 = 'none' then null else now() + interval '100 years' end where id=$1", [m[1], body.ban_duration]);
      return send(res, 200, await userObj(m[1]));
    }
    if (m && req.method === "DELETE") { await db.query("delete from auth.users where id=$1", [m[1]]); return send(res, 200, {}); }
    return send(res, 404, {});
  }
  const c = verify(bearer(req));
  if (!c || !sessions.has(c.session_id)) return send(res, 401, { code: 401, msg: "invalid JWT" });
  if (p === "/user" && req.method === "GET") return send(res, 200, await userObj(c.sub));
  if (p === "/user" && req.method === "PUT") {
    if (body.password) await db.query("update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')) where id=$1", [c.sub, body.password]);
    return send(res, 200, await userObj(c.sub));
  }
  if (p === "/logout") {
    const scope = url.searchParams.get("scope") || "global";
    for (const [sid, sub] of sessions) if ((scope === "global" && sub === c.sub) || sid === c.session_id) sessions.delete(sid);
    return send(res, 204);
  }
  if (p === "/factors" && req.method === "POST") {
    const f = { id: crypto.randomUUID(), status: "unverified", friendly_name: body.friendly_name, factor_type: "totp" };
    factors.set(c.sub, [...(factors.get(c.sub) || []), f]);
    const qr = "data:image/svg+xml;utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#000"/><rect x="2" y="2" width="6" height="6" fill="#fff"/></svg>');
    return send(res, 200, { id: f.id, type: "totp", friendly_name: f.friendly_name, totp: { qr_code: qr, secret: "LOCALTESTSECRET", uri: "otpauth://totp/local" } });
  }
  let m = p.match(/^\/factors\/([0-9a-f-]+)\/challenge$/);
  if (m) return send(res, 200, { id: crypto.randomUUID(), type: "totp", expires_at: Math.floor(Date.now() / 1000) + 300 });
  m = p.match(/^\/factors\/([0-9a-f-]+)\/verify$/);
  if (m) {
    if (body.code !== "123456") return send(res, 422, { code: "mfa_verification_failed", msg: "Invalid TOTP code entered" });
    const list = factors.get(c.sub) || []; const f = list.find((x) => x.id === m[1]); if (f) f.status = "verified";
    return send(res, 200, await issue(c.sub, "aal2", c.session_id));
  }
  m = p.match(/^\/factors\/([0-9a-f-]+)$/);
  if (m && req.method === "DELETE") { factors.set(c.sub, (factors.get(c.sub) || []).filter((x) => x.id !== m[1])); return send(res, 200, { id: m[1] }); }
  return send(res, 404, { msg: "not implemented: " + p });
}

function proxy(req, res, target, stripPrefix, headers = {}) {
  const url = new URL(req.url, "http://x");
  const t = new URL(target + url.pathname.replace(stripPrefix, "") + url.search);
  const h = { ...req.headers, ...headers, host: t.host };
  // Supabase gateway maps apikey -> Authorization when no user token is present
  if (!h.authorization && h.apikey) h.authorization = "Bearer " + h.apikey;
  const up = http.request(t, { method: req.method, headers: h }, (r) => {
    res.writeHead(r.statusCode, { ...r.headers, "access-control-allow-origin": "*" });
    r.pipe(res);
  });
  up.on("error", (e) => send(res, 502, { error: String(e) }));
  req.pipe(up);
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json", ".ogg": "audio/ogg" };
function staticFile(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === "/") p = "/index.html";
  const f = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, { error: "not found" });
  let data = fs.readFileSync(f);
  if (p === "/index.html") {
    data = data.toString()
      .replace("https://kdsowktuirtkxnmtyoaz.supabase.co wss://kdsowktuirtkxnmtyoaz.supabase.co", `http://localhost:${PORT} ws://localhost:${PORT}`)
      .replace('<script src="assets/js/vendor', '<script src="/__local_config.js"></script>\n  <script src="assets/js/vendor');
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" });
  res.end(data);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (req.method === "OPTIONS") return send(res, 204);
    if (url.pathname === "/__local_config.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      return res.end(`window.__LUZBET_CONFIG = { url: "http://localhost:${PORT}", key: "${ANON}" };`);
    }
    if (url.pathname.startsWith("/rest/v1")) return proxy(req, res, PGRST, "/rest/v1");
    if (url.pathname.startsWith("/auth/v1")) return await auth(req, res, url);
    const fm = url.pathname.match(/^\/functions\/v1\/([\w-]+)/);
    if (fm) {
      const fn = FUNCS[fm[1]]; if (!fn) return send(res, 404, { error: "no function" });
      if (fn.verifyJwt) { const c = verify(bearer(req)); if (!c) return send(res, 401, { msg: "Invalid JWT" }); }
      return proxy(req, res, fn.url, /^\/functions\/v1\/[\w-]+/);
    }
    return staticFile(req, res, url);
  } catch (e) { console.error(e); send(res, 500, { error: String(e) }); }
}).listen(PORT, () => console.log(`gateway on :${PORT}\nANON=${ANON}\nSERVICE=${SERVICE}`));
