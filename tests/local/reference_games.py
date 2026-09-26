"""Independent reference implementations for LuzBet 2.0 game pack (games_v1).
Every function takes the revealed server seed, client seed and nonce, exactly like the browser verifier."""
from math import exp, log, floor
from decimal import Decimal, getcontext
from reference import fair_ints

getcontext().prec = 50
MAX_PAYOUT = 5_000_000

# ---------------------------------------------------------------- Mines
def mines_positions(seed, client, nonce, m):
    d = list(range(25))
    r = fair_ints(seed, client, nonce, list(range(25, 1, -1)))
    k = 0
    for i in range(24, 0, -1):
        j = r[k]; k += 1
        d[i], d[j] = d[j], d[i]
    return sorted(d[:m])

from fractions import Fraction

def mines_multiplier(m, k):
    """Exact multiplier after k safe reveals with m mines: 0.97 * prod (25-i)/(25-m-i) (as a Fraction)."""
    if k == 0: return Fraction(1)
    x = Fraction(97, 100)
    for i in range(k):
        x *= Fraction(25 - i, 25 - m - i)
    return x

def mines_payout(bet, m, k):
    return min(int(bet * mines_multiplier(m, k)), MAX_PAYOUT)

# ---------------------------------------------------------------- Crash
N = 2147483647
CRASH_K = 0.00006  # multiplier(t_ms) = floor(100 * e^(k t)) / 100

def crash_x100(seed, client, nonce):
    r = fair_ints(seed, client, nonce, [N])[0]
    v = (97 * N) // (N - r)
    return max(100, min(v, 1_000_000))

def crash_multiplier_at(ms):
    return floor(100 * exp(CRASH_K * ms))

def crash_time_ms(cx100):
    # first ms at which the displayed multiplier exceeds the crash point
    return log((cx100 + 1) / 100) / CRASH_K

# ---------------------------------------------------------------- Plinko
PLINKO_ROWS = 12
PLINKO_TABLES = {
    "low":    [10, 3, 1.6, 1.4, 1.1, 0.95, 0.5, 0.95, 1.1, 1.4, 1.6, 3, 10],
    "medium": [33, 11, 4, 2, 1.1, 0.55, 0.3, 0.55, 1.1, 2, 4, 11, 33],
    "high":   [170, 24, 8, 2, 0.63, 0.2, 0.2, 0.2, 0.63, 2, 8, 24, 170],
}

def plinko_path(seed, client, nonce):
    return fair_ints(seed, client, nonce, [2] * PLINKO_ROWS)

def plinko_payout(bet, risk, path):
    mult = Decimal(str(PLINKO_TABLES[risk][sum(path)]))
    return min(int((Decimal(bet) * mult).to_integral_value(rounding="ROUND_FLOOR")), MAX_PAYOUT)

# ---------------------------------------------------------------- Horse racing
HORSE_WEIGHTS = [300, 200, 150, 120, 90, 70, 45, 25]
HORSE_ODDS = [floor(95000 / w) / 100 for w in HORSE_WEIGHTS]   # 5% "bookmaker margin"

def horse_order(seed, client, nonce):
    remaining = list(range(8))
    moduli = []
    tot = sum(HORSE_WEIGHTS)
    # draws are consumed sequentially; totals depend on previous draws, so draw one by one from the same stream
    order = []
    draws = fair_ints_stream(seed, client, nonce)
    while len(remaining) > 1:
        tot = sum(HORSE_WEIGHTS[i] for i in remaining)
        u = draws(tot)
        acc = 0
        for i in remaining:
            acc += HORSE_WEIGHTS[i]
            if u < acc:
                order.append(i); remaining.remove(i); break
    order.append(remaining[0])
    return order

def horse_payout(bets, winner):
    return sum(int((Decimal(str(HORSE_ODDS[b["h"]])) * b["a"]).to_integral_value(rounding="ROUND_FLOOR")) for b in bets if b["h"] == winner)

def fair_ints_stream(seed, client, nonce):
    """Same HMAC stream as fair_ints, but yields draws with moduli chosen on the fly."""
    import hmac, hashlib
    state = {"cur": 0, "blk": b"", "off": 32}
    def draw(m):
        lim = (2**32 // m) * m
        while True:
            if state["off"] >= 32:
                state["blk"] = hmac.new(seed.encode(), f"{client}:{nonce}:{state['cur']}".encode(), hashlib.sha256).digest()
                state["cur"] += 1; state["off"] = 0
            u = int.from_bytes(state["blk"][state["off"]:state["off"] + 4], "big"); state["off"] += 4
            if u < lim: return u % m
    return draw

# ---------------------------------------------------------------- Businka's Fortune (5x3, 10 lines)
W, S, BUS, CROWN, SEVEN, BAG, BOWL, FISH = range(8)
STRIPS = [[7, 7, 5, 3, 7, 2, 4, 5, 7, 7, 5, 1, 3, 7, 6, 7, 5, 7, 2, 4, 5, 7, 3, 7, 5],
          [6, 7, 6, 7, 4, 7, 6, 2, 3, 5, 7, 6, 4, 7, 0, 1, 6, 7, 6, 7, 4, 7, 6, 2, 3, 5, 7, 6, 4, 7],
          [6, 7, 5, 6, 7, 4, 7, 6, 2, 5, 3, 7, 6, 5, 4, 7, 0, 1, 6, 7, 5, 6, 7, 4, 5, 7, 6, 2, 3, 7, 5, 6, 4, 7, 5],
          [6, 7, 6, 7, 5, 4, 3, 7, 6, 2, 5, 7, 6, 4, 7, 5, 0, 1, 6, 3, 7, 6, 7, 5, 4, 7, 6, 2, 5, 7, 3, 6, 4, 7, 5],
          [7, 7, 5, 4, 6, 3, 0, 7, 2, 5, 7, 6, 4, 7, 5, 1, 3, 6, 7, 5, 4, 7, 0, 2, 6, 7, 5, 3, 7, 4, 6, 5]]
LINES = [[1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],[0,0,1,2,2],[2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[0,1,1,1,0]]
PAY = {BUS: {3: 50, 4: 250, 5: 1000}, CROWN: {3: 25, 4: 100, 5: 500}, SEVEN: {3: 20, 4: 75, 5: 300},
       BAG: {3: 10, 4: 40, 5: 150}, BOWL: {3: 5, 4: 20, 5: 80}, FISH: {3: 4, 4: 15, 5: 50}}
SCAT_PAY = {3: 2, 4: 10, 5: 50}
FREE_SPINS = {3: 8, 4: 10, 5: 12}
RETRIGGER = 5
MAX_FREE = 50
FS_MULT = 2
SLOT_DRAWS = (1 + MAX_FREE) * 5

def slot_line(syms):
    """Returns (line multiplier of line bet, symbol, count)."""
    lead = 0
    for s in syms:
        if s == W: lead += 1
        else: break
    best = (PAY[BUS].get(lead, 0) if lead >= 3 else 0, BUS, lead)
    base = next((s for s in syms if s != W), None)
    if base is not None and base != S:
        n = 0
        for s in syms:
            if s == base or s == W: n += 1
            else: break
        p = PAY[base].get(n, 0)
        if p > best[0]: best = (p, base, n)
    return best

def slot_window(stops):
    return [[STRIPS[r][(stops[r] + row) % len(STRIPS[r])] for row in range(3)] for r in range(5)]

def slot_eval(win):
    """win: 5 reels x 3 rows. Returns (sum of line multipliers x10 units (i.e. in line bets), scatter count, line hits)."""
    total = 0; hits = []
    for li, ln in enumerate(LINES):
        syms = [win[r][ln[r]] for r in range(5)]
        p, sym, n = slot_line(syms)
        if p: total += p; hits.append([li, sym, n, p])
    sc = sum(1 for r in range(5) for row in range(3) if win[r][row] == S)
    return total, sc, hits

def slot_round(seed, client, nonce, bet):
    draws = fair_ints(seed, client, nonce, [len(s) for s in STRIPS] * (1 + MAX_FREE))
    k = 0
    spins = []
    total_units = Decimal(0)   # payout in units of total bet
    def spin(mult):
        nonlocal k
        stops = draws[k:k + 5]; k += 5
        win = slot_window(stops)
        line_units, sc, hits = slot_eval(win)
        u = Decimal(line_units) / 10
        if sc >= 3: u += SCAT_PAY[min(sc, 5)]
        u *= mult
        spins.append({"stops": stops, "scatters": sc, "lines": hits, "units": str(u), "mult": mult})
        return u, sc
    u, sc = spin(1)
    total_units += u
    free_left = FREE_SPINS[min(sc, 5)] if sc >= 3 else 0
    awarded = free_left
    while free_left > 0:
        free_left -= 1
        u, sc = spin(FS_MULT)
        total_units += u
        if sc >= 3 and awarded < MAX_FREE:
            add = min(RETRIGGER, MAX_FREE - awarded); free_left += add; awarded += add
    payout = min(int((Decimal(bet) * total_units).to_integral_value(rounding="ROUND_FLOOR")), MAX_PAYOUT)
    return payout, spins

# ---------------------------------------------------------------- Higher / Lower v3
def hl_deck(seed, client, nonce):
    d = list(range(52))
    r = fair_ints(seed, client, nonce, list(range(52, 1, -1)))
    k = 0
    for i in range(51, 0, -1):
        j = r[k]; k += 1
        d[i], d[j] = d[j], d[i]
    return d

def hl_rank(c): return c % 13 + 2   # 2..14 (ace high)

def hl_replay(seed, client, nonce, bet, actions):
    """actions: list of 'higher' | 'lower' | 'cashout'. Returns (payout, status, cards)."""
    d = hl_deck(seed, client, nonce)
    pos = 1; cur = d[0]; cards = [cur]; path = Fraction(1)
    for a in actions:
        if a == "cashout":
            mult = min(Fraction(97, 100) / path, Fraction(10000))
            return min(int(bet * mult), MAX_PAYOUT), "cashed", cards
        rest = [c for c in d[pos:] if hl_rank(c) != hl_rank(cur)]
        higher = sum(1 for c in rest if hl_rank(c) > hl_rank(cur)); lower = len(rest) - higher
        wins = higher if a == "higher" else lower
        while hl_rank(d[pos]) == hl_rank(cur): pos += 1
        nxt = d[pos]; pos += 1
        ok = hl_rank(nxt) > hl_rank(cur) if a == "higher" else hl_rank(nxt) < hl_rank(cur)
        cards.append(nxt); cur = nxt
        if not ok: return 0, "lost", cards
        path = path * Fraction(wins, len(rest))
    return None, "active", cards
