import { h, fmt, reducedMotion } from "../ui.js?v=2.3.6";
import { meme } from "../memes.js?v=2.3.6";

const BIG_WIN_IMAGES = ["assets/img/big-win.png", "assets/img/big-win1.png", "assets/img/big-win2.png"];
const GAME_EMOJI = { roulette: "🎡", bj: "🃏", dice: "🎲", mines: "💣", crash: "🚀", slots: "🎰", plinko: "🔵", horse: "🐎", hl: "🔮" };

// Rare (≈4% per round), purely cosmetic flourish shown after the real result is already credited —
// same idea as bigWin() but tiny, quick, and can fire on a loss too. Silently does nothing if the
// game has no "<game>.rareWin"/"<game>.rareLoss" lines in the meme catalog, so it's safe to call
// from any game unconditionally.
export function maybeFunnyEvent(game, net) {
  if (!net || Math.random() >= 0.04) return;
  const kind = net > 0 ? "rareWin" : "rareLoss";
  const line = meme(`${game}.${kind}`);
  if (!line) return;
  const emoji = GAME_EMOJI[game] || "🎪";
  const el = h("div", { class: ["funnyEvent", net > 0 ? "up" : "down"], role: "status" },
    h("div", { class: "inner" },
      h("div", { class: "emoji" }, emoji),
      h("div", { class: "eyebrow" }, net > 0 ? "Особое мнение комиссии" : "Служебная записка"),
      h("p", {}, line)));
  el.addEventListener("click", () => el.remove());
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

// Rare, dramatic, dismissible. Purely cosmetic: shown after the authoritative result is already credited.
export function bigWin(amount) {
  const img = BIG_WIN_IMAGES[Math.floor(Math.random() * BIG_WIN_IMAGES.length)];
  const el = h("div", { class: "bigwin", role: "dialog", "aria-label": "Крупный выигрыш", tabindex: "-1" },
    h("div", { class: "inner" },
      h("div", { class: "eyebrow" }, "Крупный выигрыш"),
      h("img", { src: img, alt: "", width: 280 }),
      h("div", { class: "amount" }, "+" + fmt(amount) + " ЛК"),
      h("p", { class: "meme-line" }, meme("win.big")),
      h("p", { class: "muted", style: { fontSize: "12px" } }, "Нажмите, чтобы продолжить")));
  const close = () => { el.remove(); document.removeEventListener("keydown", close); };
  el.addEventListener("click", close);
  document.addEventListener("keydown", close);
  document.body.appendChild(el);
  el.focus();
  setTimeout(close, 7000);
}

// Rare (≈4% per spin), purely cosmetic gag: a real fixed-position ball pops off the roulette wheel
// and bounces around the WHOLE page — not just the game card — for a couple of seconds, then fades.
// Fire-and-forget: it never blocks or delays the real spin animation, and it plays no part in the
// actual result, which is already decided server-side by the time this is called.
export function looseBall(originEl) {
  if (reducedMotion() || !originEl) return;
  const r = originEl.getBoundingClientRect();
  const ball = document.createElement("div");
  ball.className = "rl-loose-ball";
  document.body.appendChild(ball);
  let x = r.left + r.width / 2, y = r.top + r.height / 2;
  let vx = (Math.random() * 2 - 1) * 10, vy = -(Math.random() * 5 + 9);
  const gravity = 0.55, bounce = 0.68, t0 = performance.now(), duration = 2300;
  function frame(now) {
    vy += gravity; x += vx; y += vy;
    const w = window.innerWidth, hgt = window.innerHeight, remaining = duration - (now - t0);
    if (x < 7) { x = 7; vx = Math.abs(vx) * bounce; } else if (x > w - 7) { x = w - 7; vx = -Math.abs(vx) * bounce; }
    if (y > hgt - 7) { y = hgt - 7; vy = -Math.abs(vy) * bounce; if (remaining > 250 && Math.abs(vy) < 3) vy = -(6 + Math.random() * 4); }
    ball.style.transform = `translate(${x - 7}px, ${y - 7}px) rotate(${x * 3}deg)`;
    if (remaining > 0) requestAnimationFrame(frame);
    else { ball.classList.add("fade"); setTimeout(() => ball.remove(), 300); }
  }
  requestAnimationFrame(frame);
}

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const cardLabel = (c) => RANKS[c % 13] + SUITS[Math.floor(c / 13) % 4];
export function cardEl(c, delay = 0) {
  if (c === null) return h("div", { class: "pcard back", "aria-label": "Закрытая карта", style: { animationDelay: delay + "ms" } }, h("div", { class: "c" }, "LB"));
  const s = Math.floor(c / 13) % 4, red = s === 1 || s === 2;
  return h("div", { class: ["pcard", red ? "red" : ""], "aria-label": cardLabel(c), style: { animationDelay: delay + "ms" } },
    h("div", { class: "tl" }, RANKS[c % 13], h("small", {}, SUITS[s])), h("div", { class: "c" }, SUITS[s]));
}
