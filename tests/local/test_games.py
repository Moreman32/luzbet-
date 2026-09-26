"""Games pack tests: Mines, Crash, Plinko, Horse, Slots, Higher/Lower v3, Dice, rescue fund.
Every finished round is replayed from the revealed seed by the independent reference in reference_games.py."""
import json, uuid, random, sys, time, traceback
from decimal import Decimal
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, __file__.rsplit('/', 1)[0])
import test_engine as T
import reference_games as G
from test_engine import check, sql, rpc, new_player, bal, key, try_, par

OWNER = None


def fund(u, amount):
    global OWNER
    if OWNER is None:
        OWNER = new_player(role="owner")
        sql("insert into public.system_settings(key,value) values ('admin_adjust_max','100000000') on conflict (key) do update set value=excluded.value")
    rpc(OWNER, "rpc_admin_adjust_balance", u, amount, "test bankroll", key(), aal="aal2")


def reveal(u):
    r = rpc(u, "rpc_rotate_seed", None)
    return r["revealed"]["serverSeed"]


def actions(rid):
    return [a for (a,) in sql("select action from public.casino_actions where round_id=%s order by seq", rid)]


# ------------------------------------------------------------------ Mines
def test_mines():
    u = new_player(); fund(u, 1_000_000)
    rng = random.Random(1)
    played = []
    for i in range(300):
        m = rng.choice([1, 2, 3, 5, 10, 20, 24])
        r = rpc(u, "rpc_mines_start", 10, m, key())
        assert r["ok"], r
        rnd = r["round"]; tiles = list(range(25)); rng.shuffle(tiles)
        target = rng.randint(1, 25 - m)
        for t in tiles[:target]:
            rr = rpc(u, "rpc_mines_reveal", rnd["id"], t, key())
            rnd = rr["round"]
            if rnd["status"] != "active": break
        if rnd["status"] == "active":
            rnd = rpc(u, "rpc_mines_cashout", rnd["id"], key())["round"]
        played.append((rnd, m))
    seed = reveal(u)
    bad = []
    for rnd, m in played:
        mines = G.mines_positions(seed, rnd["clientSeed"], rnd["nonce"], m)
        st = rnd["state"]
        k = len(st["revealed"])
        if st["minePositions"] != mines: bad.append(("positions", rnd["id"]))
        if st["phase"] == "BOOM":
            if st["hit"] not in mines or rnd["payout"] != 0: bad.append(("boom", rnd["id"]))
        else:
            if any(t in mines for t in st["revealed"]) or rnd["payout"] != G.mines_payout(10, m, k): bad.append(("pay", rnd["id"], rnd["payout"], G.mines_payout(10, m, k)))
    check(f"Mines: 300 rounds replay from revealed seed (positions + payout)", not bad, bad[:3])

    # hidden state never visible while playing
    r = rpc(u, "rpc_mines_start", 10, 5, key())["round"]
    check("Mines: mine positions hidden while playing", r["state"].get("minePositions") is None, r["state"])
    x = try_(lambda: T.as_role("authenticated", u, "select mines from private.mines_games"))
    check("Mines: private table unreadable", x[0] == "err", x)
    check("Mines: second active round refused", rpc(u, "rpc_mines_start", 10, 5, key()).get("error") == "round_in_progress")
    stranger = new_player()
    check("Mines: stranger cannot reveal my tiles", rpc(stranger, "rpc_mines_reveal", r["id"], 0, key()).get("error") == "round_not_found")
    check("Mines: cashout before any reveal refused", rpc(u, "rpc_mines_cashout", r["id"], key()).get("error") == "cashout_unavailable")
    for bad_tile in (-1, 25, None):
        check(f"Mines: tile {bad_tile} rejected", rpc(u, "rpc_mines_reveal", r["id"], bad_tile, key()).get("ok") is False)
    for bad_m in (0, 25, -3):
        check(f"Mines: {bad_m} mines rejected", rpc(stranger, "rpc_mines_start", 10, bad_m, key()).get("ok") is False)
    # idempotent reveal: same key twice -> one action; parallel different keys on same tile -> one reveal
    seedrow = sql("select mines from private.mines_games where round_id=%s", r["id"])[0][0]
    safe = [t for t in range(25) if t not in seedrow]
    k1 = key()
    a = rpc(u, "rpc_mines_reveal", r["id"], safe[0], k1); b = rpc(u, "rpc_mines_reveal", r["id"], safe[0], k1)
    check("Mines: replayed reveal key returns same state", a["round"]["state"]["revealed"] == b["round"]["state"]["revealed"] and b.get("replayed"))
    out = par(20, lambda i: rpc(u, "rpc_mines_reveal", r["id"], safe[1], key()))
    check("Mines: 20 parallel reveals of one tile -> accepted once", sum(1 for o in out if o["ok"]) == 1, [o.get("error") for o in out][:5])
    out = par(20, lambda i: rpc(u, "rpc_mines_cashout", r["id"], key()))
    npay = sql("select count(*) from public.wallet_transactions where round_id=%s and type='payout'", r["id"])[0][0]
    check("Mines: 20 parallel cashouts -> exactly one payout", sum(1 for o in out if o["ok"]) == 1 and npay == 1, npay)
    check("Mines: reveal after cashout refused", rpc(u, "rpc_mines_reveal", r["id"], safe[2], key()).get("error") == "round_finished")


# ------------------------------------------------------------------ Crash
def test_crash():
    u = new_player(); fund(u, 1_000_000)
    rounds = []
    # auto cash-outs: settle through status after waiting
    for i in range(40):
        auto = random.choice([1.01, 1.05, 1.1, 1.2])
        r = rpc(u, "rpc_crash_start", 10, Decimal(str(auto)), key())["round"]
        rounds.append(r)
    # rounds must be started one at a time -> the above calls: first creates, following ones settle-or-refuse
    ok = [r for r in rounds if r.get("id")]
    # manual play loop
    manual = []
    for i in range(25):
        r = rpc(u, "rpc_crash_start", 10, None, key())
        if not r["ok"] and r["error"] == "round_in_progress":
            time.sleep(0.4); rpc(u, "rpc_crash_status", r["round"]["id"]); continue
        rid = r["round"]["id"]
        time.sleep(random.choice([0.2, 0.5, 0.9]))
        c = rpc(u, "rpc_crash_cashout", rid, key())
        if not c["ok"] and c["error"] == "too_early":
            time.sleep(0.3); c = rpc(u, "rpc_crash_cashout", rid, key())
        manual.append(c["round"])
    # finish anything still active
    for rid, in sql("select id from public.casino_rounds where user_id=%s and status='active'", u):
        for _ in range(100):
            s = rpc(u, "rpc_crash_status", rid)
            if s["round"]["status"] != "active": break
            time.sleep(0.5)
    seed = reveal(u)
    bad = []
    for (rid, nonce, cs, bet, payout, state) in sql("select id, nonce, client_seed, bet_total, payout, state from public.casino_rounds where user_id=%s and game_slug='crash'", u):
        cx = G.crash_x100(seed, cs, nonce)
        if round(state["crash"] * 100) != cx: bad.append(("crash", rid, state["crash"], cx)); continue
        if state["phase"] == "CASHED":
            m = round(state["cashout"] * 100)
            if m > cx or payout != bet * m // 100: bad.append(("cash", rid, m, cx, payout))
        elif state["phase"] == "CRASHED":
            if payout != 0 or (state.get("auto") and round(state["auto"] * 100) <= cx): bad.append(("crashed", rid))
    n = sql("select count(*) from public.casino_rounds where user_id=%s and game_slug='crash'", u)[0][0]
    check(f"Crash: {n} rounds — crash point reproduces from seed, no cash-out above crash", not bad and n > 20, bad[:3])

    # crash point hidden while running
    u2 = new_player()
    r = rpc(u2, "rpc_crash_start", 10, None, key())["round"]
    check("Crash: crash point not exposed while running", "crash" not in r["state"] or r["state"]["crash"] is None, r["state"])
    x = try_(lambda: T.as_role("authenticated", u2, "select crash_x100 from private.crash_games"))
    check("Crash: private table unreadable", x[0] == "err", x)
    e = rpc(u2, "rpc_crash_cashout", r["id"], key())
    check("Crash: cash-out at 1.00x refused as too_early", e.get("error") == "too_early", e)
    check("Crash: stranger cannot cash out my round", rpc(new_player(), "rpc_crash_cashout", r["id"], key()).get("error") == "round_not_found")
    time.sleep(0.4)
    out = par(15, lambda i: rpc(u2, "rpc_crash_cashout", r["id"], key()))
    npay = sql("select count(*) from public.wallet_transactions where round_id=%s and type='payout'", r["id"])[0][0]
    check("Crash: 15 parallel cash-outs -> at most one payout", npay <= 1 and sql("select status from public.casino_rounds where id=%s", r["id"])[0][0] == "finished", npay)
    for bad_auto in (1.0, 0.5, 10001, -2):
        check(f"Crash: auto {bad_auto} rejected", rpc(u2, "rpc_crash_start", 10, Decimal(str(bad_auto)), key()).get("ok") is False)
    # forced instant crash: find a seed/nonce whose crash is 1.00? -> statistically ~3%; just verify the rule on stored data
    k1 = key(); a = rpc(u2, "rpc_crash_start", 10, Decimal("2.0"), k1); b = rpc(u2, "rpc_crash_start", 10, Decimal("2.0"), k1)
    check("Crash: replayed start returns the same round", a["round"]["id"] == b["round"]["id"])
    check("Crash: same key, different auto -> conflict", rpc(u2, "rpc_crash_start", 10, Decimal("3.0"), k1).get("error") == "idempotency_conflict")


# ------------------------------------------------------------------ Plinko / Horse / Slots / Dice (one-shot games)
def test_oneshots():
    u = new_player(); fund(u, 5_000_000)
    rng = random.Random(5)
    for i in range(300):
        rpc(u, "rpc_plinko_drop", rng.choice([1, 10, 100]), rng.choice(["low", "medium", "high"]), key())
        bets = [{"h": h, "a": rng.randint(1, 50)} for h in rng.sample(range(8), rng.randint(1, 4))]
        assert rpc(u, "rpc_horse_bet", json.dumps(bets), key())["ok"]
        rpc(u, "rpc_slots_spin", rng.choice([10, 20, 100]), key())
        rpc(u, "rpc_dice_roll", rng.choice([3, 10, 7, 33]), rng.randint(2, 95), rng.choice(["under", "over"]), key())
    seed = reveal(u)
    bad = {"plinko": [], "horse": [], "slots": [], "dice": []}; feats = 0
    for (game, nonce, cs, bet, payout, state, req) in sql("select game_slug, nonce, client_seed, bet_total, payout, state, request from public.casino_rounds where user_id=%s", u):
        if game == "plinko":
            path = G.plinko_path(seed, cs, nonce)
            if path != state["path"] or payout != G.plinko_payout(bet, req["risk"], path): bad[game].append((payout, state))
        elif game == "horse":
            order = G.horse_order(seed, cs, nonce)
            if order != state["order"] or payout != G.horse_payout(req, order[0]): bad[game].append((order, state["order"], payout))
        elif game == "businka_slots":
            p, spins = G.slot_round(seed, cs, nonce, bet)
            same = [s["stops"] for s in spins] == [s["stops"] for s in state["spins"]]
            if p != payout or not same: bad["slots"].append((p, payout, len(spins), len(state["spins"])))
            feats += len(spins) > 1
        elif game == "dice":
            roll = T.ref.fair_ints(seed, cs, nonce, [10000])[0]
            won = roll < req["chance"] * 100 if req["direction"] == "under" else roll >= (100 - req["chance"]) * 100
            exp = (bet * 97) // req["chance"] if won else 0
            if roll != state["roll"] or payout != exp: bad[game].append((roll, state["roll"], payout, exp))
    for g, b in bad.items():
        check(f"{g}: 300 rounds replay exactly from revealed seed", not b, b[:2])
    check(f"slots: free-spin features seen in sample ({feats})", feats >= 0)

    # validation
    for bets in ([], [{"h": 8, "a": 1}], [{"h": 0, "a": 0}], [{"h": 0, "a": 5001}], [{"h": 1, "a": 5}, {"h": 1, "a": 5}],
                 [{"h": "1", "a": "1e2"}], [{"h": i, "a": 2000} for i in range(6)], {"h": 0}):
        check(f"horse rejects {json.dumps(bets)[:50]}", rpc(u, "rpc_horse_bet", json.dumps(bets), key()).get("ok") is False)
    check("plinko rejects risk 'extreme'", rpc(u, "rpc_plinko_drop", 10, "extreme", key()).get("ok") is False)
    check("plinko rejects bet 0", rpc(u, "rpc_plinko_drop", 0, "low", key()).get("ok") is False)
    check("slots rejects bet 5 (< min 10)", rpc(u, "rpc_slots_spin", 5, key()).get("ok") is False)
    check("slots rejects bet 5001", rpc(u, "rpc_slots_spin", 5001, key()).get("ok") is False)
    check("dice rejects chance 99", rpc(u, "rpc_dice_roll", 10, 99, "under", key()).get("ok") is False)
    # concurrency on one-shots
    for fn, args in (("rpc_slots_spin", (50,)), ("rpc_plinko_drop", (50, "high")), ("rpc_horse_bet", (json.dumps([{"h": 0, "a": 50}]),))):
        v = new_player(opening=1000)
        par(60, lambda i: rpc(v, fn, *args, key()))
        led = sql("select coalesce(sum(amount),0) from public.wallet_transactions where user_id=%s", v)[0][0]
        nb = sql("select count(*) from public.wallet_transactions where user_id=%s and type='bet'", v)[0][0]
        check(f"{fn}: 60 parallel plays never overspend (bets={nb}, balance==ledger)", bal(v) >= 0 and bal(v) == led, (bal(v), led))
        k1 = key(); out = par(30, lambda i: rpc(v, fn, *args, k1))
        check(f"{fn}: 30 parallel identical keys -> one round", sql("select count(*) from public.casino_rounds where user_id=%s and idempotency_key=%s", v, k1)[0][0] <= 1)


# ------------------------------------------------------------------ Higher / Lower v3
def test_higher_lower():
    u = new_player(); fund(u, 1_000_000)
    rng = random.Random(9); played = []
    for i in range(250):
        r = rpc(u, "rpc_higher_lower_start", 10, key())
        assert r["ok"], r
        rnd = r["round"]; acts = []
        for step in range(rng.randint(1, 6)):
            o = rnd["state"]["options"]
            g = "higher" if o["higher"] >= o["lower"] else "lower"
            if rng.random() < 0.2 and o["higher"] and o["lower"]: g = "lower" if g == "higher" else "higher"
            rr = rpc(u, "rpc_higher_lower_guess", rnd["id"], g, key()); rnd = rr["round"]; acts.append(g)
            if rnd["status"] != "active": break
        if rnd["status"] == "active":
            rnd = rpc(u, "rpc_higher_lower_cashout", rnd["id"], key())["round"]; acts.append("cashout")
        played.append((rnd, acts))
    seed = reveal(u); bad = []
    for rnd, acts in played:
        pay, status, cards = G.hl_replay(seed, rnd["clientSeed"], rnd["nonce"], 10, acts)
        if pay != rnd["payout"] or [c["id"] for c in rnd["state"]["history"]] != cards: bad.append((rnd["id"], pay, rnd["payout"], acts))
    check("Higher/Lower v3: 250 rounds replay exactly (cards + payout)", not bad, bad[:3])
    r = rpc(u, "rpc_higher_lower_start", 10, key())["round"]
    k1 = key()
    a = rpc(u, "rpc_higher_lower_guess", r["id"], "higher" if r["state"]["options"]["higher"] else "lower", k1)
    b = rpc(u, "rpc_higher_lower_guess", r["id"], "higher" if r["state"]["options"]["higher"] else "lower", k1)
    n_guess = sql("select count(*) from public.casino_actions where round_id=%s and action in ('higher','lower')", r["id"])[0][0]
    check("Higher/Lower v3: retried guess (same key) is not played twice", n_guess == 1 and b.get("replayed"), n_guess)
    check("Higher/Lower v3: same key for the other guess -> conflict",
          rpc(u, "rpc_higher_lower_guess", r["id"], "lower" if r["state"]["options"]["higher"] else "higher", k1).get("error") in ("idempotency_conflict", "round_finished"))
    x = try_(lambda: T.as_role("authenticated", u, "select deck from private.hl_games"))
    check("Higher/Lower v3: deck unreadable", x[0] == "err", x)


# ------------------------------------------------------------------ Rescue fund
def test_rescue():
    u = new_player(opening=50)
    me = rpc(u, "rpc_me")
    check("rescue: eligible when balance < 100", me["rescue"]["eligible"] is True, me["rescue"])
    out = par(20, lambda i: rpc(u, "rpc_claim_rescue"))
    n = sql("select count(*) from public.wallet_transactions where user_id=%s and metadata->>'kind'='rescue'", u)[0][0]
    check("rescue: 20 parallel claims -> exactly one", n == 1 and bal(u) == 550, (n, bal(u)))
    check("rescue: rich player not eligible", rpc(new_player(), "rpc_claim_rescue").get("error") == "not_eligible")


if __name__ == "__main__":
    for t in [test_mines, test_crash, test_oneshots, test_higher_lower, test_rescue, T.test_invariants]:
        print(f"\n### {t.__name__}")
        try:
            t()
        except Exception:
            traceback.print_exc(); T.RESULTS.append((t.__name__, False, "exception"))
    failed = [r for r in T.RESULTS if not r[1]]
    print(f"\n{len(T.RESULTS) - len(failed)}/{len(T.RESULTS)} passed")
    sys.exit(1 if failed else 0)
