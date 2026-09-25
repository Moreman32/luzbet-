"""Offline fairness/math simulation for LuzBet 2.0 (never touches the database).
Usage: python3 tests/math/simulate.py [roulette_spins] [blackjack_rounds]"""
import sys, os, math, secrets, collections, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "local"))
import reference as ref

SPINS = int(sys.argv[1]) if len(sys.argv) > 1 else 1_000_000
HANDS = int(sys.argv[2]) if len(sys.argv) > 2 else 200_000


def roulette():
    seed, client = secrets.token_hex(32), "sim"
    cnt = collections.Counter()
    t = time.time()
    for n in range(SPINS):
        cnt[ref.roulette_number(seed, client, n)] += 1
    exp = SPINS / 37
    chi2 = sum((cnt[i] - exp) ** 2 / exp for i in range(37))
    red = sum(cnt[i] for i in ref.RED)
    # observed RTP of fixed strategies from the same outcomes
    rtp_straight17 = cnt[17] * 36 / SPINS
    rtp_red = red * 2 / SPINS
    rtp_dozen1 = sum(cnt[i] for i in range(1, 13)) * 3 / SPINS
    se_red = math.sqrt((18 / 37) * (19 / 37) / SPINS) * 2
    print(f"ROULETTE  spins={SPINS:,}  time={time.time()-t:.0f}s")
    print(f"  chi2(df=36)={chi2:.1f}  (p99 crit 58.6)  -> {'OK' if chi2 < 58.6 else 'CHECK'}")
    print(f"  zero freq={cnt[0]/SPINS:.5f} (theory {1/37:.5f})")
    print(f"  RTP red={rtp_red*100:.3f}%  dozen1={rtp_dozen1*100:.3f}%  straight17={rtp_straight17*100:.3f}%  theory=97.297%  (±2σ red {2*se_red*100:.3f}%)")


# --- blackjack basic strategy for 6D S17 DAS, no surrender ---------------------------
def basic(cards, up, can_double, can_split):
    up = min(up % 13 + 1, 10); up = 11 if up == 1 else up
    t, soft = ref.total(cards), ref.soft(cards)
    if can_split and len(cards) == 2 and ref.val(cards[0]) == ref.val(cards[1]):
        v = ref.val(cards[0])
        if v == 1 or v == 8: return "split"
        if v in (2, 3, 7) and up <= 7: return "split"
        if v == 6 and up <= 6: return "split"
        if v == 9 and up not in (7, 10, 11): return "split"
        if v == 4 and up in (5, 6): return "split"
    if soft:
        if t >= 19: return "stand"
        if t == 18: return "double" if can_double and 3 <= up <= 6 else ("stand" if up <= 8 else "hit")
        if t == 17: return "double" if can_double and 3 <= up <= 6 else "hit"
        if t in (15, 16): return "double" if can_double and 4 <= up <= 6 else "hit"
        return "double" if can_double and 5 <= up <= 6 else "hit"
    if t >= 17: return "stand"
    if 13 <= t <= 16: return "stand" if up <= 6 else "hit"
    if t == 12: return "stand" if 4 <= up <= 6 else "hit"
    if t == 11: return "double" if can_double else "hit"
    if t == 10: return "double" if can_double and up <= 9 else "hit"
    if t == 9: return "double" if can_double and 3 <= up <= 6 else "hit"
    return "hit"


def blackjack():
    seed = secrets.token_hex(32)
    bet, wagered, paid = 10, 0, 0
    t = time.time()
    for n in range(HANDS):
        d = ref.shuffle(seed, "sim", n)
        actions = []
        # drive the reference engine step by step using basic strategy
        while True:
            pay, hands, dealer = ref.blackjack_replay(seed, "sim", n, bet, actions)
            if pay is not None: break
            h = next(h for h in hands if h["status"] == "playing")
            a = basic(h["cards"], dealer[0], len(h["cards"]) == 2 and not h["splitAces"], len(hands) == 1)
            actions.append(a)
        wagered += sum(h["bet"] for h in hands) if pay is not None and hands else bet
        paid += pay
    rtp = paid / wagered
    print(f"BLACKJACK rounds={HANDS:,}  time={time.time()-t:.0f}s")
    print(f"  basic-strategy RTP={rtp*100:.3f}% (published expectation for these rules ≈ 99.3–99.6%; σ per round ≈1.15 bets -> ±{2*1.15/math.sqrt(HANDS)*100:.2f}% at 2σ)")


if __name__ == "__main__":
    roulette()
    blackjack()
