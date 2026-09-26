"""Monte Carlo sanity for the games pack using the reference algorithms (uniform draws via Python's CSPRNG-independent PRNG;
the HMAC mapping itself is cross-checked against SQL in tests/local/test_games.py)."""
import sys, os, random, math
from decimal import Decimal
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "local"))
import reference_games as g

rnd = random.Random(20260926)
N_SLOT = int(sys.argv[1]) if len(sys.argv) > 1 else 400_000


def slots():
    bet = 10; paid = 0; feats = 0; hits = 0; maxw = 0
    lens = [len(s) for s in g.STRIPS]
    for _ in range(N_SLOT):
        def spin(mult):
            stops = [rnd.randrange(n) for n in lens]
            win = g.slot_window(stops)
            lu, sc, _ = g.slot_eval(win)
            u = Decimal(lu) / 10 + (g.SCAT_PAY[min(sc, 5)] if sc >= 3 else 0)
            return u * mult, sc
        u, sc = spin(1); tot = u
        if sc >= 3:
            feats += 1; left = g.FREE_SPINS[min(sc, 5)]; aw = left
            while left:
                left -= 1; u2, sc2 = spin(g.FS_MULT); tot += u2
                if sc2 >= 3 and aw < g.MAX_FREE:
                    add = min(g.RETRIGGER, g.MAX_FREE - aw); left += add; aw += add
        p = int(tot * bet); paid += p; hits += p > 0; maxw = max(maxw, p / bet)
    print(f"SLOTS  spins={N_SLOT:,}  RTP={paid / (bet * N_SLOT) * 100:.2f}% (exact model 96.23%)  hit={hits / N_SLOT * 100:.1f}%  "
          f"feature 1/{N_SLOT / max(feats, 1):.0f}  max={maxw:.0f}x")


def mines():
    for m in (1, 3, 5, 10, 24):
        for k in (1, 3, 5):
            if k > 25 - m: continue
            # exact: P(k safe) * multiplier
            p = 1.0
            for i in range(k): p *= (25 - m - i) / (25 - i)
            print(f"MINES  m={m:2d} k={k}  P(survive)={p:.4f}  mult={float(g.mines_multiplier(m, k)):.4f}  RTP={p * float(g.mines_multiplier(m, k)) * 100:.2f}%")


def crash():
    n = 2_000_000; N = g.N
    for target in (101, 150, 200, 500, 1000, 10000):
        wins = 0
        for _ in range(n // 10):
            r = rnd.randrange(N)
            cx = max(100, min((97 * N) // (N - r), 1_000_000))
            wins += cx >= target
        p = wins / (n // 10)
        print(f"CRASH  target {target / 100:>6.2f}x  P(win)={p:.4f} (theory {min(1, 97 / target):.4f})  RTP={p * target:.2f}%")


def plinko():
    from math import comb
    for risk, t in g.PLINKO_TABLES.items():
        exact = sum(comb(12, k) * t[k] for k in range(13)) / 4096
        print(f"PLINKO {risk:6s} exact RTP={exact * 100:.3f}%  max={max(t)}x")


def horse():
    tot = sum(g.HORSE_WEIGHTS)
    for i, w in enumerate(g.HORSE_WEIGHTS):
        print(f"HORSE  #{i + 1} p={w / tot:.3f} odds={g.HORSE_ODDS[i]:.2f}  RTP={w / tot * g.HORSE_ODDS[i] * 100:.2f}%")


def higher_lower():
    # 'always pick the likelier side, cash out after 1..3 wins' with a uniformly shuffled deck
    for target in (1, 2, 3):
        paid = 0; n = 200_000
        for _ in range(n):
            d = list(range(52)); rnd.shuffle(d)
            pos = 1; cur = d[0]; path = Decimal(1); alive = True
            for _k in range(target):
                rest = [c for c in d[pos:] if g.hl_rank(c) != g.hl_rank(cur)]
                hi = sum(1 for c in rest if g.hl_rank(c) > g.hl_rank(cur)); lo = len(rest) - hi
                guess = "higher" if hi >= lo else "lower"
                while g.hl_rank(d[pos]) == g.hl_rank(cur): pos += 1
                nxt = d[pos]; pos += 1
                ok = g.hl_rank(nxt) > g.hl_rank(cur) if guess == "higher" else g.hl_rank(nxt) < g.hl_rank(cur)
                if not ok: alive = False; break
                path *= Decimal(hi if guess == "higher" else lo) / len(rest); cur = nxt
            if alive: paid += float(Decimal("0.97") / path)
        print(f"HI/LO  cash after {target}: RTP={paid / n * 100:.2f}% (theory 97%)")


if __name__ == "__main__":
    mines(); crash(); plinko(); horse(); higher_lower(); slots()
