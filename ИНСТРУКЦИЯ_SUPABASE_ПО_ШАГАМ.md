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

Это нужно делать поэтапно.

На текущий момент в фронтенде уже переведены на Edge Functions:

- проверка кода участника;
- загрузка сохранённого прогноза;
- сохранение прогноза.

То есть для основного сценария пользователя сайт уже должен ходить в:

- `check-code`
- `get-prediction`
- `save-prediction`

### Что тебе нужно сделать сейчас в Supabase Dashboard

1. Открой `Edge Functions`.
2. Убедись, что функции `check-code`, `get-prediction`, `save-prediction` созданы и задеплоены.
3. Убедись, что у них выключен `Verify JWT`, если ты пока работаешь без Supabase Auth.
4. В `check-code` и `save-prediction` должен использоваться `SUPABASE_SERVICE_ROLE_KEY`, а не публичный ключ.
5. Нажми `Invoke` и проверь:

- `check-code` с телом:

```json
{ "code": "ТУТ_РЕАЛЬНЫЙ_КОД" }
```

- `get-prediction` с телом:

```json
{ "code": "ТУТ_РЕАЛЬНЫЙ_КОД" }
```

- `save-prediction` с телом:

```json
{
  "code": "ТУТ_РЕАЛЬНЫЙ_КОД",
  "groupA": "Мексика|Чехия"
}
```

### Что проверить на сайте после деплоя этих 3 функций

1. Пользователь вводит код и проходит вход.
2. Если прогноз уже был сохранён, он подтягивается.
3. Если пользователь меняет прогноз и жмёт сохранить, в таблице `predictions` остаётся одна запись на этот `code`.
4. После обновления страницы пользователь видит последнюю версию прогноза.

### Что делать следующим этапом

После этого нужно перевести на Edge Functions ещё 4 направления:

- `get-casino`
- `save-casino`
- `get-achievements`
- `sync-achievements`

Потом:

- `get-playoff`
- `save-playoff`

И только после этого можно безопасно включать RLS на таблицах записи:

- `predictions`
- `casino`
- `achievements`
- `playoff`

Потому что пока фронт ещё хоть где-то пишет напрямую в `rest/v1`, после включения RLS эти места начнут ломаться.

### 7.3. Вынести запись из браузера на сервер

Это обязательно.

С клиента нельзя больше писать напрямую в Supabase.

Нужно вынести в `Edge Functions` или backend:

- сохранение прогноза;
- сохранение казино;
- синхронизацию ачивок;
- сохранение плей-офф;
- админское сохранение результатов.

### Почему это важно

Пока запись идёт из браузера напрямую:

- любой может подменить запрос руками;
- любой может менять данные через DevTools;
- нельзя гарантировать защиту данных;
- нельзя честно обещать, что пользователь “никогда ничего не потеряет”.

## Шаг 8. Переделать админку

Сейчас админка небезопасна.

Причина: пароль лежит прямо в `admin.html`.

Нужно:

1. убрать пароль из фронтенда;
2. сделать нормальную авторизацию администратора;
3. проверять роль админа на сервере или в `Edge Function`;
4. только после этого разрешать менять `results`.

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
