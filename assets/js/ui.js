// DOM helpers. Text is always inserted via textContent — never innerHTML with data.
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(tag.startsWith("svg:") ? "http://www.w3.org/2000/svg" : "http://www.w3.org/1999/xhtml",
    tag.replace(/^svg:/, ""));
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.setAttribute("class", Array.isArray(v) ? v.filter(Boolean).join(" ") : v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export function clear(el, ...kids) { el.replaceChildren(); append(el, kids); return el; }

// Static trusted SVG icons (no user data).
const ICONS = {
  home: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  wheel: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm0 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  cards: "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm5 5l-3 4 3 4 3-4z",
  history: "M12 3a9 9 0 1 1-8.5 6H6a7 7 0 1 0 6-4v3L8 4l4-4zm-1 5h2v5l4 2-1 1.7-5-2.7z",
  shield: "M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5zm-1 13l6-6-1.4-1.4L11 12.2 8.4 9.6 7 11z",
  user: "M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-5 0-9 2.5-9 6v2h18v-2c0-3.5-4-6-9-6z",
};
export function icon(name) {
  const svg = h("svg:svg", { viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": "true" });
  svg.appendChild(h("svg:path", { d: ICONS[name] || "" }));
  return svg;
}

export const fmt = (n) => (n === null || n === undefined || Number.isNaN(Number(n))) ? "—" : Number(n).toLocaleString("ru-RU");
export const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n));
export const dt = (s) => new Date(s).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

let toastBox;
export function toast(msg, kind = "") {
  if (!toastBox) { toastBox = h("div", { class: "toasts", role: "status", "aria-live": "polite" }); document.body.appendChild(toastBox); }
  const t = h("div", { class: ["toast", kind] }, msg);
  toastBox.appendChild(t);
  setTimeout(() => t.remove(), kind === "error" ? 6000 : 4000);
}

export function modal(content, { onClose } = {}) {
  const bg = h("div", { class: "modal-bg", role: "dialog", "aria-modal": "true" });
  const box = h("div", { class: "modal card gilded" }, content);
  bg.appendChild(box);
  const close = () => { bg.remove(); document.removeEventListener("keydown", esc); onClose && onClose(); };
  const esc = (e) => { if (e.key === "Escape") close(); };
  bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
  document.addEventListener("keydown", esc);
  document.body.appendChild(bg);
  const first = box.querySelector("input,button,select,textarea"); first && first.focus();
  return { close, el: box };
}

export function drawer(content) {
  const bg = h("div", { class: "drawer-bg" });
  const d = h("aside", { class: "drawer", role: "dialog", "aria-modal": "true" }, content);
  const close = () => { bg.remove(); d.remove(); document.removeEventListener("keydown", esc); };
  const esc = (e) => { if (e.key === "Escape") close(); };
  bg.addEventListener("click", close);
  document.addEventListener("keydown", esc);
  document.body.append(bg, d);
  return { close, el: d };
}

// Button that runs an async action once at a time (prevents double submits at the UI level).
export function actionButton(label, fn, attrs = {}) {
  const b = h("button", { class: "btn", type: "button", ...attrs }, label);
  let busy = false;
  b.addEventListener("click", async (e) => {
    if (busy || b.disabled) return;
    busy = true; b.disabled = true;
    const old = [...b.childNodes];
    b.replaceChildren(h("span", { class: "spin" }));
    try { await fn(e); } finally { busy = false; b.disabled = false; b.replaceChildren(...old); }
  });
  return b;
}

export const store = {
  get(k, d) { try { const v = localStorage.getItem("lb2:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("lb2:" + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  sget(k, d) { try { const v = sessionStorage.getItem("lb2:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  sset(k, v) { try { v === null ? sessionStorage.removeItem("lb2:" + k) : sessionStorage.setItem("lb2:" + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

export const reducedMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function newKey(prefix) {
  const b = new Uint8Array(12); crypto.getRandomValues(b);
  return prefix + "-" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
