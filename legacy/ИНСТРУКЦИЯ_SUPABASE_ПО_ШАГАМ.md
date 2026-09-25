# Инструкция по Supabase по шагам

Это единственный файл, который тебе нужен.

Ниже есть:

- порядок действий;
- готовый SQL;
- что проверять после каждого этапа;
- что ещё обязательно доделать, чтобы проект стал безопасным и стабильным.

## Что уже исправлено в коде

В проекте уже поправлено следующее:

- уменьшен риск тихой потери данных при синхронизации казино и ачивок;
- чтение прогнозов и плей-офф теперь берёт последнюю запись более предсказуемо;
- лидерборд и админка лучше переживают дубли;
- исправлен учёт `spent` для части игр казино;
- экранированы опасные вставки текста в HTML.

Но этого недостаточно.

Основные шаги нужно сделать в самой базе Supabase.

## Порядок действий

### 1. Сделай резервную копию базы

Перед любыми изменениями сначала сделай бэкап базы в Supabase.

Это обязательно.

### 2. Открой `SQL Editor`

В Supabase зайди в проект и открой `SQL Editor`.

Дальше выполняй блоки **по порядку**.

## Шаг 1. Удалить дубли

Сначала выполни этот SQL:

```sql
-- Оставляем только самую новую запись прогноза на один code
delete from public.predictions p
using public.predictions newer
where lower(p.code) = lower(newer.code)
  and p.id < newer.id;

-- Оставляем только самую новую запись плей-офф на один code
delete from public.playoff p
using public.playoff newer
where lower(p.code) = lower(newer.code)
  and p.id < newer.id;

-- Оставляем только последнюю запись результата на группу
delete from public.results r
using public.results newer
where r.group_code = newer.group_code
  and r.id < newer.id;

-- Удаляем дубли одинаковых ачивок
delete from public.achievements a
using public.achievements newer
where lower(a.code) = lower(newer.code)
  and a.achievement = newer.achievement
  and a.id < newer.id;
```

### Что делает этот шаг

- чистит дубли в `predictions`;
- чистит дубли в `playoff`;
- чистит дубли в `results`;
- чистит дубли в `achievements`.

### Почему это важно

Если сначала добавить уникальные ограничения, а дубли уже есть, SQL просто не применится.

## Шаг 2. Добавить ограничения

После удаления дублей выполни этот SQL:

```sql
alter table public.predictions
  add constraint predictions_code_key unique (code);

alter table public.playoff
  add constraint playoff_code_key unique (code);

alter table public.results
  add constraint results_group_code_key unique (group_code);

alter table public.achievements
  add constraint achievements_code_achievement_key unique (code, achievement);

alter table public.predictions
  add constraint predictions_code_fkey
  foreign key (code) references public.participants(code);

alter table public.casino
  add constraint casino_code_fkey
  foreign key (code) references public.participants(code);

alter table public.achievements
  add constraint achievements_code_fkey
  foreign key (code) references public.participants(code);

alter table public.playoff
  add constraint playoff_code_fkey
  foreign key (code) references public.participants(code);

alter table public.casino
  add constraint casino_coins_nonnegative check (coins >= 0),
  add constraint casino_spent_nonnegative check (spent >= 0);
```

### Что делает этот шаг

- запрещает несколько прогнозов на один `code`;
- запрещает несколько плей-офф прогнозов на один `code`;
- запрещает несколько строк результатов на одну группу;
- запрещает одну и ту же ачивку несколько раз для одного игрока;
- привязывает игровые таблицы к реальным участникам;
- запрещает отрицательные значения `coins` и `spent`.

### Почему это важно

Это самый важный шаг для корректности.

Без него база продолжает принимать мусор и дубли.

## Шаг 3. Добавить `updated_at`

Теперь выполни этот SQL:

```sql
alter table public.playoff
  add column if not exists updated_at timestamp with time zone default now();

alter table public.results
  add column if not exists updated_at timestamp with time zone default now();

alter table public.playoff_results
  add column if not exists updated_at timestamp with time zone default now();
```

### Что делает этот шаг

Добавляет временные метки обновления туда, где их не хватает.

### Почему это важно

Это нужно, чтобы потом всегда можно было понять, какая запись последняя.

## Шаг 4. Автоматически обновлять `updated_at`

Теперь выполни этот SQL:

```sql
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_predictions_updated_at on public.predictions;
create trigger set_predictions_updated_at
before update on public.predictions
for each row execute function public.set_updated_at();

drop trigger if exists set_playoff_updated_at on public.playoff;
create trigger set_playoff_updated_at
before update on public.playoff
for each row execute function public.set_updated_at();

drop trigger if exists set_results_updated_at on public.results;
create trigger set_results_updated_at
before update on public.results
for each row execute function public.set_updated_at();

drop trigger if exists set_playoff_results_updated_at on public.playoff_results;
create trigger set_playoff_results_updated_at
before update on public.playoff_results
for each row execute function public.set_updated_at();
```

### Что делает этот шаг

Автоматически обновляет `updated_at` при изменении записи.

## Шаг 5. Проверить базу после миграций

После SQL проверь руками, что всё работает.

### Проверь так

1. Новый пользователь входит и сохраняет прогноз.
2. Тот же пользователь снова входит и видит свой прогноз.
3. Пользователь меняет прогноз до дедлайна и видит именно последнюю версию.
4. Пользователь играет в казино, закрывает вкладку, открывает снова и видит тот же баланс.
5. Пользователь получает ачивку, обновляет страницу и ачивка остаётся.
6. Плей-офф сохраняется один раз и не размножается.
7. Админ сохраняет результаты, и в `results` остаётся по одной записи на группу.

## Шаг 6. Проверить, что дубли больше не создаются

Посмотри в таблицах:

- `predictions` — одна запись на `code`;
- `playoff` — одна запись на `code`;
- `results` — одна запись на `group_code`;
- `achievements` — одна запись на `code + achievement`;
- `casino` — одна запись на `code`.

Если видишь новые дубли после этих ограничений, значит где-то запись идёт в обход нормальной логики.

## Шаг 7. Обязательно доделать безопасность

Вот здесь начинается настоящая защита.

Сейчас проект всё ещё небезопасен, потому что браузер напрямую пишет в Supabase.

Нужно сделать следующее.

### 7.1. Включить RLS

Нужно включить `RLS` на всех таблицах:

- `participants`
- `predictions`
- `casino`
- `achievements`
- `playoff`
- `results`
- `playoff_results`

### 7.2. Запретить анонимные прямые записи

После включения RLS нужно запретить анонимным пользователям прямые:

- `INSERT`
- `UPDATE`
- `DELETE`

на таблицы:

- `predictions`
- `casino`
- `achievements`
- `playoff`
- `results`
- `playoff_results`

### 7.3. Переключить фронт с `rest/v1` на Edge Functions

Это уже нужно довести до конца.

Текущий код проекта теперь ожидает, что сайт и админка будут ходить через функции.

### Полный список функций, которые должны быть созданы

#### Пользовательские функции

- `check-code`
- `get-prediction`
- `save-prediction`
- `get-casino`
- `save-casino`
- `claim-daily-bonus`
- `claim-casino-cashback`
- `get-achievements`
- `sync-achievements`
- `get-playoff`
- `save-playoff`
- `public-site-data`

#### Админские функции

- `admin-auth`
- `admin-results-list`
- `admin-results-save`
- `admin-results-delete`
- `admin-dashboard-data`

### Что уже переведено в коде

В текущем коде уже ожидается, что через функции будут работать:

- вход по коду;
- чтение и сохранение обычного прогноза;
- чтение и сохранение казино;
- чтение и синхронизация ачивок;
- чтение и сохранение плей-офф;
- публичные данные для лидерборда;
- админская загрузка результатов;
- админское сохранение результатов;
- админское удаление результатов;
- админская проверка прогнозов;
- админская таблица лидеров;
- админская авторизация через сервер.

### Какие секреты нужно добавить в Dashboard

Открой:

`Supabase Dashboard -> Edge Functions -> Secrets`

Добавь:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_PANEL_PASSWORD`

`ADMIN_PANEL_PASSWORD` — это новый пароль админки.

Он должен храниться только в секрете функции, а не в `admin.html`.

### Что должно быть выключено

Если ты пока не используешь Supabase Auth, у функций можно оставить `Verify JWT = OFF`.

Но доступ к админским функциям всё равно должен проверяться внутри функции по заголовку:

- `x-admin-pass`

### Что должна делать функция `public-site-data`

Она должна заменить прямые публичные чтения из:

- `predictions`
- `results`
- `casino`
- `achievements`
- `playoff_results`

И возвращать готовый JSON примерно такого вида:

```json
{
  "ok": true,
  "leaderboard": [],
  "results": {},
  "casinoRows": [],
  "achRows": []
}
```

Важно:

- `leaderboard` уже должен быть собран функцией;
- `results` должны быть приведены к формату, который ожидает фронт;
- `casinoRows` лучше возвращать уже с `name`;
- `achRows` лучше возвращать уже с `name`;
- не нужно больше отдавать в публичный фронт список всех участников и их кодов.

### Что должны делать админские функции

#### `admin-auth`

Проверяет пароль из заголовка `x-admin-pass`.

Сравнивает его с секретом `ADMIN_PANEL_PASSWORD`.

Если пароль верный, возвращает:

```json
{ "ok": true }
```

#### `admin-results-list`

Возвращает строки из таблицы `results`.

#### `admin-results-save`

Принимает:

```json
{
  "group_code": "A",
  "data": {
    "team1": "Мексика",
    "team2": "Чехия",
    "m1": "2-1"
  }
}
```

И делает `upsert` по `group_code`.

#### `admin-results-delete`

Принимает:

```json
{
  "group_code": "A"
}
```

И удаляет только одну группу.

#### `admin-dashboard-data`

Возвращает:

```json
{
  "ok": true,
  "predictions": [],
  "results": [],
  "casino": [],
  "achievements": []
}
```

Этого хватает для:

- вкладки проверки прогнозов;
- админской таблицы лидеров.

### Что нужно сделать в Dashboard прямо сейчас

1. Создать все функции из списка выше.
2. Задеплоить их.
3. Добавить `ADMIN_PANEL_PASSWORD` в secrets.
4. Проверить каждую функцию через `Invoke`.
5. Только после этого идти дальше к RLS.

### Что проверить после деплоя пользовательских функций

1. Пользователь вводит код и проходит вход.
2. Если прогноз уже был сохранён, он подтягивается.
3. Если пользователь меняет прогноз и жмёт сохранить, в таблице `predictions` остаётся одна запись на этот `code`.
4. После обновления страницы пользователь видит последнюю версию прогноза.
5. Казино сохраняет баланс после обновления страницы.
6. Ачивки не пропадают после обновления страницы.
7. Плей-офф сохраняется и потом читается обратно.
8. Лидерборд открывается без прямых чтений из браузера.

### Что проверить после деплоя админских функций

1. Вход в `admin.html` проходит только с правильным паролем.
2. Загрузка результатов работает.
3. Сохранение результатов работает.
4. Удаление результатов группы работает.
5. Проверка прогнозов работает.
6. Админская таблица лидеров работает.

## Шаг 8. Переделать админку

Это уже тоже должно быть сделано через функции.

Теперь админка не должна:

- хранить пароль в HTML;
- читать таблицы напрямую через `rest/v1`;
- писать в `results` напрямую из браузера.

Если в проекте ещё остался старый путь через прямые REST-запросы, его нужно считать устаревшим и не использовать.

## Что самое важное по приоритету

Если делать строго по важности, то порядок такой:

1. Бэкап базы.
2. Удаление дублей.
3. Добавление ограничений и внешних ключей.
4. Проверка руками, что данные не ломаются.
5. Включение RLS.
6. Запрет прямых записей из браузера.
7. Вынос всех записей в `Edge Functions` или backend.
8. Переделка админки.

## Что уже можно считать улучшенным после SQL

После шагов 1–4:

- база станет гораздо стабильнее;
- дубли перестанут плодиться;
- чтение данных станет предсказуемее;
- часть потерь данных уйдёт;
- лидерборд и админка будут работать корректнее.

Но проект ещё не будет полностью безопасным.

## Что можно считать действительно безопасным состоянием

Проект можно считать нормально защищённым только если выполнены все условия:

- есть уникальные ограничения;
- есть внешние ключи;
- есть проверки на отрицательные значения;
- включён RLS;
- анонимные прямые записи запрещены;
- все записи идут через серверную логику;
- админка не хранит пароль в HTML.

## Финальная проверка

Когда всё доделаешь, пройди полный пользовательский путь:

1. Войти по коду.
2. Сохранить прогноз.
3. Закрыть вкладку.
4. Открыть снова.
5. Проверить, что прогноз сохранился.
6. Поиграть в казино.
7. Обновить страницу.
8. Проверить баланс.
9. Получить ачивку.
10. Снова обновить страницу.
11. Проверить ачивку.
12. Посмотреть рейтинг.
13. Выйти.
14. Войти снова.
15. Убедиться, что всё на месте.

## Честный итог

То, что уже исправлено в коде, уменьшает баги и потери.

Но главная надёжность зависит не от HTML, а от базы и архитектуры.

Поэтому твоя реальная цель сейчас:

1. сначала привести в порядок схему базы;
2. потом закрыть прямой доступ из браузера;
3. потом перевести запись на серверную сторону.

## Отдельно: статистика казино

Если хочешь видеть нормальную статистику казино по дням, одной таблицы `casino` недостаточно.

`casino` хранит только текущее состояние:

- сколько монет осталось;
- сколько всего потрачено.

Для статистики нужна отдельная история событий.

### Таблица для истории казино

Выполни в `SQL Editor`:

```sql
create table if not exists public.casino_events (
  id bigint generated always as identity primary key,
  code text not null references public.participants(code),
  game text not null,
  event_type text not null default 'round',
  bet integer not null default 0,
  payout integer not null default 0,
  delta integer not null default 0,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  check (bet >= 0),
  check (payout >= 0)
);

create index if not exists casino_events_code_created_at_idx
  on public.casino_events (code, created_at desc);

create index if not exists casino_events_created_at_idx
  on public.casino_events (created_at desc);
```

И добавь в `casino` отдельное поле для серверного кешбека:

```sql
alter table public.casino
  add column if not exists last_cashback timestamp with time zone;
```

### Какие функции нужны для статистики казино

Добавь ещё 4 Edge Function:

- `log-casino-event`
- `get-casino-stats`
- `claim-daily-bonus`
- `claim-casino-cashback`

### Что нужно поправить в старых функциях казино

#### `get-casino`

Функция должна возвращать не только:

- `coins`
- `spent`
- `last_daily`

но ещё и:

- `last_cashback`

#### `save-casino`

Очень важно:

- `save-casino` больше не должна принимать `last_daily` от клиента;
- `save-casino` больше не должна принимать `last_cashback` от клиента;
- она должна обновлять только:
  - `coins`
  - `spent`
  - `name`

Иначе клиент сможет случайно или специально сбить серверную защиту daily bonus и кешбека.

### Что делает `log-casino-event`

Записывает каждое завершённое событие казино:

- игра;
- тип события `event_type`;
- ставка;
- возврат;
- итог по балансу;
- детали в `meta`.

### Чек-лист для `log-casino-event`

Функция должна:

- принимать `code`, `game`, `event_type`, `bet`, `payout`, `delta`, `meta`;
- проверять, что `code` передан и существует в `public.participants`;
- приводить `bet`, `payout`, `delta` к числам;
- если `event_type` не передан, ставить `round`;
- если `meta` не передан, ставить пустой объект `{}`;
- записывать строку в `public.casino_events`;
- возвращать `{ ok: true }` без лишних данных.

### Готовый код `log-casino-event`

Создай Edge Function с именем:

- `log-casino-event`

И вставь в неё этот код:

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ALLOWED_GAMES = new Set([
  "slots",
  "blackjack",
  "wheel",
  "system",
  "dice",
  "crash",
  "higher_lower",
  "horse",
  "plinko",
  "mines",
  "tower",
]);

const ALLOWED_EVENT_TYPES = new Set(["round", "bonus"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

function toInt(value: unknown, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));

    const code = String(body?.code || "").trim();
    const game = String(body?.game || "").trim();
    const eventTypeRaw = String(body?.event_type || "round").trim() || "round";
    const event_type = ALLOWED_EVENT_TYPES.has(eventTypeRaw) ? eventTypeRaw : "round";
    const bet = toInt(body?.bet, 0);
    const payout = toInt(body?.payout, 0);
    const delta = toInt(body?.delta, payout - bet);
    const meta =
      body?.meta && typeof body.meta === "object" && !Array.isArray(body.meta)
        ? body.meta
        : {};

    if (!code) {
      return json({ ok: false, error: "code is required" }, 400);
    }

    if (!game || !ALLOWED_GAMES.has(game)) {
      return json({ ok: false, error: "invalid game" }, 400);
    }

    if (bet < 0 || payout < 0) {
      return json({ ok: false, error: "bet and payout must be >= 0" }, 400);
    }

    const { data: participant, error: participantError } = await sb
      .from("participants")
      .select("code")
      .eq("code", code)
      .maybeSingle();

    if (participantError) {
      return json({ ok: false, error: participantError.message }, 500);
    }

    if (!participant) {
      return json({ ok: false, error: "participant not found" }, 404);
    }

    const { error: insertError } = await sb.from("casino_events").insert({
      code,
      game,
      event_type,
      bet,
      payout,
      delta,
      meta,
    });

    if (insertError) {
      return json({ ok: false, error: insertError.message }, 500);
    }

    return json({ ok: true });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      500,
    );
  }
});
```

### Что проверить после деплоя `log-casino-event`

1. Открой `Edge Functions -> log-casino-event -> Invoke`.
2. Передай такой JSON:

```json
{
  "code": "TEST123",
  "game": "slots",
  "event_type": "round",
  "bet": 20,
  "payout": 40,
  "delta": 20,
  "meta": {
    "result": "7-7-7",
    "jackpot": false
  }
}
```

3. Убедись, что ответ:

```json
{ "ok": true }
```

4. После этого открой таблицу `public.casino_events` и проверь, что строка появилась.

### Готовый код `claim-daily-bonus`

Создай Edge Function с именем:

- `claim-daily-bonus`

И вставь в неё этот код:

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const DAILY_BONUS_AMOUNT = 200;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function sameUtcDay(a: string | null | undefined, b: Date) {
  if (!a) return false;
  const d = new Date(a);
  return (
    d.getUTCFullYear() === b.getUTCFullYear() &&
    d.getUTCMonth() === b.getUTCMonth() &&
    d.getUTCDate() === b.getUTCDate()
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const code = String(body?.code || "").trim();

    if (!code) {
      return json({ ok: false, error: "code is required" }, 400);
    }

    const { data: participant, error: participantError } = await sb
      .from("participants")
      .select("code, name")
      .eq("code", code)
      .maybeSingle();

    if (participantError) return json({ ok: false, error: participantError.message }, 500);
    if (!participant) return json({ ok: false, error: "participant not found" }, 404);

    const { data: casinoRow, error: casinoError } = await sb
      .from("casino")
      .select("code, name, coins, spent, last_daily, last_cashback")
      .eq("code", code)
      .maybeSingle();

    if (casinoError) return json({ ok: false, error: casinoError.message }, 500);

    const now = new Date();
    if (sameUtcDay(casinoRow?.last_daily, now)) {
      return json({
        ok: true,
        amount: 0,
        last_daily: casinoRow?.last_daily || now.toISOString(),
        logged: true,
      });
    }

    const nextCoins = (Number(casinoRow?.coins || 1000) || 1000) + DAILY_BONUS_AMOUNT;
    const nextSpent = Number(casinoRow?.spent || 0) || 0;
    const last_cashback = casinoRow?.last_cashback || null;
    const last_daily = now.toISOString();

    const { error: upsertError } = await sb.from("casino").upsert({
      code,
      name: casinoRow?.name || participant.name || "",
      coins: nextCoins,
      spent: nextSpent,
      last_daily,
      last_cashback,
    }, { onConflict: "code" });

    if (upsertError) return json({ ok: false, error: upsertError.message }, 500);

    const { error: logError } = await sb.from("casino_events").insert({
      code,
      game: "system",
      event_type: "bonus",
      bet: 0,
      payout: DAILY_BONUS_AMOUNT,
      delta: DAILY_BONUS_AMOUNT,
      meta: { source: "daily_bonus" },
    });

    if (logError) return json({ ok: false, error: logError.message }, 500);

    return json({
      ok: true,
      amount: DAILY_BONUS_AMOUNT,
      last_daily,
      logged: true,
    });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      500,
    );
  }
});
```

### Готовый код `claim-casino-cashback`

Создай Edge Function с именем:

- `claim-casino-cashback`

И вставь в неё этот код:

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CASHBACK_DAILY_CAP = 300;

const VIP_CASHBACK_LEVELS = [
  { thresh: 75000, pct: 15 },
  { thresh: 35000, pct: 12 },
  { thresh: 15000, pct: 10 },
  { thresh: 5000, pct: 7 },
  { thresh: 2000, pct: 5 },
  { thresh: 500, pct: 3 },
  { thresh: 0, pct: 2 },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function sameUtcDay(a: string | null | undefined, b: Date) {
  if (!a) return false;
  const d = new Date(a);
  return (
    d.getUTCFullYear() === b.getUTCFullYear() &&
    d.getUTCMonth() === b.getUTCMonth() &&
    d.getUTCDate() === b.getUTCDate()
  );
}

function getCashbackPct(spent: number) {
  return (VIP_CASHBACK_LEVELS.find((x) => spent >= x.thresh) || VIP_CASHBACK_LEVELS[VIP_CASHBACK_LEVELS.length - 1]).pct;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const code = String(body?.code || "").trim();

    if (!code) {
      return json({ ok: false, error: "code is required" }, 400);
    }

    const { data: participant, error: participantError } = await sb
      .from("participants")
      .select("code, name")
      .eq("code", code)
      .maybeSingle();

    if (participantError) return json({ ok: false, error: participantError.message }, 500);
    if (!participant) return json({ ok: false, error: "participant not found" }, 404);

    const { data: casinoRow, error: casinoError } = await sb
      .from("casino")
      .select("code, name, coins, spent, last_daily, last_cashback")
      .eq("code", code)
      .maybeSingle();

    if (casinoError) return json({ ok: false, error: casinoError.message }, 500);

    const now = new Date();
    if (sameUtcDay(casinoRow?.last_cashback, now)) {
      return json({
        ok: true,
        amount: 0,
        last_cashback: casinoRow?.last_cashback || now.toISOString(),
        logged: true,
      });
    }

    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const nextDayStart = new Date(dayStart);
    nextDayStart.setUTCDate(nextDayStart.getUTCDate() + 1);

    const { data: rows, error: statsError } = await sb
      .from("casino_events")
      .select("delta, game, event_type")
      .eq("code", code)
      .eq("event_type", "round")
      .neq("game", "system")
      .gte("created_at", dayStart.toISOString())
      .lt("created_at", nextDayStart.toISOString());

    if (statsError) return json({ ok: false, error: statsError.message }, 500);

    const net = (rows || []).reduce((sum, row) => sum + (Number(row.delta || 0) || 0), 0);
    const rawLoss = Math.max(0, -Math.round(net));
    const spent = Number(casinoRow?.spent || 0) || 0;
    const cashbackPct = getCashbackPct(spent);
    const amount = Math.min(CASHBACK_DAILY_CAP, Math.floor(rawLoss * cashbackPct / 100));

    if (amount <= 0) {
      return json({
        ok: true,
        amount: 0,
        last_cashback: casinoRow?.last_cashback || null,
        logged: true,
      });
    }

    const nextCoins = (Number(casinoRow?.coins || 1000) || 1000) + amount;
    const nextSpent = spent;
    const last_daily = casinoRow?.last_daily || null;
    const last_cashback = now.toISOString();

    const { error: upsertError } = await sb.from("casino").upsert({
      code,
      name: casinoRow?.name || participant.name || "",
      coins: nextCoins,
      spent: nextSpent,
      last_daily,
      last_cashback,
    }, { onConflict: "code" });

    if (upsertError) return json({ ok: false, error: upsertError.message }, 500);

    const { error: logError } = await sb.from("casino_events").insert({
      code,
      game: "system",
      event_type: "bonus",
      bet: 0,
      payout: amount,
      delta: amount,
      meta: {
        source: "daily_cashback",
        cashback_percent: cashbackPct,
        based_on_loss: rawLoss,
        capped_at: CASHBACK_DAILY_CAP,
      },
    });

    if (logError) return json({ ok: false, error: logError.message }, 500);

    return json({
      ok: true,
      amount,
      last_cashback,
      logged: true,
    });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      500,
    );
  }
});
```

### Какие `game` уже реально отправляет фронт

Ниже точный список значений, которые сайт уже шлёт в `log-casino-event`:

- `slots`
- `blackjack`
- `wheel`
- `system`
- `dice`
- `crash`
- `higher_lower`
- `horse`
- `plinko`
- `mines`
- `tower`

### Какие `event_type` уже реально отправляет фронт

- `round`
  Используется для обычных игровых раундов.
- `bonus`
  Используется для системных начислений через `game: "system"`.

### Что сейчас приходит в `meta`

Формат `meta` может быть разным в зависимости от игры. Это нормально, его не нужно жёстко ограничивать схемой.

Примеры:

- `slots`: `result`, `jackpot`, `two_match`
- `blackjack`: `result`, `player_score`, `dealer_score`
- `wheel`: `segment`, `mult`
- `system`: `source`
- `dice`: `guess`, `d1`, `d2`, `sum`, `multiplier`
- `crash`: `result`, `crash_at`, `multiplier`
- `higher_lower`: `result`, `streak`, `pot`
- `horse`: `selected`, `winner`, `selected_name`, `winner_name`
- `plinko`: `multiplier`, `slot_index`
- `mines`: `opened`, `mine_at`, `multiplier`
- `tower`: `level`, `bomb_col`, `picked`, `multiplier`

### Что делает `get-casino-stats`

Считает статистику игрока по дням:

- сколько игр;
- сколько побед;
- сколько поражений;
- сколько поставлено;
- сколько возвращено;
- чистый итог;
- `winrate`;
- `RTP`.

И дополнительно должен возвращать статистику по каждой игре отдельно:

- `slots`
- `blackjack`
- `wheel`
- `system`
- `dice`
- `crash`
- `higher_lower`
- `horse`
- `plinko`
- `mines`
- `tower`

Желательный формат ответа:

```json
{
  "ok": true,
  "summary": {},
  "days": [],
  "per_game": []
}
```

### Что уже сделано в коде сайта

В текущем фронтенде уже подготовлено:

- отправка игровых событий через `log-casino-event`;
- загрузка статистики через `get-casino-stats`;
- блок статистики в разделе казино.

То есть после создания этих двух функций статистика начнёт отображаться на сайте.
