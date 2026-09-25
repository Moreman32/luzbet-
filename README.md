# ЛузБет 2.0

Закрытое виртуальное казино для своих. Виртуальные ЛК, серверная авторитетность, provably fair.
Реальных денег нет и не будет.

## Что работает
- Вход по логину и паролю (Supabase Auth, логины выдаёт администрация), смена пароля, выход, выход на всех устройствах.
- Европейская рулетка: все ставки стола (число, сплит, стрит, трио, корнер, первая четвёрка, линия, колонка, дюжина, цвет, чёт/нечёт, половины).
- Блэкджек: 6 колод, S17, 3:2, удвоение, сплит, DAS, восстановление раздачи после обновления страницы.
- Provably fair: хеш server seed до ставки, client seed игрока, nonce, раскрытие по ротации, проверка любого раунда в браузере.
- Кошелёк: баланс меняется только через append-only ledger с идемпотентностью.
- Ежедневная финансовая помощь, история, статистика.
- Бэк-офис (только с MFA): игроки, корректировки баланса через ledger с причиной, блокировка, временные пароли, роли, аудит, события безопасности.

## Структура
```
index.html, assets/          фронтенд (vanilla ES modules, без сборки; supabase-js вендорен)
supabase/migrations/         вся схема 2.0 (применена к проекту kdsowktuirtkxnmtyoaz)
supabase/functions/          v2-login, v2-admin (Edge Functions)
tests/local/                 локальный стенд (Postgres + PostgREST + мок GoTrue + Deno) и тесты движка
tests/e2e/                   браузерный E2E (Playwright)
tests/math/                  офлайн-симуляции RTP
legacy/                      код ЛузБета 1.0 (архив, не деплоится)
```

## Тесты
```
tests/local/reset_db.sh && python3 tests/local/test_engine.py   # 150 проверок: RLS, гранты, гонки, идемпотентность, сверка с эталоном
tests/e2e/run.sh                                                 # 43 браузерные проверки
python3 tests/math/simulate.py 10000000 200000                   # RTP рулетки и блэкджека
```

Документы: ARCHITECTURE.md, DATABASE_DESIGN.md, SECURITY_MODEL.md, THREAT_MODEL.md, FAIRNESS.md, CASINO_MATH.md, TEST_PLAN.md, MIGRATION_PLAN.md, IMPLEMENTATION_PLAN.md, BUILD_STATUS.md.
