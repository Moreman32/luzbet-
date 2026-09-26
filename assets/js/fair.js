// Independent browser-side verifier. Mirrors the documented algorithm (FAIRNESS.md), not the server code.
const enc = new TextEncoder();

export async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function hmacBlock(key, msg) {
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

// Stateful stream: draw(m) returns a uniform integer in [0, m) with rejection sampling (same order as the server).
export async function fairStream(serverSeed, clientSeed, nonce) {
  const key = await crypto.subtle.importKey("raw", enc.encode(serverSeed), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  let cur = 0, blk = null, off = 32;
  return async (m) => {
    const lim = Math.floor(4294967296 / m) * m;
    for (;;) {
      if (off >= 32) { blk = await hmacBlock(key, `${clientSeed}:${nonce}:${cur}`); cur++; off = 0; }
      const u = ((blk[off] << 24) >>> 0) + (blk[off + 1] << 16) + (blk[off + 2] << 8) + blk[off + 3];
      off += 4;
      if (u < lim) return u % m;
    }
  };
}

export async function fairInts(serverSeed, clientSeed, nonce, moduli) {
  const draw = await fairStream(serverSeed, clientSeed, nonce);
  const out = [];
  for (const m of moduli) out.push(await draw(m));
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

// ======================================================================= games pack (games_v1)
const MAX_PAYOUT = 5000000n;
const cap = (x) => Number(x > MAX_PAYOUT ? MAX_PAYOUT : x);
const range = (a, b) => { const r = []; for (let i = a; i >= b; i--) r.push(i); return r; };   // a, a-1, …, b

async function fisherYates(s, c, n, size) {
  const d = Array.from({ length: size }, (_, i) => i);
  const r = await fairInts(s, c, n, range(size, 2));
  let k = 0;
  for (let i = size - 1; i >= 1; i--) { const j = r[k++]; [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

// Dice: roll = fairInt(10000); payout = floor(bet*97/chance)
export async function diceReplay(s, c, n, req) {
  const roll = (await fairInts(s, c, n, [10000]))[0];
  const won = req.direction === "under" ? roll < req.chance * 100 : roll >= (100 - req.chance) * 100;
  return { roll, won, payout: won ? Number((BigInt(req.bet) * 97n) / BigInt(req.chance)) : 0 };
}

// Mines: Fisher–Yates over 25 tiles; mines = first m. Payout = floor(bet * 97 * Π(25-i) / (100 * Π(25-m-i))).
export async function minesPositions(s, c, n, m) { return (await fisherYates(s, c, n, 25)).slice(0, m).sort((a, b) => a - b); }
export function minesPayout(bet, m, k) {
  if (k === 0) return 0;
  let num = 97n, den = 100n;
  for (let i = 0; i < k; i++) { num *= BigInt(25 - i); den *= BigInt(25 - m - i); }
  return cap((BigInt(bet) * num) / den);
}

// Crash: r = fairInt(N); crash×100 = max(100, min(1e6, floor(97N/(N-r))))
export async function crashPoint(s, c, n) {
  const N = 2147483647n, r = BigInt((await fairInts(s, c, n, [2147483647]))[0]);
  let v = (97n * N) / (N - r);
  if (v > 1000000n) v = 1000000n; if (v < 100n) v = 100n;
  return Number(v);
}

// Plinko: 12 × fairInt(2); bucket = sum; payout = floor(bet × table[bucket]) (table has ≤ 2 decimals)
export async function plinkoReplay(s, c, n, bet, table) {
  const path = await fairInts(s, c, n, Array(12).fill(2));
  const bucket = path.reduce((a, b) => a + b, 0);
  const m100 = BigInt(Math.round(Number(table[bucket]) * 100));
  return { path, bucket, payout: cap((BigInt(bet) * m100) / 100n) };
}

// Horse: sequential weighted draws from one stream; odds = floor(95000/w)/100
export async function horseReplay(s, c, n, weights, bets) {
  const draw = await fairStream(s, c, n);
  let rem = weights.map((_, i) => i); const order = [];
  while (rem.length > 1) {
    const tot = rem.reduce((a, i) => a + weights[i], 0);
    const u = await draw(tot);
    let acc = 0;
    for (const i of rem) { acc += weights[i]; if (u < acc) { order.push(i); rem = rem.filter((x) => x !== i); break; } }
  }
  order.push(rem[0]);
  const payout = bets.filter((b) => b.h === order[0]).reduce((a, b) => a + Math.floor((b.a * Math.floor(95000 / weights[b.h])) / 100), 0);
  return { order, payout };
}

// Businka slots: stops from one draw list (lengths repeated 1+maxFree times). Payout in tenths of the bet to stay exact.
export function slotLine(syms, pay) {
  let lead = 0; for (const x of syms) { if (x === 0) lead++; else break; }
  let best = [lead >= 3 ? (pay["2"]?.[String(lead)] || 0) : 0, 2, lead];
  const base = syms.find((x) => x !== 0);
  if (base !== undefined && base !== 1) {
    let k = 0; for (const x of syms) { if (x === base || x === 0) k++; else break; }
    const p = pay[String(base)]?.[String(k)] || 0;
    if (p > best[0]) best = [p, base, k];
  }
  return best;
}
export async function slotsReplay(s, c, n, bet, rules) {
  const lens = rules.strips.map((x) => x.length), maxFree = rules.maxFreeSpins;
  const moduli = []; for (let i = 0; i <= maxFree; i++) moduli.push(...lens);
  const draws = await fairInts(s, c, n, moduli);
  let k = 0, totalTenths = 0n, left = 0, awarded = 0, spin = 0;
  const spins = [];
  for (;;) {
    const mult = spin === 0 ? 1 : rules.freeSpinMultiplier;
    const stops = draws.slice(k, k + 5); k += 5;
    const win = [];
    for (let r = 0; r < 5; r++) for (let row = 0; row < 3; row++) win.push(rules.strips[r][(stops[r] + row) % lens[r]]);
    let units = 0;
    rules.paylines.forEach((ln) => { const [p] = slotLine(ln.map((row, r) => win[r * 3 + row]), rules.pay); units += p; });
    const sc = win.filter((x) => x === 1).length;
    const tenths = BigInt(units + (sc >= 3 ? rules.scatterPay[String(Math.min(sc, 5))] * 10 : 0)) * BigInt(mult);
    totalTenths += tenths;
    spins.push({ stops, scatters: sc });
    if (spin === 0) { if (sc >= 3) { left = rules.freeSpins[String(Math.min(sc, 5))]; awarded = left; } }
    else if (sc >= 3 && awarded < maxFree) { const add = Math.min(rules.retrigger, maxFree - awarded); left += add; awarded += add; }
    if (left === 0) break;
    left--; spin++;
  }
  return { spins, payout: cap((BigInt(bet) * totalTenths) / 10n) };
}

// Higher/Lower v3: one 52-card Fisher–Yates; same-rank cards are burned; payout = floor(bet·97·den / (100·num)), ≤ bet×10000
export async function hlReplay(s, c, n, bet, actions) {
  const d = await fisherYates(s, c, n, 52);
  const rank = (x) => x % 13;
  let pos = 1, cur = d[0], num = 1n, den = 1n, wins = 0;
  const cards = [cur];
  for (const a of actions) {
    if (a === "cashout") {
      let pay = (BigInt(bet) * 97n * den) / (100n * num);
      if (pay > BigInt(bet) * 10000n) pay = BigInt(bet) * 10000n;
      return { payout: Number(pay), cards, status: "cashed" };
    }
    const rest = d.slice(pos).filter((x) => rank(x) !== rank(cur));
    const hi = rest.filter((x) => rank(x) > rank(cur)).length, w = a === "higher" ? hi : rest.length - hi;
    while (rank(d[pos]) === rank(cur)) pos++;
    const nx = d[pos++];
    const ok = a === "higher" ? rank(nx) > rank(cur) : rank(nx) < rank(cur);
    cards.push(nx); cur = nx;
    if (!ok) return { payout: 0, cards, status: "lost" };
    num *= BigInt(w); den *= BigInt(rest.length); wins++;
  }
  return { payout: null, cards, status: "active" };
}
