// Independent browser-side verifier. Mirrors the documented algorithm (FAIRNESS.md), not the server code.
const enc = new TextEncoder();

export async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function hmacBlock(key, msg) {
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

export async function fairInts(serverSeed, clientSeed, nonce, moduli) {
  const key = await crypto.subtle.importKey("raw", enc.encode(serverSeed), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const out = [];
  let cur = 0, blk = null, off = 32;
  for (const m of moduli) {
    const lim = Math.floor(4294967296 / m) * m;
    for (;;) {
      if (off >= 32) { blk = await hmacBlock(key, `${clientSeed}:${nonce}:${cur}`); cur++; off = 0; }
      const u = ((blk[off] << 24) >>> 0) + (blk[off + 1] << 16) + (blk[off + 2] << 8) + blk[off + 3];
      off += 4;
      if (u < lim) { out.push(u % m); break; }
    }
  }
  return out;
}

export const rouletteNumber = async (s, c, n) => (await fairInts(s, c, n, [37]))[0];

export async function shuffle(s, c, n) {
  const d = Array.from({ length: 312 }, (_, i) => i);
  const moduli = []; for (let m = 312; m >= 2; m--) moduli.push(m);
  const r = await fairInts(s, c, n, moduli);
  let k = 0;
  for (let i = 311; i >= 1; i--) { const j = r[k++]; [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

const val = (c) => Math.min((c % 13) + 1, 10);
const hard = (cs) => cs.reduce((a, c) => a + val(c), 0);
const soft = (cs) => cs.some((c) => c % 13 === 0) && hard(cs) + 10 <= 21;
export const bjTotal = (cs) => hard(cs) + (soft(cs) ? 10 : 0);
const isBJ = (cs) => cs.length === 2 && bjTotal(cs) === 21;

// Replays a blackjack round from the shoe and the player's recorded actions (blackjack_standard_v1).
export function blackjackReplay(deck, bet, actions) {
  let pos = 4;
  const player = [deck[0], deck[2]];
  let dealer = [deck[1], deck[3]];
  let hands = [{ cards: player, bet, status: "playing" }];
  if (isBJ(dealer) || isBJ(player)) {
    const pay = isBJ(dealer) && isBJ(player) ? bet : isBJ(dealer) ? 0 : bet + Math.floor((bet * 3) / 2);
    return { payout: pay, hands, dealer };
  }
  let active = 0;
  for (const a of actions) {
    const hnd = hands[active];
    if (a === "hit") { hnd.cards = [...hnd.cards, deck[pos++]]; const t = bjTotal(hnd.cards); if (t > 21) hnd.status = "bust"; else if (t === 21) hnd.status = "stood"; }
    else if (a === "stand") hnd.status = "stood";
    else if (a === "double") { hnd.bet *= 2; hnd.cards = [...hnd.cards, deck[pos++]]; hnd.status = bjTotal(hnd.cards) > 21 ? "bust" : "stood"; }
    else if (a === "split") {
      const aces = hnd.cards[0] % 13 === 0;
      const c1 = deck[pos++], c2 = deck[pos++];
      hands = [[hnd.cards[0], c1], [hnd.cards[1], c2]].map((cs) => ({ cards: cs, bet: hnd.bet, status: aces || bjTotal(cs) === 21 ? "stood" : "playing" }));
    }
    while (active < hands.length && hands[active].status !== "playing") active++;
    if (active >= hands.length) break;
  }
  if (active < hands.length) return { payout: null, hands, dealer };
  if (hands.some((x) => x.status !== "bust")) while (bjTotal(dealer) < 17) dealer = [...dealer, deck[pos++]];
  const dt = bjTotal(dealer);
  let payout = 0;
  for (const x of hands) {
    const pt = bjTotal(x.cards);
    payout += x.status === "bust" ? 0 : dt > 21 || pt > dt ? 2 * x.bet : pt === dt ? x.bet : 0;
  }
  return { payout, hands, dealer };
}

export const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const colorOf = (n) => (n === 0 ? "green" : RED.has(n) ? "red" : "black");

// Numbers covered by a roulette bet as submitted ({t, n} or {t, v}) and its X:1 ratio (roulette_european_v1).
export const ROULETTE_RATIO = { straight: 35, split: 17, street: 11, corner: 8, sixline: 5, column: 2, dozen: 2, color: 1, parity: 1, half: 1 };
export function rouletteCovers(b) {
  if (Array.isArray(b.n)) return b.n.map(Number);
  const all = Array.from({ length: 36 }, (_, i) => i + 1), v = String(b.v);
  if (b.t === "column") return all.filter((n) => (n - Number(v)) % 3 === 0);
  if (b.t === "dozen") return all.filter((n) => n > (Number(v) - 1) * 12 && n <= Number(v) * 12);
  if (b.t === "color") return all.filter((n) => colorOf(n) === v);
  if (b.t === "parity") return all.filter((n) => (n % 2 === 1) === (v === "odd"));
  if (b.t === "half") return all.filter((n) => (v === "low" ? n <= 18 : n >= 19));
  return [];
}
export function roulettePayout(bets, number) {
  return bets.reduce((sum, b) => sum + (rouletteCovers(b).includes(number) ? Number(b.a) * (ROULETTE_RATIO[b.t] + 1) : 0), 0);
}
