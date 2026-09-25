"""Browser E2E against the local stack (tests/local/stack.sh). Real UI, real Edge Function code, real SQL."""
import asyncio, json, re, sys, os
import psycopg
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
DSN = "host=/tmp port=5499 user=postgres dbname=lb2"
SHOTS = os.path.join(os.path.dirname(__file__), "screens")
os.makedirs(SHOTS, exist_ok=True)
RESULTS = []


def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))


def q(sql, *a):
    with psycopg.connect(DSN, autocommit=True) as c:
        return c.execute(sql, a).fetchall()


def bal(username):
    return q("select w.balance from wallets w join profiles p on p.id=w.user_id where p.username=%s", username)[0][0]


def rounds(username):
    return q("select count(*) from casino_rounds r join profiles p on p.id=r.user_id where p.username=%s", username)[0][0]


async def ui_balance(page):
    t = await page.locator(".balance-pill .v").inner_text()
    return int(re.sub(r"\D", "", t))


async def login(page, user, pw):
    await page.goto(BASE + "/#/lobby")
    await page.fill("#lg-user", user)
    await page.fill("#lg-pass", pw)
    await page.click("form button[type=submit]")
    await page.wait_for_selector(".balance-pill", timeout=10000)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 1366, "height": 900})
        page = await ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))

        # ---- login + forced password change
        await page.goto(BASE)
        await page.fill("#lg-user", "vasya"); await page.fill("#lg-pass", "wrong-pass")
        await page.click("form button[type=submit]")
        await page.wait_for_selector(".form-error:has-text('Неверный')")
        check("wrong password -> generic error", True)
        await page.fill("#lg-pass", "password123"); await page.click("form button[type=submit]")
        await page.wait_for_selector(".modal:has-text('временный пароль')", timeout=10000)
        check("temporary password forces change dialog", True)
        pw = page.locator(".modal input[type=password]")
        await pw.nth(0).fill("newpassword1"); await pw.nth(1).fill("newpassword1")
        await page.click(".modal button:has-text('Сохранить пароль')")
        await page.wait_for_selector(".toast:has-text('Пароль обновлён')")
        check("password changed; must_change flag cleared", q("select must_change_password from profiles where username='vasya'")[0][0] is False)
        await page.screenshot(path=f"{SHOTS}/desktop_lobby.png")

        # ---- daily bonus
        b0 = bal("vasya")
        await page.click("button:has-text('Получить')")
        await page.wait_for_selector("text=Выдано сегодня")
        check("daily bonus credited once (+500)", bal("vasya") == b0 + 500 and await ui_balance(page) == b0 + 500, (b0, bal("vasya")))

        # ---- roulette: place several bet types, spin
        await page.goto(BASE + "/#/roulette")
        await page.wait_for_selector(".rtable .hotspot")
        await page.click(".chip[data-v='25']")
        await page.click(".rcell[aria-label='Число 17']")
        await page.click(".hotspot[data-key='split:17-20']")
        await page.click(".hotspot[data-key='corner:0-1-2-3']")
        await page.click(".rcell[aria-label='Красное']")
        await page.click(".rcell[aria-label='Дюжина 2']")
        total = await page.locator(".bet-summary .v").first.inner_text()
        check("5 positions x 25 = 125 on the table", re.sub(r"\D", "", total) == "125", total)
        await page.screenshot(path=f"{SHOTS}/desktop_roulette_bets.png")
        r0 = rounds("vasya")
        spin = page.locator("button:has-text('Крутить')")
        await spin.click()
        await spin.click(force=True)  # hostile double click
        await page.wait_for_selector(".outcome .big", timeout=15000)
        check("double-click on SPIN creates exactly one round", rounds("vasya") == r0 + 1, rounds("vasya") - r0)
        check("UI balance == DB balance after spin", await ui_balance(page) == bal("vasya"))
        last = q("select state, request, payout, bet_total from casino_rounds r join profiles p on p.id=r.user_id where p.username='vasya' order by r.created_at desc limit 1")[0]
        check("server stored all 5 submitted positions", len(last[1]) == 5 and last[3] == 125, last[1])
        await page.screenshot(path=f"{SHOTS}/desktop_roulette_result.png")

        # ---- network loss after the server committed: safe retry returns the SAME round
        await page.click(".rcell[aria-label='Чёрное']")
        state = {"dropped": False}

        async def drop_once(route):
            if not state["dropped"]:
                state["dropped"] = True
                await route.fetch()      # server processes the spin...
                await route.abort()      # ...but the browser never hears back
            else:
                await route.continue_()
        await page.route("**/rest/v1/rpc/rpc_roulette_spin", drop_once)
        r0 = rounds("vasya")
        await spin.click()
        await page.wait_for_selector("button:has-text('безопасный повтор')", timeout=10000)
        check("lost response -> UI offers safe retry", True)
        await page.click("button:has-text('безопасный повтор')")
        await page.wait_for_selector(".outcome .big", timeout=15000)
        check("retry after lost response did not create a second round", rounds("vasya") == r0 + 1, rounds("vasya") - r0)
        check("UI balance == DB after recovered spin", await ui_balance(page) == bal("vasya"))
        await page.unroute("**/rest/v1/rpc/rpc_roulette_spin")

        # ---- refresh while a spin is pending (request sent, page reloaded before answer)
        await page.click(".rcell[aria-label='Нечёт']")
        await page.route("**/rest/v1/rpc/rpc_roulette_spin", lambda route: asyncio.create_task(route.abort()))
        r0 = rounds("vasya")
        await spin.click()
        await page.wait_for_timeout(500)
        await page.unroute("**/rest/v1/rpc/rpc_roulette_spin")
        await page.reload()
        await page.wait_for_selector(".outcome .big", timeout=15000)
        check("reload with pending spin re-sends same key -> exactly one round", rounds("vasya") == r0 + 1, rounds("vasya") - r0)

        # ---- blackjack: deal, refresh mid-round, resume, finish
        await page.goto(BASE + "/#/blackjack")
        await page.wait_for_selector("button:has-text('Раздать')")
        await page.click("button:has-text('Сбросить')")
        await page.click(".chip[data-v='25']"); await page.click(".chip[data-v='5']")
        await page.click("button:has-text('Раздать')")
        await page.wait_for_selector(".bj-hand .pcard")
        await page.screenshot(path=f"{SHOTS}/desktop_blackjack.png")
        for _ in range(30):
            active = await page.locator(".bj-actions").count()
            if not active:
                await page.wait_for_timeout(300)
                if await page.locator(".bj-actions").count() == 0 and await page.locator("button:has-text('Раздать')").count():
                    # finished quickly (natural) -> deal again to get an active round
                    await page.click("button:has-text('Раздать')"); await page.wait_for_timeout(600); continue
            break
        if await page.locator(".bj-actions").count():
            await page.reload()
            await page.wait_for_selector(".toast:has-text('Восстановлена')", timeout=10000)
            check("refresh mid-hand restores the active round from server", True)
            hidden = await page.locator(".pcard.back").count()
            check("dealer hole card stays hidden in UI after refresh", hidden == 1, hidden)
            for _ in range(10):
                if not await page.locator(".bj-actions").count(): break
                stand = page.locator(".bj-actions button:has-text('Хватит')")
                if await stand.is_enabled(): await stand.click()
                await page.wait_for_timeout(700)
        await page.wait_for_selector(".outcome .big", timeout=10000)
        check("blackjack round finishes with outcome shown", True)
        check("UI balance == DB after blackjack", await ui_balance(page) == bal("vasya"))
        await page.screenshot(path=f"{SHOTS}/desktop_blackjack_result.png")

        # ---- history + verifier (reveal seed, then verify a roulette and a blackjack round)
        await page.goto(BASE + "/#/history")
        await page.wait_for_selector("tbody tr.click")
        n_rows = await page.locator("tbody tr.click").count()
        check("history lists my rounds", n_rows >= 4, n_rows)
        await page.goto(BASE + "/#/fairness")
        await page.click("button:has-text('Раскрыть сид и начать новый')")
        await page.wait_for_selector(".toast:has-text('Сид раскрыт')")
        rid = {g: q("select r.id from casino_rounds r join profiles p on p.id=r.user_id where p.username='vasya' and r.game_slug=%s and r.status='finished' order by r.created_at limit 1", g)[0][0] for g in ("roulette", "blackjack")}
        for g, r in rid.items():
            await page.goto(f"{BASE}/#/fairness/verify?round={r}")
            await page.click("button:has-text('наебала')")
            await page.wait_for_selector(".verdict", timeout=10000)
            ok = await page.locator(".verdict.pass").count()
            check(f"browser verifier PASSES a real {g} round", ok == 1, await page.locator(".verdict").inner_text())
        await page.screenshot(path=f"{SHOTS}/desktop_verify.png")

        # ---- tampered data must FAIL verification (simulate a lying server response)
        async def tamper(route):
            resp = await route.fetch()
            data = await resp.json()
            if isinstance(data, dict) and "state" in data and data.get("game_slug") == "roulette":
                data["state"]["number"] = (data["state"]["number"] + 1) % 37
            await route.fulfill(response=resp, json=data)
        await page.route("**/rest/v1/casino_rounds*", tamper)
        await page.goto(f"{BASE}/#/fairness/verify?round={rid['roulette']}")
        await page.click("button:has-text('наебала')")
        await page.wait_for_selector(".verdict", timeout=10000)
        check("verifier FAILS when the displayed outcome was tampered", await page.locator(".verdict.fail").count() == 1)
        await page.unroute("**/rest/v1/casino_rounds*")

        # ---- hostile client: direct REST writes with the player's own token
        token = await page.evaluate("JSON.parse(localStorage.getItem('luzbet2-auth')).access_token")
        anon = await page.evaluate("window.__LUZBET_CONFIG.key")
        hdr = {"apikey": anon, "Authorization": "Bearer " + token, "Content-Type": "application/json"}
        req = page.request
        r1 = await req.patch(BASE + "/rest/v1/wallets?user_id=not.is.null", headers=hdr, data=json.dumps({"balance": 999999}))
        r2 = await req.post(BASE + "/rest/v1/wallet_transactions", headers=hdr, data=json.dumps({"amount": 1}))
        r3 = await req.post(BASE + "/rest/v1/rpc/rpc_admin_adjust_balance", headers=hdr, data=json.dumps({"p_user": "00000000-0000-0000-0000-000000000000", "p_amount": 1, "p_reason": "xx", "p_idempotency_key": "aaaaaaaaaa"}))
        r4 = await req.get(BASE + "/rest/v1/profiles?select=username", headers=hdr)
        r5 = await req.post(BASE + "/rest/v1/rpc/svc_create_profile", headers=hdr, data="{}")
        r6 = await req.post(BASE + "/functions/v1/v2-admin", headers=hdr, data=json.dumps({"action": "create_player", "username": "evil", "password": "12345678"}))
        check("REST PATCH wallets rejected", r1.status in (401, 403), r1.status)
        check("REST INSERT ledger rejected", r2.status in (401, 403), r2.status)
        check("player calling admin RPC rejected", r3.status >= 400, r3.status)
        check("profiles REST returns only self", len(await r4.json()) == 1, await r4.text())
        check("player cannot call service RPC", r5.status >= 400, r5.status)
        check("player calling v2-admin gets 403", r6.status == 403, r6.status)
        r7 = await req.post(BASE + "/rest/v1/rpc/rpc_set_display_name", headers=hdr, data=json.dumps({"p_name": "<img src=x onerror=alert(1)>"}))
        check("HTML in display name rejected", (await r7.json()).get("ok") is False, await r7.text())

        # ---- logout
        await page.goto(BASE + "/#/profile")
        await page.click("button:has-text('Выйти'):not(:has-text('всех'))")
        await page.wait_for_selector("#lg-user")
        check("logout returns to login screen", True)

        # ---- owner: MFA gate, create player, adjust, disable
        await login(page, "dima", "password123")
        await page.goto(BASE + "/#/admin")
        await page.wait_for_selector("button:has-text('Подключить аутентификатор')")
        check("back-office requires MFA enrollment first", True)
        await page.click("button:has-text('Подключить аутентификатор')")
        await page.fill("input[autocomplete=one-time-code]", "111111")
        await page.click("button:has-text('Проверить и включить')")
        await page.wait_for_selector(".form-error:has-text('не подошёл')")
        await page.fill("input[autocomplete=one-time-code]", "123456")
        await page.click("button:has-text('Проверить и включить')")
        await page.wait_for_selector("h1:has-text('Бэк-офис')")
        await page.wait_for_selector(".kpis")
        check("after TOTP (aal2) the back-office opens", True)
        await page.screenshot(path=f"{SHOTS}/desktop_admin.png")
        await page.click(".seg button:has-text('Игроки')")
        await page.click("button:has-text('Создать игрока')")
        m = page.locator(".modal")
        await m.locator("input").nth(0).fill("petya"); await m.locator("input").nth(1).fill("Петя")
        temp_pw = await m.locator("input").nth(2).input_value()
        await m.locator("button:has-text('Создать')").click()
        await page.wait_for_selector(".modal:has-text('Игрок создан')")
        check("admin created player via Edge Function (+1000 opening)", bal("petya") == 1000)
        await page.keyboard.press("Escape")
        await page.wait_for_selector("tr:has-text('@petya')")
        await page.click("tr:has-text('@petya')")
        await page.fill(".drawer input[type=number]", "250")
        await page.fill(".drawer input[placeholder^='причина (обязательно)']", "приветственный бонус")
        await page.click(".drawer button:has-text('Провести через ledger')")
        await page.wait_for_selector(".toast:has-text('Проведено')")
        check("balance adjustment via ledger", bal("petya") == 1250)
        aud = q("select action, reason from admin_audit_log order by id desc limit 1")[0]
        check("adjustment written to audit log with reason", aud == ("wallet_adjustment", "приветственный бонус"), aud)
        await page.click("tr:has-text('@petya')")
        await page.fill(".drawer input[placeholder='причина']", "проверка блокировки")
        await page.click(".drawer button:has-text('Отключить')")
        await page.wait_for_selector(".toast:has-text('Статус изменён')")
        banned = q("select u.banned_until is not null, p.status from auth.users u join profiles p on p.id=u.id where p.username='petya'")[0]
        check("disable: profile disabled AND auth user banned", banned == (True, "disabled"), banned)
        await page.click(".seg button:has-text('Аудит')")
        await page.wait_for_selector("td:has-text('set_status')")
        check("audit tab shows actions", True)
        await page.click(".seg button:has-text('Безопасность')")
        await page.wait_for_selector("td")
        await page.screenshot(path=f"{SHOTS}/desktop_admin_security.png")

        # ---- disabled player cannot log in
        ctx2 = await browser.new_context()
        p2 = await ctx2.new_page()
        await p2.goto(BASE)
        await p2.fill("#lg-user", "petya"); await p2.fill("#lg-pass", temp_pw); await p2.click("form button[type=submit]")
        await p2.wait_for_selector(".form-error:has-text('Неверный')")
        check("disabled player cannot log in (same generic error)", True)
        await ctx2.close()

        # ---- mobile
        mctx = await browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        mp = await mctx.new_page()
        mp.on("pageerror", lambda e: errors.append("mobile: " + str(e)))
        await login(mp, "vasya", "newpassword1")
        for view in ("lobby", "roulette", "blackjack", "history", "fairness"):
            await mp.goto(f"{BASE}/#/{view}")
            await mp.wait_for_timeout(900)
            sw = await mp.evaluate("document.documentElement.scrollWidth")
            check(f"mobile {view}: no horizontal scroll (scrollWidth={sw})", sw <= 390, sw)
            await mp.screenshot(path=f"{SHOTS}/mobile_{view}.png", full_page=True)
        await mp.goto(f"{BASE}/#/roulette"); await mp.wait_for_selector(".hotspot")
        sizes = await mp.evaluate("[...document.querySelectorAll('.rcell')].slice(0,40).map(e=>Math.min(e.getBoundingClientRect().width,e.getBoundingClientRect().height))")
        check("mobile roulette cells >= 36px touch size", min(sizes) >= 36, min(sizes))
        await mp.tap(".rcell[aria-label='Число 5']")
        await mp.tap(".hotspot[data-key='street:4-5-6']")
        await mp.screenshot(path=f"{SHOTS}/mobile_roulette_bets.png")
        await mctx.close()

        check("no uncaught JS errors in console", not [e for e in errors if "Failed to load resource" not in e and "net::ERR" not in e], errors[:5])
        await browser.close()
    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} passed")
    sys.exit(1 if failed else 0)


asyncio.run(main())
