"""Independent reference implementation of LuzBet 2.0 provably-fair mapping and game rules.
Used to cross-check the PostgreSQL engine (tests) and mirrored by the browser verifier (JS)."""
import hmac, hashlib

RED = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}


def fair_ints(server_seed: str, client_seed: str, nonce: int, moduli):
    out, cur, blk, off = [], 0, b"", 32
    for m in moduli:
        lim = (2**32 // m) * m
        while True:
            if off >= 32:
                blk = hmac.new(server_seed.encode(), f"{client_seed}:{nonce}:{cur}".encode(), hashlib.sha256).digest()
                cur += 1
                off = 0
            u = int.from_bytes(blk[off:off + 4], "big")
            off += 4
            if u < lim:
                out.append(u % m)
                break
    return out


def roulette_number(seed, client, nonce):
    return fair_ints(seed, client, nonce, [37])[0]


def shuffle(seed, client, nonce):
    d = list(range(312))
    r = fair_ints(seed, client, nonce, list(range(312, 1, -1)))
    k = 0
    for i in range(311, 0, -1):
        j = r[k]; k += 1
        d[i], d[j] = d[j], d[i]
    return d


def val(c): return min(c % 13 + 1, 10)
def hard(cs): return sum(val(c) for c in cs)
def soft(cs): return any(c % 13 == 0 for c in cs) and hard(cs) + 10 <= 21
def total(cs): return hard(cs) + (10 if soft(cs) else 0)
def is_bj(cs): return len(cs) == 2 and total(cs) == 21


def blackjack_replay(seed, client, nonce, bet, actions):
    """Replays a round from the revealed seed and the ordered player actions.
    Returns (payout, hands, dealer)."""
    d = shuffle(seed, client, nonce)
    pos = 4
    player, dealer = [d[0], d[2]], [d[1], d[3]]
    hands = [dict(cards=player, bet=bet, status="playing", split=False, splitAces=False)]
    if is_bj(dealer) or is_bj(player):
        if is_bj(dealer) and is_bj(player): return bet, hands, dealer
        if is_bj(dealer): return 0, hands, dealer
        return bet + (bet * 3) // 2, hands, dealer
    active = 0
    for a in actions:
        h = hands[active]
        assert h["status"] == "playing", f"action {a} on non-playing hand"
        if a == "hit":
            h["cards"] = h["cards"] + [d[pos]]; pos += 1
            t = total(h["cards"])
            if t > 21: h["status"] = "bust"
            elif t == 21: h["status"] = "stood"
        elif a == "stand":
            h["status"] = "stood"
        elif a == "double":
            assert len(h["cards"]) == 2
            h["bet"] *= 2; h["cards"] = h["cards"] + [d[pos]]; pos += 1
            h["status"] = "bust" if total(h["cards"]) > 21 else "stood"
        elif a == "split":
            assert len(hands) == 1 and len(h["cards"]) == 2 and val(h["cards"][0]) == val(h["cards"][1])
            aces = h["cards"][0] % 13 == 0
            c1, c2 = d[pos], d[pos + 1]; pos += 2
            new = []
            for base, c in ((h["cards"][0], c1), (h["cards"][1], c2)):
                cs = [base, c]
                new.append(dict(cards=cs, bet=h["bet"], split=True, splitAces=aces,
                                status="stood" if aces or total(cs) == 21 else "playing"))
            hands = new
        while active < len(hands) and hands[active]["status"] != "playing":
            active += 1
        if active >= len(hands):
            break
    if active < len(hands):
        return None, hands, dealer  # round still active
    if any(h["status"] != "bust" for h in hands):
        while total(dealer) < 17:
            dealer = dealer + [d[pos]]; pos += 1
    dt = total(dealer)
    pay = 0
    for h in hands:
        pt = total(h["cards"])
        if h["status"] == "bust": p = 0
        elif dt > 21 or pt > dt: p = 2 * h["bet"]
        elif pt == dt: p = h["bet"]
        else: p = 0
        pay += p
    return pay, hands, dealer
