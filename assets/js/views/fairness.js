import { sb, rpc } from "../api.js";
import { h, clear, fmt, dt, toast, actionButton } from "../ui.js";
import { meme } from "../memes.js";
import { sha256hex, rouletteNumber, shuffle, blackjackReplay, roulettePayout, colorOf } from "../fair.js";
import { cardLabel } from "./shared.js";

export async function mount(root, { app, sub, params }) {
  if (sub === "verify") return verifyPage(root, app, params.get("round"));
  await app.refreshMe();
  const s = app.me.seed;
  const { data: revealed } = await sb.from("fair_seeds").select("id,server_seed,server_seed_hash,client_seed,next_nonce,revealed_at,created_at")
    .eq("status", "revealed").order("revealed_at", { ascending: false }).limit(20);
  const clientInput = h("input", { class: "input mono", maxlength: 64, placeholder: "оставьте пустым — сгенерируем", "aria-label": "Новый client seed" });

  root.append(h("div", { class: "container stack" },
    h("div", { class: "game-head" }, h("div", {}, h("div", { class: "eyebrow" }, "Provably fair"), h("h1", {}, "Честность"))),
    h("div", { class: "card gilded stack" },
      h("h3", {}, "Почему касса не может подкрутить исход"),
      h("p", { class: "muted" }, "Перед вашей первой ставкой сервер генерирует секретный server seed и показывает вам только его SHA-256 хеш. Хеш нельзя «подогнать» задним числом: любой другой сид даст другой хеш."),
      h("p", { class: "muted" }, "Каждый исход вычисляется детерминированно из server seed, вашего client seed и счётчика nonce. Client seed выбираете вы, nonce растёт на 1 с каждой ставкой. Когда вы меняете пару сидов, старый server seed раскрывается — и любой раунд можно пересчитать прямо в браузере."),
      h("details", { class: "more" }, h("summary", {}, "Технические детали"),
        h("div", { class: "stack muted", style: { fontSize: "14px" } },
          h("p", {}, "Поток случайности: HMAC-SHA256(key = server seed, message = client seed : nonce : cursor), cursor = 0, 1, 2… Каждый блок даёт восемь 32-битных чисел (big-endian)."),
          h("p", {}, "Равномерное целое в [0, m): принимаем u, если u < ⌊2³²/m⌋·m, иначе берём следующее. Результат u mod m. Так нет смещения по модулю."),
          h("p", {}, "Рулетка: одно число mod 37. Блэкджек: тасовка Фишера–Йетса по 312 картам (6 колод), j = rand(i+1) для i = 311…1; карта c → ранг c mod 13, масть ⌊c/13⌋ mod 4. Порядок раздачи: игрок, дилер, игрок, дилер (закрытая), далее по шузу."),
          h("p", {}, "Сид нельзя сменить, пока идёт незавершённая раздача: иначе вы узнали бы будущие карты.")))),
    h("div", { class: "card stack" },
      h("div", { class: "eyebrow" }, "Текущая пара сидов"),
      h("dl", { class: "kv" },
        h("dt", {}, "Хеш server seed"), h("dd", { class: "mono" }, s.serverSeedHash),
        h("dt", {}, "Client seed"), h("dd", { class: "mono" }, s.clientSeed),
        h("dt", {}, "Следующий nonce"), h("dd", { class: "num" }, String(s.nextNonce))),
      h("div", { class: "field" }, h("label", {}, "Новый client seed"), clientInput),
      actionButton("Раскрыть сид и начать новый", async () => {
        try {
          const r = await rpc("rpc_rotate_seed", { p_new_client_seed: clientInput.value.trim() || null });
          toast("Сид раскрыт. Теперь все его раунды можно проверить.", "ok");
          app.route();
          return r;
        } catch (e) { toast(e.message, "error"); }
      }, { class: "btn primary" })),
    h("div", { class: "card stack" },
      h("div", { class: "eyebrow" }, "Раскрытые сиды"),
      (revealed || []).length ? h("div", { class: "table-wrap" }, h("table", { class: "table" },
        h("thead", {}, h("tr", {}, h("th", {}, "Раскрыт"), h("th", {}, "Server seed"), h("th", {}, "Client seed"), h("th", { class: "r" }, "Раундов"))),
        h("tbody", {}, revealed.map((x) => h("tr", {}, h("td", {}, dt(x.revealed_at)), h("td", { class: "mono" }, x.server_seed),
          h("td", { class: "mono" }, x.client_seed), h("td", { class: "r num" }, fmt(x.next_nonce)))))))
        : h("p", { class: "muted" }, "Пока ни один сид не раскрыт. Раскройте текущий, чтобы проверить сыгранные раунды."),
      h("a", { href: "#/history" }, "Выбрать раунд для проверки в истории →"))));
}

async function verifyPage(root, app, roundId) {
  const out = h("div", { class: "stack" });
  root.append(h("div", { class: "container stack" },
    h("div", { class: "game-head" }, h("div", {}, h("div", { class: "eyebrow" }, "Верификатор"), h("h1", {}, "Проверка раунда"))), out));
  if (!roundId) { out.appendChild(h("p", { class: "muted" }, "Выберите раунд в истории.")); return; }
  const { data: r } = await sb.from("casino_rounds").select("*").eq("id", roundId).single();
  if (!r) { out.appendChild(h("p", { class: "loss" }, "Раунд не найден.")); return; }
  const { data: seed } = await sb.from("fair_seeds").select("*").eq("id", r.seed_id).single();
  const { data: actions } = await sb.from("casino_actions").select("seq,action").eq("round_id", r.id).order("seq");

  const facts = h("dl", { class: "kv" },
    h("dt", {}, "Игра"), h("dd", {}, r.game_slug),
    h("dt", {}, "Раунд"), h("dd", { class: "mono" }, r.id),
    h("dt", {}, "Правила"), h("dd", { class: "mono" }, r.rule_version_id),
    h("dt", {}, "Хеш server seed"), h("dd", { class: "mono" }, r.server_seed_hash),
    h("dt", {}, "Server seed"), h("dd", { class: "mono" }, seed?.server_seed || "ещё не раскрыт"),
    h("dt", {}, "Client seed"), h("dd", { class: "mono" }, r.client_seed),
    h("dt", {}, "Nonce"), h("dd", { class: "mono" }, String(r.nonce)),
    h("dt", {}, "Исход на сервере"), h("dd", {}, r.game_slug === "roulette" ? `${r.state.number}, выплата ${fmt(r.payout)}` : `выплата ${fmt(r.payout)}`));
  const verdictEl = h("div");
  out.append(h("div", { class: "card stack" }, facts), verdictEl);

  if (!seed?.server_seed) {
    clear(verdictEl, h("div", { class: "card stack" },
      h("p", {}, "Сид этого раунда ещё активен, поэтому серверный секрет не раскрыт. Раскройте пару сидов — проверить можно будет сразу."),
      actionButton("Раскрыть сид сейчас", async () => {
        try { await rpc("rpc_rotate_seed", { p_new_client_seed: null }); app.route(); } catch (e) { toast(e.message, "error"); }
      }, { class: "btn primary" })));
    return;
  }

  const button = actionButton("Проверить, что касса тебя не наебала", async () => {
    const checks = [];
    const hash = await sha256hex(seed.server_seed);
    checks.push(["SHA-256(server seed) совпадает с хешем, показанным до ставки", hash === r.server_seed_hash]);
    if (r.game_slug === "roulette") {
      const n = await rouletteNumber(seed.server_seed, r.client_seed, r.nonce);
      checks.push([`Число из сидов: ${n} (${colorOf(n)})`, n === r.state.number]);
      const pay = roulettePayout(r.request, n);
      checks.push([`Выплата по вашим ставкам: ${fmt(pay)} ЛК`, pay === Number(r.payout)]);
    } else if (r.game_slug === "blackjack") {
      const deck = await shuffle(seed.server_seed, r.client_seed, r.nonce);
      const acts = (actions || []).filter((a) => a.action !== "start").map((a) => a.action);
      const rep = blackjackReplay(deck, Number(r.request.bet), acts);
      const sameHands = JSON.stringify(rep.hands.map((x) => x.cards)) === JSON.stringify(r.state.hands.map((x) => x.cards));
      checks.push([`Шуз из сидов → ваши руки: ${rep.hands.map((x) => x.cards.map(cardLabel).join(" ")).join(" | ")}`, sameHands]);
      checks.push([`Дилер: ${rep.dealer.map(cardLabel).join(" ")}`, JSON.stringify(rep.dealer) === JSON.stringify(r.state.dealer)]);
      checks.push([`Выплата по правилам: ${fmt(rep.payout)} ЛК`, rep.payout === Number(r.payout)]);
    }
    const pass = checks.every((c) => c[1]);
    clear(verdictEl, h("div", { class: ["verdict", pass ? "pass" : "fail"] },
      h("h2", {}, pass ? "✓ Результат подтверждён." : "✗ Проверка не прошла"),
      h("p", { class: "meme-line" }, meme(pass ? "fair.pass" : "fair.fail")),
      h("ul", { style: { textAlign: "left", marginTop: "16px" } }, checks.map(([t, ok]) => h("li", { class: ok ? "win" : "loss" }, (ok ? "✓ " : "✗ ") + t)))));
  }, { class: "btn primary lg block" });
  verdictEl.appendChild(button);
}
