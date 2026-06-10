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

### Какие функции нужны для статистики казино

Добавь ещё 2 Edge Function:

- `log-casino-event`
- `get-casino-stats`

### Что делает `log-casino-event`

Записывает каждое завершённое событие казино:

- игра;
- ставка;
- возврат;
- итог по балансу;
- детали в `meta`.

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

### Что уже сделано в коде сайта

В текущем фронтенде уже подготовлено:

- отправка игровых событий через `log-casino-event`;
- загрузка статистики через `get-casino-stats`;
- блок статистики в разделе казино.

То есть после создания этих двух функций статистика начнёт отображаться на сайте.
