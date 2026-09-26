"""«Линия» (tote betting) tests: API validation, idempotency, concurrency, tote math, auto settlement from real rounds,
manual events (staff), audit, and ledger invariants."""
import json, random, sys
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, __file__.rsplit('/', 1)[0])
import test_engine as T
from test_engine import check, sql, rpc, new_player, bal, key, try_

OWNER = None


def owner():
    global OWNER
    if OWNER is None:
        OWNER = new_player(role="owner")
    return OWNER


def first_open(u, code=None):
    evs = rpc(u, "rpc_line_list", "open")["events"]
    return [e for e in evs if code is None or e["code"] == code][0]


def test_player_api():
    u = new_player()
    lst = rpc(u, "rpc_line_list", "open")
    codes = {e["code"] for e in lst["events"] if e["kind"] == "auto"}
    nxt = sql("select count(*), count(distinct code), count(distinct period_start) from public.line_events where kind='auto' and period_start > now()")[0]
    check("line: 5 auto markets created for each of the next two periods", tuple(nxt) == (10, 5, 2) and len(codes) >= 4, (nxt, codes))
    e = first_open(u, "roulette_color")
    b0 = bal(u); k = key()
    r = rpc(u, "rpc_line_bet", e["id"], 0, 100, k)
    check("line: bet accepted and debited once", r["ok"] and bal(u) == b0 - 100 and r["balance"] == b0 - 100, r)
    r2 = rpc(u, "rpc_line_bet", e["id"], 0, 100, k)
    check("line: same key replays without second debit", r2.get("replayed") and bal(u) == b0 - 100)
    check("line: same key different amount -> conflict", rpc(u, "rpc_line_bet", e["id"], 0, 50, k).get("error") == "idempotency_conflict")
    ev = [x for x in rpc(u, "rpc_line_list", "open")["events"] if x["id"] == e["id"]][0]
    check("line: pools and my bets visible", ev["options"][0]["pool"] == 100 and ev["mine"][0]["amount"] == 100 and ev["total"] == 100, ev["options"])
    for bad, name in [((e["id"], 2, 10), "option out of range"), ((e["id"], -1, 10), "negative option"), ((e["id"], 0, 0), "zero amount"),
                      ((e["id"], 0, 5001), "over max bet"), (("00000000-0000-0000-0000-000000000000", 0, 10), "unknown event")]:
        check(f"line: rejects {name}", rpc(u, "rpc_line_bet", *bad, key()).get("ok") is False)
    poor = new_player(opening=5)
    check("line: insufficient funds", rpc(poor, "rpc_line_bet", e["id"], 1, 50, key()).get("error") == "insufficient_funds")
    # per-event cap with parallel requests
    rich = new_player(opening=50000)
    with ThreadPoolExecutor(20) as ex:
        list(ex.map(lambda _: rpc(rich, "rpc_line_bet", e["id"], 1, 1000, key()), range(20)))
    tot = sql("select coalesce(sum(amount),0) from public.line_bets where event_id=%s and user_id=%s", e["id"], rich)[0][0]
    check("line: per-event limit holds under 20 parallel bets", tot == 10000, tot)
    # same key in parallel -> one bet
    kk = key(); p = new_player()
    with ThreadPoolExecutor(20) as ex:
        list(ex.map(lambda _: try_(lambda: rpc(p, "rpc_line_bet", e["id"], 0, 10, kk)), range(20)))
    n = sql("select count(*) from public.line_bets where user_id=%s", p)[0][0]
    check("line: 20 parallel identical requests -> 1 bet, 1 debit", n == 1 and bal(p) == 990, (n, bal(p)))
    # closed event
    sql("update public.line_events set closes_at = now() - interval '1 second' where id=%s", e["id"])
    check("line: betting closed after closes_at", rpc(u, "rpc_line_bet", e["id"], 0, 10, key()).get("error") == "betting_closed")
    x = try_(lambda: T.as_role("authenticated", u, "insert into public.line_bets(event_id,user_id,option,amount,idempotency_key) values (%s,%s,0,1,'hack-hack-1')", (e["id"], u)))
    check("line: direct insert into line_bets denied", x[0] == "err", x)
    x = try_(lambda: T.as_role("authenticated", u, "update public.line_events set status='void'"))
    check("line: direct update of events denied", x[0] == "err", x)
    other = T.as_role("authenticated", u, "select count(*) from public.line_bets where user_id <> %s", (u,))[0][0]
    check("line: RLS hides other players' bets", other == 0, other)


def make_manual(options=("Да", "Нет"), closes="now() + interval '1 hour'"):
    o = owner()
    r = rpc(o, "rpc_admin_line_create", "Придёт ли Вася вовремя", "тест", json.dumps(list(options)),
            sql(f"select {closes}")[0][0], "тестовое событие", aal="aal2")
    return r


def test_tote_math_and_manual():
    o = owner()
    pl = new_player()
    check("line admin: player cannot create events", try_(lambda: rpc(pl, "rpc_admin_line_create", "abc", None, '["a","b"]',
          sql("select now() + interval '1 hour'")[0][0], "reason"))[0] == "err")
    r = make_manual()
    check("line admin: owner creates manual event", r["ok"], r)
    eid = r["event"]["id"]
    check("line: creator cannot bet on own event", rpc(o, "rpc_line_bet", eid, 0, 10, key()).get("error") == "creator_cannot_bet")
    A, B, C = new_player(), new_player(), new_player()
    rpc(A, "rpc_line_bet", eid, 0, 100, key()); rpc(B, "rpc_line_bet", eid, 0, 300, key()); rpc(C, "rpc_line_bet", eid, 1, 200, key())
    check("line admin: result before close refused", rpc(o, "rpc_admin_line_settle", eid, 0, "рано", aal="aal2").get("error") == "betting_still_open")
    sql("update public.line_events set closes_at = now() - interval '1 second' where id=%s", eid)
    s = rpc(o, "rpc_admin_line_settle", eid, 0, "Вася пришёл", aal="aal2")
    # W=400 L=200 net=190: A=100+47, B=300+142, C=0
    check("line tote: winners get stake + share of 95% of losers", (bal(A), bal(B), bal(C)) == (1047, 1142, 800), (bal(A), bal(B), bal(C)))
    check("line tote: event settled with result 0", s["event"]["status"] == "settled" and s["event"]["result"] == 0)
    check("line tote: double settle refused", rpc(o, "rpc_admin_line_settle", eid, 1, "ещё раз", aal="aal2").get("ok") is False)
    aud = sql("select count(*) from public.admin_audit_log where entity='line_event' and entity_id=%s", str(eid))[0][0]
    check("line admin: create + settle audited", aud == 2, aud)
    # void refunds everyone
    r = make_manual(("A", "B", "C")); eid = r["event"]["id"]
    D, E = new_player(), new_player()
    rpc(D, "rpc_line_bet", eid, 2, 70, key()); rpc(E, "rpc_line_bet", eid, 1, 30, key())
    rpc(o, "rpc_admin_line_settle", eid, None, "Матч отменили", aal="aal2")
    check("line: void refunds all stakes", bal(D) == 1000 and bal(E) == 1000)
    # one-sided market -> refund even with a result
    r = make_manual(); eid = r["event"]["id"]
    F = new_player(); rpc(F, "rpc_line_bet", eid, 0, 100, key())
    sql("update public.line_events set closes_at = now() - interval '1 second' where id=%s", eid)
    ev = rpc(o, "rpc_admin_line_settle", eid, 0, "итог", aal="aal2")["event"]
    check("line tote: one-sided market refunded, no commission", bal(F) == 1000 and ev["status"] == "void", ev.get("resultNote"))
    # nobody on the winner -> refund
    r = make_manual(("A", "B", "C")); eid = r["event"]["id"]
    G, H = new_player(), new_player(); rpc(G, "rpc_line_bet", eid, 0, 10, key()); rpc(H, "rpc_line_bet", eid, 1, 10, key())
    sql("update public.line_events set closes_at = now() - interval '1 second' where id=%s", eid)
    rpc(o, "rpc_admin_line_settle", eid, 2, "победил C", aal="aal2")
    check("line tote: no bets on winning option -> refund", bal(G) == 1000 and bal(H) == 1000)
    # admin without MFA
    sql("update public.system_settings set value='true' where key='admin_mfa_required'")
    check("line admin: MFA required", try_(lambda: rpc(o, "rpc_admin_line_list"))[0] == "err")


def test_auto_settlement():
    sql("insert into public.system_settings(key,value) values ('line_min_samples','3') on conflict (key) do update set value=excluded.value")
    u = new_player(opening=100000)
    # play 30 roulette spins (red bet) and move them into a finished past window
    for _ in range(30):
        rpc(u, "rpc_roulette_spin", json.dumps([{"t": "color", "v": "red", "a": 1}]), key())
    sql(f"begin; set local session_replication_role = replica; update public.casino_rounds set created_at = now() - interval '2 hours' where user_id='{u}'; commit;")   # test-only time travel
    red = sql("select count(*) from public.casino_rounds where user_id=%s and (state->>'number')::int in (1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36)", u)[0][0]
    black = sql("select count(*) from public.casino_rounds where user_id=%s and (state->>'number')::int between 1 and 36", u)[0][0] - red
    eid = sql("""insert into public.line_events(kind, code, period_start, period_end, title, options, closes_at)
                 values ('auto','roulette_color', now() - interval '3 hours', now() - interval '20 minutes', 'test', '["Красных больше","Чёрных больше"]', now() - interval '3 hours')
                 returning id""")[0][0]
    A, B = new_player(), new_player()
    sql("update public.line_events set closes_at = now() + interval '1 minute' where id=%s", eid)
    rpc(A, "rpc_line_bet", eid, 0, 100, key()); rpc(B, "rpc_line_bet", eid, 1, 100, key())
    sql("update public.line_events set closes_at = now() - interval '3 hours' where id=%s", eid)
    others = sql("select count(*) from public.casino_rounds where game_slug='roulette' and created_at >= now() - interval '3 hours' and created_at < now() - interval '20 minutes' and user_id <> %s", u)[0][0]
    rpc(A, "rpc_line_list", "open")      # triggers tick
    ev = sql("select status, result, stats, result_note from public.line_events where id=%s", eid)[0]
    if others == 0:
        exp = None if red == black else (0 if red > black else 1)
        ok = (ev[0] == "void" and exp is None) or (ev[0] == "settled" and ev[1] == exp)
        check(f"line auto: roulette_color settled from real rounds ({red}:{black})", ok and ev[2]["a"] == red and ev[2]["b"] == black, ev)
        if ev[0] == "settled":
            win, lose = (A, B) if exp == 0 else (B, A)
            check("line auto: winner gets stake + 95% of loser stake", bal(win) == 1095 and bal(lose) == 900, (bal(A), bal(B)))
    else:
        check("line auto: settled", ev[0] in ("settled", "void"), ev)
    # too few samples -> void
    eid2 = sql("""insert into public.line_events(kind, code, period_start, period_end, title, options, closes_at)
                  values ('auto','crash_x2', now() - interval '30 days', now() - interval '29 days', 'test', '["a","b"]', now() - interval '30 days') returning id""")[0][0]
    rpc(A, "rpc_line_list", "open")
    ev2 = sql("select status, result_note from public.line_events where id=%s", eid2)[0]
    check("line auto: too few samples -> void", ev2[0] == "void" and "Мало данных" in ev2[1], ev2)
    # the tick never creates duplicate markets
    for _ in range(3): rpc(A, "rpc_line_list", "open")
    d = sql("select count(*) from (select code, period_start from public.line_events where kind='auto' group by 1,2 having count(*)>1) x")[0][0]
    check("line auto: no duplicate markets after repeated ticks", d == 0)


def test_line_invariants():
    q = {
        "every line bet has exactly one debit": "select count(*) from public.line_bets b where (select count(*) from public.wallet_transactions t where t.idempotency_key='line-bet:'||b.id and t.amount=-b.amount) <> 1",
        "settled bets paid exactly once": "select count(*) from public.line_bets b where b.status in ('won','refunded') and (select coalesce(sum(amount),0) from public.wallet_transactions t where t.idempotency_key in ('line-pay:'||b.id,'line-refund:'||b.id)) <> b.payout",
        "tote never pays more than the pool": "select count(*) from public.line_events e where e.status='settled' and (select sum(payout) from public.line_bets where event_id=e.id) > (select sum(amount) from public.line_bets where event_id=e.id)",
        "no open bets on finished events": "select count(*) from public.line_bets b join public.line_events e on e.id=b.event_id where e.status<>'open' and b.status='open'",
    }
    for name, qq in q.items():
        n = sql(qq)[0][0]
        check(f"INVARIANT line: {name}", n == 0, n)


if __name__ == "__main__":
    sql("insert into public.system_settings(key,value) values ('admin_mfa_required','false') on conflict (key) do update set value=excluded.value")
    for t in [test_player_api, test_tote_math_and_manual, test_auto_settlement, test_line_invariants, T.test_invariants]:
        print(f"\n### {t.__name__}")
        t()
    ok = sum(1 for r in T.RESULTS if r[1])
    print(f"\n{ok}/{len(T.RESULTS)} passed")
    sys.exit(0 if ok == len(T.RESULTS) else 1)
