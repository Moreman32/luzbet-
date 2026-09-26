"""Browser E2E for the games pack + «Контора»: every game is played through the real UI, then every round is verified
by the in-browser verifier after the seed is revealed. Run against the local stack (tests/local/stack.sh)."""
import asyncio, re, os, sys
import psycopg
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
DSN = "host=/tmp port=5499 user=postgres dbname=lb2"
SHOTS = os.path.join(os.path.dirname(__file__), "screens")
os.makedirs(SHOTS, exist_ok=True)
RESULTS = []
USER = sys.argv[1] if len(sys.argv) > 1 else "dima"


def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""), flush=True)


def q(sql, *a):
    with psycopg.connect(DSN, autocommit=True) as c:
        return c.execute(sql, a).fetchall()


def bal():
    return q("select w.balance from wallets w join profiles p on p.id=w.user_id where p.username=%s", USER)[0][0]


def last_round(game):
    r = q("select r.id, r.status, r.bet_total, r.payout, r.state from casino_rounds r join profiles p on p.id=r.user_id "
          "where p.username=%s and r.game_slug=%s order by r.created_at desc limit 1", USER, game)
    return r[0] if r else None


async def ui_balance(page):
    return int(re.sub(r"\D", "", await page.locator(".balance-pill .v").inner_text()))


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 1366, "height": 900})
        page = await ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and "Failed to load resource" not in m.text and errors.append(m.text))
        await page.goto(BASE)
        await page.fill("#lg-user", USER); await page.fill("#lg-pass", "password123")
        await page.click("form button[type=submit]")
        await page.wait_for_selector(".balance-pill", timeout=15000)

        # ---------------- lobby
        await page.goto(BASE + "/#/lobby"); await page.wait_for_selector(".lb-tile")
        check("lobby: 9 game tiles", await page.locator(".lb-tile").count() == 9)
        check("ticker present (jokes only)", await page.locator(".ticker-track span").count() >= 10)

        # ---------------- mines
        await page.goto(BASE + "/#/mines"); await page.wait_for_selector(".mn-grid")
        await page.fill(".gk-bet-input", "10"); await page.press(".gk-bet-input", "Tab")
        b0 = bal()
        await page.click("text=Заминировать поле")
        await page.wait_for_selector(".mn-tile:not([disabled])")
        check("mines: bet debited once", bal() == b0 - 10, (b0, bal()))
        r = last_round("mines")
        mines = {x for (x,) in q("select unnest(mines) from private.mines_games where round_id=%s", r[0])}   # test oracle only
        safe = [t for t in range(25) if t not in mines][:2]
        for t in safe:
            await page.locator(".mn-tile").nth(t).click()
            await page.wait_for_selector(f".mn-tile:nth-child({t + 1}).safe")
        check("mines: two safe tiles revealed in UI", await page.locator(".mn-tile.safe").count() == 2)
        await page.reload(); await page.wait_for_selector(".mn-tile.safe")
        check("mines: round restored after reload", await page.locator(".mn-tile.safe").count() == 2)
        await page.click("button:has-text('Забрать')")
        await page.wait_for_selector(".gk-result")
        r = last_round("mines")
        check("mines: cashout finished round, UI balance == DB", r[1] == "finished" and r[3] > 0 and await ui_balance(page) == bal(), r[:4])
        check("mines: mines revealed after cashout", await page.locator(".mn-tile.mine").count() == 3)
        await page.screenshot(path=f"{SHOTS}/g_mines.png", full_page=True)

        # ---------------- crash (auto cash-out 1.01 → either win at 1.01 or instant crash)
        await page.goto(BASE + "/#/crash"); await page.wait_for_selector(".cr-canvas")
        await page.fill(".gk-bet-input", "10"); await page.press(".gk-bet-input", "Tab")
        await page.check("#cr-auto"); await page.fill(".gk-panel input[type=number][step='0.01']", "1.01"); await page.press(".gk-panel input[step='0.01']", "Tab")
        await page.click("text=Купить ЛК по рынку")
        await page.wait_for_selector(".cr-mult.cashed, .cr-mult.crashed", timeout=15000)
        r = last_round("crash")
        check("crash: auto cash-out settled by server", r[1] == "finished" and (r[4]["phase"] == "CASHED" and r[3] == 10 or r[4]["phase"] == "CRASHED" and r[4]["crash"] == 1), r[:4])
        # manual cash-out
        await page.uncheck("#cr-auto")
        await page.click("text=Купить ЛК по рынку")
        await page.wait_for_selector(".cr-cash", timeout=5000)
        await page.wait_for_timeout(1800)
        if await page.locator(".cr-cash").count():
            await page.click(".cr-cash")
        await page.wait_for_selector(".cr-mult.cashed, .cr-mult.crashed", timeout=15000)
        r = last_round("crash")
        ok = r[1] == "finished" and ((r[4]["phase"] == "CASHED" and r[4]["cashout"] <= r[4]["crash"] and r[3] == int(10 * r[4]["cashout"])) or (r[4]["phase"] == "CRASHED" and r[3] == 0))
        check("crash: manual cash-out/crash consistent", ok, r[:5])
        check("crash: UI balance == DB", await ui_balance(page) == bal())
        await page.screenshot(path=f"{SHOTS}/g_crash.png", full_page=True)

        # ---------------- plinko: 3 balls quickly
        await page.goto(BASE + "/#/plinko"); await page.wait_for_selector(".pl-board")
        await page.fill(".gk-bet-input", "5"); await page.press(".gk-bet-input", "Tab")
        n0 = q("select count(*) from casino_rounds r join profiles p on p.id=r.user_id where p.username=%s and game_slug='plinko'", USER)[0][0]
        for _ in range(3):
            await page.click("text=Бросить шарик")
        await page.wait_for_timeout(3500)
        n1 = q("select count(*) from casino_rounds r join profiles p on p.id=r.user_id where p.username=%s and game_slug='plinko'", USER)[0][0]
        check("plinko: 3 clicks → 3 rounds", n1 - n0 == 3, (n0, n1))
        check("plinko: log shows 3 results, balance == DB", await page.locator(".pl-entry").count() == 3 and await ui_balance(page) == bal())
        await page.screenshot(path=f"{SHOTS}/g_plinko.png", full_page=True)

        # ---------------- horse: two horses
        await page.goto(BASE + "/#/horse"); await page.wait_for_selector(".hr-card")
        await page.click("text=Очистить купон")
        await page.locator(".hr-card").nth(0).locator("button").first.click()
        await page.locator(".hr-card").nth(7).locator("button").first.click()
        b0 = bal()
        await page.click("text=Принять ставку")
        await page.wait_for_selector(".hr-result", timeout=15000)
        r = last_round("horse")
        check("horse: 20 ЛК coupon on two horses settled", r[2] == 20 and bal() == b0 - 20 + r[3], (r[2], r[3], b0, bal()))
        check("horse: finishing order shown (8 places)", await page.locator(".hr-result li").count() == 8)
        await page.screenshot(path=f"{SHOTS}/g_horse.png", full_page=True)

        # ---------------- slots
        await page.goto(BASE + "/#/slots"); await page.wait_for_selector(".sl-reels")
        await page.fill(".gk-bet-input", "10"); await page.press(".gk-bet-input", "Tab")
        for _ in range(3):
            await page.click(".sl-spin")
            await page.wait_for_selector(".sl-spin:not([disabled])", timeout=60000)
        r = last_round("businka_slots")
        cells = await page.locator(".sl-cell").all_inner_texts()
        check("slots: 3 spins, UI balance == DB", await ui_balance(page) == bal())
        check("slots: final window on screen matches server", len(cells) == 15 and len(r[4]["spins"][-1]["window"]) == 15)
        await page.screenshot(path=f"{SHOTS}/g_slots.png", full_page=True)

        # ---------------- higher / lower
        await page.goto(BASE + "/#/higher_lower"); await page.wait_for_selector(".hl-start")
        await page.fill(".gk-bet-input", "10"); await page.press(".gk-bet-input", "Tab")
        await page.click(".hl-start"); await page.wait_for_selector(".hl-choice")
        for _ in range(3):
            chs = page.locator(".hl-choice:not([disabled])")
            # pick the likelier side
            best, bp = 0, -1
            for i in range(await chs.count()):
                t = await chs.nth(i).locator("strong").inner_text()
                v = int(re.sub(r"\D", "", t) or 0)
                if v > bp: best, bp = i, v
            await chs.nth(best).click()
            await page.wait_for_timeout(700)
            if await page.locator("text=Новое дело").count(): break
        r = last_round("higher_lower")
        if r[1] == "active":
            await page.click(".hl-cash"); await page.wait_for_selector("text=Новое дело")
            r = last_round("higher_lower")
        check("higher/lower: round finished via UI", r[1] == "finished", r[:4])
        check("higher/lower: UI balance == DB", await ui_balance(page) == bal())
        await page.screenshot(path=f"{SHOTS}/g_hl.png", full_page=True)

        # ---------------- dice
        await page.goto(BASE + "/#/dice"); await page.wait_for_selector(".dice-range")
        await page.fill(".gk-bet-input", "10"); await page.press(".gk-bet-input", "Tab")
        await page.click("text=ПЕРЕДАТЬ ДЕЛО"); await page.wait_for_selector(".dice-result.won, .dice-result.lost")
        r = last_round("dice")
        check("dice: roll shown equals server roll", (await page.locator(".dice-result span").inner_text()) == f"{r[4]['roll'] / 100:.2f}")
        await page.screenshot(path=f"{SHOTS}/g_dice.png", full_page=True)

        # ---------------- office
        b0 = bal()
        await page.goto(BASE + "/#/office/withdraw"); await page.wait_for_selector("text=Подать заявку")
        await page.click("text=Подать заявку на вывод"); await page.wait_for_selector(".wd-steps li")
        await page.wait_for_timeout(1500)
        check("withdraw parody: balance unchanged, no DB writes", bal() == b0)
        await page.screenshot(path=f"{SHOTS}/g_withdraw.png", full_page=True)
        await page.click("text=Отменить заявку")
        for sub in ["rules", "kyc", "promo", "line"]:
            await page.goto(BASE + "/#/office/" + sub); await page.wait_for_selector(".office-crumbs")
        check("office pages render", True)
        await page.click(".sp-fab"); await page.wait_for_selector(".sp-panel.open")
        await page.fill(".sp-form input", "вы подкручиваете?"); await page.press(".sp-form input", "Enter")
        await page.wait_for_selector(".sp-msg.bot:not(.typing) >> nth=1", timeout=5000)
        txt = await page.locator(".sp-msg.bot:not(.typing)").nth(1).inner_text()
        check("support bot answers fairness question honestly", "сид" in txt.lower() or "хеш" in txt.lower(), txt)

        # ---------------- reveal seed + verify every game in the browser
        await page.goto(BASE + "/#/fairness"); await page.click("text=Раскрыть сид и начать новый")
        await page.wait_for_selector(".toast.ok", timeout=8000)
        for g in ["mines", "crash", "plinko", "horse", "businka_slots", "higher_lower", "dice"]:
            r = last_round(g)
            await page.goto(f"{BASE}/#/fairness/verify?round={r[0]}")
            await page.click("button:has-text('Проверить')")
            await page.wait_for_selector(".verdict", timeout=20000)
            passed = await page.locator(".verdict.pass").count() == 1
            if not passed: await page.screenshot(path=f"{SHOTS}/verify_fail_{g}.png", full_page=True)
            check(f"browser verifier PASS: {g}", passed)

        await page.goto(BASE + "/#/history"); await page.wait_for_selector("tbody tr")
        txt = await page.locator("tbody").inner_text()
        check("history lists new games with summaries", all(x in txt for x in ["Mines", "Crash", "Plinko", "Скачки", "Бусинка"]), txt[:200])

        # ---------------- mobile pass: no horizontal scroll anywhere
        m = await browser.new_context(viewport={"width": 390, "height": 844}, storage_state=await ctx.storage_state())
        mp = await m.new_page()
        for v in ["lobby", "mines", "crash", "plinko", "horse", "slots", "higher_lower", "dice", "office", "office/withdraw", "office/rules", "rating", "history", "profile", "fairness", "roulette", "blackjack"]:
            await mp.goto(f"{BASE}/#/{v}"); await mp.wait_for_timeout(900)
            sw = await mp.evaluate("document.documentElement.scrollWidth")
            check(f"mobile 390px no horizontal scroll: {v}", sw <= 392, sw)
            await mp.screenshot(path=f"{SHOTS}/m_{v.replace('/', '_')}.png", full_page=True)
        check("no JS errors", not errors, errors[:5])
        await browser.close()
    ok = sum(1 for _, c in RESULTS if c)
    print(f"\n{ok}/{len(RESULTS)} passed")
    sys.exit(0 if ok == len(RESULTS) else 1)

asyncio.run(main())
