"""LuzBet 2.0 engine tests against a local Supabase-like Postgres (tests/local/reset_db.sh).
Every RPC runs in its own transaction as role `authenticated` with JWT claims, like PostgREST does."""
import json, uuid, random, sys, hashlib, time, traceback
from concurrent.futures import ThreadPoolExecutor
import psycopg
sys.path.insert(0, __file__.rsplit('/', 1)[0])
import reference as ref

DSN = "host=/tmp port=5499 user=postgres dbname=lb2"
RESULTS = []


def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))


def sql(q, *a):
    with psycopg.connect(DSN, autocommit=True) as c:
        cur = c.execute(q, a)
        return cur.fetchall() if cur.description else None


def as_role(role, uid, q, args=(), aal="aal1"):
    with psycopg.connect(DSN) as c:
        c.execute(f"set local role {role}")
        claims = {"role": role, "aal": aal}
        if uid: claims["sub"] = str(uid)
        c.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(claims),))
        cur = c.execute(q, args)
        res = cur.fetchall() if cur.description else None
        c.commit()
        return res


def rpc(uid, fn, *args, aal="aal1"):
    ph = ",".join(["%s"] * len(args))
    return as_role("authenticated", uid, f"select public.{fn}({ph})", args, aal)[0][0]


def try_(f):
    try:
        return ("ok", f())
    except Exception as e:
        return ("err", str(e).split("\n")[0])


def new_player(name=None, role="player", opening=1000):
    uid = uuid.uuid4()
    name = name or "p" + uuid.uuid4().hex[:10]
    sql("insert into auth.users(id,email,aud,role) values (%s,%s,'authenticated','authenticated')", uid, f"p_{uid.hex[:16]}@players.luzbet.invalid")
    as_role("service_role", None, "select public.svc_create_profile(%s,%s,%s,%s,%s::public.app_role,%s)", (None, uid, name, name.title(), role, opening))
    return uid


def bal(uid):
    return sql("select balance from public.wallets where user_id=%s", uid)[0][0]


def key():
    return "k-" + uuid.uuid4().hex


def par(n, f):
    with ThreadPoolExecutor(max_workers=n) as ex:
        return list(ex.map(f, range(n)))


# ---------------------------------------------------------------- 1. access matrix
def test_access():
    u = new_player()
    other = new_player()
    tables = ["profiles", "wallets", "wallet_transactions", "fair_seeds", "casino_rounds", "casino_actions", "daily_claims",
              "game_definitions", "game_rule_versions", "system_settings", "admin_audit_log", "security_events"]
    for t in tables:
        r = try_(lambda: as_role("anon", None, f"select count(*) from public.{t}"))
        check(f"anon cannot SELECT {t}", r[0] == "err", r)
        for stmt in [f"insert into public.{t} default values", f"update public.{t} set created_at=created_at" if t not in ("wallets","game_definitions","game_rule_versions","system_settings") else f"delete from public.{t}", f"delete from public.{t}"]:
            r = try_(lambda: as_role("authenticated", u, stmt))
            check(f"authenticated cannot write {t}: {stmt.split()[0]}", r[0] == "err", r)
    for t in ["profiles", "wallets", "wallet_transactions", "fair_seeds", "casino_rounds"]:
        col = "id" if t == "profiles" else "user_id"
        n = as_role("authenticated", u, f"select count(*) from public.{t} where {col} <> %s", (u,))[0][0]
        check(f"RLS hides other players' {t}", n == 0, n)
    for t in ["system_settings", "admin_audit_log", "security_events"]:
        r = try_(lambda: as_role("authenticated", u, f"select count(*) from public.{t}"))
        check(f"authenticated cannot read {t}", r[0] == "err", r)
    for q in ["select private.post_tx(%s, 1000000, 'bonus', 'x-hack-key', null, '{}')",
              "select * from private.fair_seed_secrets",
              "select public.svc_create_profile(null,%s,'hacker','h')",
              "select public.svc_login_lookup('x')"]:
        args = (u,) if "%s" in q else ()
        r = try_(lambda: as_role("authenticated", u, q, args))
        check(f"authenticated denied: {q[:45]}", r[0] == "err", r)
        r = try_(lambda: as_role("anon", None, q, args))
        check(f"anon denied: {q[:45]}", r[0] == "err", r)
    r = try_(lambda: as_role("anon", None, "select public.rpc_me()"))
    check("anon cannot call rpc_me", r[0] == "err", r)
    r = try_(lambda: rpc(uuid.uuid4(), "rpc_me"))
    check("JWT with unknown sub rejected", r[0] == "err" and "no_profile" in r[1], r)
    # service_role (Edge Functions) cannot touch tables or private either
    r = try_(lambda: as_role("service_role", None, "update public.wallets set balance = 1"))
    check("service_role cannot UPDATE wallets", r[0] == "err", r)
    r = try_(lambda: as_role("service_role", None, "delete from public.wallet_transactions"))
    check("service_role cannot DELETE ledger", r[0] == "err", r)
    # even the owner role (postgres) cannot rewrite history
    r = try_(lambda: sql("update public.wallet_transactions set amount = amount where user_id=%s", u))
    check("postgres cannot UPDATE ledger (trigger)", r[0] == "err" and "immutable" in r[1], r)
    r = try_(lambda: sql("update public.wallets set balance = 999999 where user_id=%s", u))
    check("postgres cannot UPDATE wallet outside ledger (trigger)", r[0] == "err" and "outside_ledger" in r[1], r)
    r = try_(lambda: sql("truncate public.wallet_transactions cascade"))
    check("TRUNCATE ledger blocked", r[0] == "err", r)
    # disabled account
    sql("update public.profiles set status='disabled' where id=%s", other)
    r = try_(lambda: rpc(other, "rpc_roulette_spin", json.dumps([{"t": "color", "v": "red", "a": 1}]), key()))
    check("disabled account cannot play", r[0] == "err" and "account_disabled" in r[1], r)


# ---------------------------------------------------------------- 2. roulette
def spin(u, bets, k=None):
    return rpc(u, "rpc_roulette_spin", json.dumps(bets), k or key())


def test_roulette_validation():
    u = new_player()
    bad = [
        [], [{"t": "straight", "n": [37], "a": 1}], [{"t": "straight", "n": [-1], "a": 1}],
        [{"t": "split", "n": [3, 4], "a": 1}], [{"t": "split", "n": [1, 5], "a": 1}], [{"t": "split", "n": [34, 37], "a": 1}],
        [{"t": "street", "n": [2, 3, 4], "a": 1}], [{"t": "corner", "n": [3, 4, 6, 7], "a": 1}],
        [{"t": "corner", "n": [33, 34, 36, 37], "a": 1}], [{"t": "sixline", "n": [2, 3, 4, 5, 6, 7], "a": 1}],
        [{"t": "column", "v": "4", "a": 1}], [{"t": "color", "v": "green", "a": 1}],
        [{"t": "straight", "n": [1], "a": 0}], [{"t": "straight", "n": [1], "a": -5}], [{"t": "straight", "n": [1], "a": 1.5}],
        [{"t": "straight", "n": [1], "a": "1e3"}], [{"t": "straight", "n": [1], "a": 5001}],
        [{"t": "straight", "n": ["x"], "a": 1}], [{"t": "straight", "n": [1, 1], "a": 1}],
        [{"t": "straight", "n": [1], "a": 99999999999}], [{"t": "evil"}], {"not": "array"},
        [{"t": "dozen", "v": 1, "a": 5000}, {"t": "dozen", "v": 2, "a": 5000}, {"t": "dozen", "v": 3, "a": 1}],
        [{"t": "straight", "n": [1], "a": 1}] * 61,
    ]
    before = bal(u)
    for b in bad:
        r = rpc(u, "rpc_roulette_spin", json.dumps(b), key())
        check(f"roulette rejects {json.dumps(b)[:60]}", r["ok"] is False, r)
    check("rejected bets did not change balance", bal(u) == before)
    good = [
        {"t": "straight", "n": [0], "a": 1}, {"t": "split", "n": [0, 1], "a": 1}, {"t": "split", "n": [2, 3], "a": 1},
        {"t": "split", "n": [33, 36], "a": 1}, {"t": "street", "n": [0, 2, 3], "a": 1}, {"t": "street", "n": [34, 35, 36], "a": 1},
        {"t": "corner", "n": [0, 1, 2, 3], "a": 1}, {"t": "corner", "n": [32, 33, 35, 36], "a": 1},
        {"t": "sixline", "n": [31, 32, 33, 34, 35, 36], "a": 1}, {"t": "column", "v": "3", "a": 1}, {"t": "dozen", "v": "2", "a": 1},
        {"t": "color", "v": "black", "a": 1}, {"t": "parity", "v": "odd", "a": 1}, {"t": "half", "v": "high", "a": 1},
    ]
    r = spin(u, good)
    check("roulette accepts every legal bet type", r["ok"] is True, r)
    # payout arithmetic
    n = r["round"]["state"]["number"]
    exp = 0
    for line in r["round"]["state"]["lines"]:
        if n in line["n"]: exp += line["a"] * (line["ratio"] + 1)
    check("roulette payout = sum(stake*(ratio+1)) for covered lines", r["round"]["payout"] == exp, (n, exp, r["round"]["payout"]))
    check("balance after spin matches", bal(u) == before - 14 + exp)


def test_roulette_fairness_and_math():
    u = new_player(opening=1000)
    me = rpc(u, "rpc_me")
    commit_hash = me["seed"]["serverSeedHash"]
    rounds = []
    for i in range(400):
        r = spin(u, [{"t": "color", "v": "red", "a": 1}])
        if not r["ok"]:
            rpc(u, "rpc_claim_daily"); continue
        rounds.append(r["round"])
    rot = rpc(u, "rpc_rotate_seed", "my-new-client-seed")
    rv = rot["revealed"]
    check("revealed seed hashes to the commitment shown before betting",
          hashlib.sha256(rv["serverSeed"].encode()).hexdigest() == commit_hash == rv["serverSeedHash"])
    mism = [x for x in rounds if ref.roulette_number(rv["serverSeed"], x["clientSeed"], x["nonce"]) != x["state"]["number"]]
    check(f"all {len(rounds)} roulette results reproduce from revealed seed (reference impl)", not mism, mism[:2])
    nonces = [x["nonce"] for x in rounds]
    check("nonces are consecutive from 0", nonces == list(range(len(nonces))), nonces[:5])
    check("new seed uses requested client seed", rot["seed"]["clientSeed"] == "my-new-client-seed")
    # revealed seed is readable by its owner via RLS, secret of active seed is not
    rows = as_role("authenticated", u, "select status, server_seed is not null from public.fair_seeds order by created_at")
    check("fair_seeds: revealed has seed, active has none", rows == [("revealed", True), ("active", False)], rows)


def test_roulette_concurrency():
    for n in (10, 50, 100):
        u = new_player(opening=1000)
        out = par(n, lambda i: spin(u, [{"t": "straight", "n": [i % 37], "a": 50}]))
        oks = sum(1 for o in out if o["ok"])
        insuff = sum(1 for o in out if not o["ok"] and o["error"] == "insufficient_funds")
        b = bal(u)
        led = sql("select coalesce(sum(amount),0) from public.wallet_transactions where user_id=%s", u)[0][0]
        check(f"{n} parallel spins: never negative, balance == ledger sum", b >= 0 and b == led, (oks, insuff, b, led))
        nonces = sql("select array_agg(nonce order by nonce) from public.casino_rounds where user_id=%s", u)[0][0] or []
        check(f"{n} parallel spins: unique consecutive nonces", nonces == list(range(len(nonces))), nonces[:10])
    u = new_player()
    k = key()
    out = par(50, lambda i: try_(lambda: spin(u, [{"t": "color", "v": "red", "a": 10}], k)))
    ids = {o[1]["round"]["id"] for o in out if o[0] == "ok" and o[1]["ok"]}
    errs = [o for o in out if o[0] == "err" or not o[1]["ok"]]
    nb = sql("select count(*) from public.wallet_transactions where user_id=%s and type='bet'", u)[0][0]
    check("50 parallel identical requests (same key) -> 1 round, 1 debit, no errors", len(ids) == 1 and nb == 1 and not errs, (ids, nb, errs[:2]))
    r = spin(u, [{"t": "color", "v": "black", "a": 10}], k)
    check("same key + different payload -> idempotency_conflict", r.get("error") == "idempotency_conflict", r)
    out = par(20, lambda i: spin(u, [{"t": "straight", "n": [i], "a": 10}], "same-key-diff-" + "x" * 8))
    rounds = sql("select count(*) from public.casino_rounds where user_id=%s and idempotency_key=%s", u, "same-key-diff-" + "x" * 8)[0][0]
    confl = sum(1 for o in out if not o["ok"] and o["error"] == "idempotency_conflict")
    check("20 parallel same key, different payloads -> 1 round, 19 conflicts", rounds == 1 and confl == 19, (rounds, confl))


# ---------------------------------------------------------------- 3. blackjack
def bj_play(u, strategy_rng, max_steps=12):
    r = rpc(u, "rpc_blackjack_start", 10, key())
    if not r["ok"]:
        return r
    rnd = r["round"]
    actions = []
    steps = 0
    while rnd["status"] == "active" and steps < max_steps:
        allowed = rnd["state"]["allowed"]
        h = rnd["state"]["hands"][rnd["state"]["active"]]
        if "split" in allowed and strategy_rng.random() < 0.8: a = "split"
        elif "double" in allowed and strategy_rng.random() < 0.25: a = "double"
        elif h["total"] < 16 and strategy_rng.random() < 0.85: a = "hit"
        else: a = "stand"
        rr = rpc(u, "rpc_blackjack_action", rnd["id"], a, key())
        if not rr["ok"]:
            return {"ok": False, "error": rr["error"], "round": rnd}
        actions.append(a)
        rnd = rr["round"]
        steps += 1
    return {"ok": True, "round": rnd, "actions": actions}


def test_blackjack():
    u = new_player(opening=1000)
    sql("insert into public.system_settings(key,value) values ('admin_adjust_max','100000000') on conflict (key) do update set value=excluded.value")
    admin = new_player(role="owner")
    rpc(admin, "rpc_admin_adjust_balance", u, 5_000_000, "test bankroll", key(), aal="aal2")
    rng = random.Random(7)
    played = []
    for i in range(1500):
        res = bj_play(u, rng)
        if not res["ok"]:
            check("blackjack round completes", False, res); return
        played.append(res)
    rot = rpc(u, "rpc_rotate_seed", None)
    seed = rot["revealed"]["serverSeed"]
    bad = []
    splits = doubles = bjs = 0
    for p in played:
        r = p["round"]
        pay, hands, dealer = ref.blackjack_replay(seed, r["clientSeed"], r["nonce"], 10, p["actions"])
        st = r["state"]
        if pay != r["payout"] or [h["cards"] for h in hands] != [h["cards"] for h in st["hands"]] or (pay is not None and dealer != st["dealer"] and len(st["dealer"]) > 2):
            bad.append((r["id"], pay, r["payout"], p["actions"]))
        splits += "split" in p["actions"]; doubles += "double" in p["actions"]
        bjs += any(h.get("result") == "blackjack" for h in st["hands"])
    check(f"1500 blackjack rounds replay exactly from revealed seed (splits={splits}, doubles={doubles}, naturals={bjs})", not bad, bad[:3])
    bets = sql("select coalesce(sum(-amount),0) from public.wallet_transactions where user_id=%s and type='bet'", u)[0][0]
    tot = sql("select coalesce(sum(bet_total),0) from public.casino_rounds where user_id=%s", u)[0][0]
    check("blackjack: sum of bet transactions == sum(round.bet_total) incl. doubles/splits", bets == tot, (bets, tot))

    # hidden info: during an active round the dealer hole card is never exposed to the player
    u2 = new_player()
    while True:
        r = rpc(u2, "rpc_blackjack_start", 10, key())
        if r["round"]["status"] == "active": break
        if not r["ok"]: break
    st = r["round"]["state"]
    visible = json.dumps(as_role("authenticated", u2, "select state, request from public.casino_rounds where id=%s", (r["round"]["id"],)))
    hole = sql("select dealer[2] from private.blackjack_games where round_id=%s", r["round"]["id"])[0][0]
    check("active blackjack: player sees only 1 dealer card", len(st["dealer"]) == 1 and st["holeHidden"] is True, st)
    r2 = try_(lambda: as_role("authenticated", u2, "select deck from private.blackjack_games"))
    check("player cannot read the shoe", r2[0] == "err", r2)
    # invalid transitions / foreign round / double replay
    stranger = new_player()
    rr = rpc(stranger, "rpc_blackjack_action", r["round"]["id"], "hit", key())
    check("other player cannot act on my round", rr.get("error") == "round_not_found", rr)
    rr = rpc(u2, "rpc_blackjack_action", r["round"]["id"], "fly", key())
    check("unknown action rejected", rr.get("error") == "invalid_action", rr)
    r3 = rpc(u2, "rpc_blackjack_start", 10, key())
    check("second concurrent blackjack round refused (resume instead)", r3.get("error") == "round_in_progress", r3)
    r4 = try_(lambda: rpc(u2, "rpc_rotate_seed", None))
    check("seed rotation refused while a round is active", r4[0] == "ok" and r4[1].get("error") == "round_in_progress", r4)
    # 30 parallel 'stand' with distinct keys: exactly one transition, the rest rejected; payout once
    rid = r["round"]["id"]
    out = par(30, lambda i: rpc(u2, "rpc_blackjack_action", rid, "stand", key()))
    oks = sum(1 for o in out if o["ok"])
    npay = sql("select count(*) from public.wallet_transactions where round_id=%s and type='payout'", rid)[0][0]
    fin = sql("select status from public.casino_rounds where id=%s", rid)[0][0]
    check("30 parallel STAND -> 1 accepted, round finished, <=1 payout", oks == 1 and fin == "finished" and npay <= 1, (oks, fin, npay))
    # replay of the accepted action key returns same state, no new money
    k = key()
    while True:
        r = rpc(u2, "rpc_blackjack_start", 10, key())
        if r["round"]["status"] == "active": break
    b0 = bal(u2)
    out = par(20, lambda i: rpc(u2, "rpc_blackjack_action", r["round"]["id"], "double", k))
    ndbl = sql("select count(*) from public.wallet_transactions where round_id=%s and metadata->>'action'='double'", r["round"]["id"])[0][0]
    check("20 parallel DOUBLE with same key -> exactly one extra debit", ndbl == 1, ndbl)
    rr = rpc(u2, "rpc_blackjack_action", r["round"]["id"], "hit", k)
    check("reusing an action key for a different action -> conflict", rr.get("error") in ("idempotency_conflict",), rr)
    # insufficient funds for double: find an active round where the remaining balance is below the stake
    u3 = new_player(opening=10)
    tested = False
    for _ in range(40):
        if bal(u3) < 10: break
        r = rpc(u3, "rpc_blackjack_start", 10, key())
        if not r["ok"] or r["round"]["status"] != "active": continue
        if bal(u3) < 10:
            before = bal(u3)
            rr = rpc(u3, "rpc_blackjack_action", r["round"]["id"], "double", key())
            check("double without funds -> insufficient_funds, balance unchanged", rr.get("error") == "insufficient_funds" and bal(u3) == before, rr)
            tested = True
            break
        rpc(u3, "rpc_blackjack_action", r["round"]["id"], "stand", key())
    check("insufficient-funds double scenario was exercised", tested)


# ---------------------------------------------------------------- 4. economy / admin
def test_daily_and_admin():
    u = new_player()
    out = par(20, lambda i: try_(lambda: rpc(u, "rpc_claim_daily")))
    n = sql("select count(*) from public.wallet_transactions where user_id=%s and type='bonus'", u)[0][0]
    check("20 parallel daily claims -> exactly one bonus", n == 1, (n, out[:2]))
    admin = new_player(role="admin")
    owner = new_player(role="owner")
    r = try_(lambda: rpc(u, "rpc_admin_players", aal="aal2"))
    check("player cannot call admin RPC", r[0] == "err" and "forbidden" in r[1], r)
    r = try_(lambda: rpc(admin, "rpc_admin_players"))
    check("admin without MFA (aal1) is refused", r[0] == "err" and "mfa_required" in r[1], r)
    r = rpc(admin, "rpc_admin_adjust_balance", u, 777, "за красивые глаза", "adm-" + uuid.uuid4().hex, aal="aal2")
    check("admin+aal2 can adjust balance", r["ok"] is True, r)
    a = sql("select before->>'balance', after->>'balance', reason from public.admin_audit_log where entity_id=%s and action='wallet_adjustment'", str(u))
    check("adjustment is audited with before/after/reason", a and int(a[0][1]) - int(a[0][0]) == 777, a)
    r = rpc(admin, "rpc_admin_adjust_balance", admin, 100, "себе любимому", key(), aal="aal2")
    check("admin cannot adjust own balance", r.get("error") == "self_adjustment_forbidden", r)
    r = rpc(admin, "rpc_admin_adjust_balance", u, 100, "", key(), aal="aal2")
    check("adjustment requires reason", r.get("error") == "reason_required", r)
    r = rpc(admin, "rpc_admin_adjust_balance", u, -10**9, "в минус", key(), aal="aal2")
    check("adjustment cannot exceed limit / go negative", r["ok"] is False, r)
    r = rpc(admin, "rpc_admin_set_status", owner, "disabled", "бунт", aal="aal2")
    check("admin cannot disable owner", r.get("error") == "forbidden", r)
    r = try_(lambda: rpc(admin, "rpc_admin_set_role", u, "admin", "повышение", aal="aal2"))
    check("admin cannot change roles (owner only)", r[0] == "err" and "forbidden" in r[1], r)
    r = rpc(owner, "rpc_admin_set_role", u, "moderator", "повышение", aal="aal2")
    check("owner can change roles", r["ok"] is True, r)
    r = try_(lambda: sql("delete from public.admin_audit_log"))
    check("audit log is immutable", r[0] == "err", r)
    r = rpc(admin, "rpc_admin_set_status", u, "disabled", "test", aal="aal2")
    r2 = try_(lambda: rpc(u, "rpc_me"))
    check("disabled user is locked out of RPCs", r["ok"] and r2[0] == "err", (r, r2))


def test_login_limiter():
    victim = "victim_" + uuid.uuid4().hex[:8]
    seq = [as_role("service_role", None, "select public.svc_login_attempt(%s, '1.1.1.1')", (victim,))[0][0] for _ in range(10)]
    check("pair limiter blocks after 8 attempts from same IP", seq == [True] * 8 + [False] * 2, seq)
    ok = as_role("service_role", None, "select public.svc_login_attempt(%s, '2.2.2.2')", (victim,))[0][0]
    check("victim from another IP is NOT locked out by attacker", ok is True)


def test_invariants():
    q = {
        "balance == ledger sum": "select count(*) from public.wallets w where balance <> (select coalesce(sum(amount),0) from public.wallet_transactions t where t.user_id=w.user_id)",
        "ledger chain continuous": "select count(*) from (select balance_before, lag(balance_after) over (partition by user_id order by id) prev from public.wallet_transactions) x where prev is not null and balance_before <> prev",
        "balance == last balance_after": "select count(*) from public.wallets w where balance <> (select balance_after from public.wallet_transactions t where t.user_id=w.user_id order by id desc limit 1)",
        "round bets == bet_total": "select count(*) from public.casino_rounds r where r.bet_total <> (select coalesce(-sum(amount),0) from public.wallet_transactions t where t.round_id=r.id and t.type='bet')",
        "<=1 payout per round and == round.payout": "select count(*) from public.casino_rounds r where (select count(*) from public.wallet_transactions t where t.round_id=r.id and t.type='payout')>1 or (r.status='finished' and r.payout <> (select coalesce(sum(amount),0) from public.wallet_transactions t where t.round_id=r.id and t.type='payout'))",
        "roulette payouts are legal": "select count(*) from public.casino_rounds where game_slug='roulette' and status='finished' and payout <> (select coalesce(sum((l->>'win')::bigint),0) from jsonb_array_elements(state->'lines') l)",
        "revealed seeds match commitment": "select count(*) from public.fair_seeds where status='revealed' and encode(extensions.digest(server_seed,'sha256'),'hex') <> server_seed_hash",
        "tx user == round user": "select count(*) from public.wallet_transactions t join public.casino_rounds r on r.id=t.round_id where t.user_id <> r.user_id",
    }
    for name, qq in q.items():
        n = sql(qq)[0][0]
        check(f"INVARIANT {name}", n == 0, n)


if __name__ == "__main__":
    for t in [test_access, test_roulette_validation, test_roulette_fairness_and_math, test_roulette_concurrency,
              test_blackjack, test_daily_and_admin, test_login_limiter, test_invariants]:
        print(f"\n### {t.__name__}")
        try:
            t()
        except Exception:
            traceback.print_exc()
            RESULTS.append((t.__name__, False, "exception"))
    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} passed")
    sys.exit(1 if failed else 0)
