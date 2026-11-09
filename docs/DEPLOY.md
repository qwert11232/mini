# 🚀 Деплой: Vercel + Neon + Telegram

Схема работы: Telegram открывает мини-апп → внутри мини-аппа переход на сайт →
сайт на Vercel, данные в Neon. Локально всё открывается без установки (см. ниже).

```text
Telegram (бота-меню / кнопка web_app)
        │  открывает https://<проект>.vercel.app/?tgWebAppData=…
        ▼
Vercel: статика (dist) + функции /api/*
        │  @neondatabase/serverless (HTTP, без пула)
        ▼
Neon: users · courts · coaches · training_sessions · free_slots · bookings · products · orders
```

---

## 0. Текущие координаты проекта

| Что | Значение |
| --- | --- |
| GitHub | `qwert11232/mini` |
| Vercel-проект | `mini` |
| Production-домен (заглушка) | `https://mini-seven-xi.vercel.app` |
| Neon | `ep-weathered-cell-b8fnxjpq-pooler.c-14.us-east-1.aws.neon.tech`, база `neondb` |
| Бот | `@testtesttennisbot` |
| Админ | `@nikita_tsk` · Telegram ID `793536041` |
| Оплата | на ресепшене (`orders.status = reserved`), онлайн-платежей нет |

Важно: Vercel собирает ветку **main**. Работа ведётся в `arena/20f16b78-mini`,
поэтому изменения попадают на сайт только после merge в `main`.

---

## 1. Посмотреть сайт здесь, без установки

В песочнице уже запущен `npm run dev` — сайт доступен по превью-ссылке.
Vercel и Neon для этого не нужны: `server/preview-api.ts` поднимает те же маршруты
`/api/*`, данные — из `src/data/club.ts`, запись — в `.preview/db.json` (в git не попадает).

```bash
npm run dev     # http://localhost:5173 — сайт + эмулятор API
npm run build   # типы + production-сборка
npm run smoke   # рендер собранного бандла в jsdom + проверка /api
```

Проверить API руками:

```bash
curl -s localhost:5173/api/health     # {"mode":"preview","ok":true}
curl -s localhost:5173/api/catalog    # корты, тренеры, занятия, окна, товары
```

Если `/api` недоступен, витрина может показывать демо-данные, но реальные брони и заказы не создаются. В `npm run dev` работает локальный эмулятор.

---

## 2. Neon

1. Neon подключён к Vercel через интеграцию. **Внимание на префикс:** если в
   Installation → Settings задан Custom Prefix (у нас был `tennisapp_`), переменные
   называются `tennisapp_DATABASE_URL`, `tennisapp_POSTGRES_PRISMA_URL` и т.п.
   Код это учитывает: `dbUrl()` в `api/_lib/db.ts` сначала смотрит известные имена,
   затем любую переменную со значением `postgres://…`, предпочитая pooled-строку,
   и вычищает prisma-параметры (`pgbouncer`, `connect_timeout`), добавляя `sslmode=require`.
   Проверить, что именно найдено: `GET /api/ping` → поле `dbFrom`.
2. **Схема и демо-данные накатываются из функции, не из сборки.** На этапе сборки
   `DATABASE_URL` недоступна (в логе: `[db-setup] DATABASE_URL не задан`), поэтому
   применяем одной ссылкой из браузера:

   ```
   https://mini-seven-xi.vercel.app/api/admin/setup?token=<ADMIN_SETUP_TOKEN>
   ```

   Ответ: `{"ok":true,"applied":18,"counts":{"courts":4,"coaches":4,...}}`.
   Для доступа требуется настроенный `ADMIN_SETUP_TOKEN` или `SETUP_TOKEN`. Повторный запуск на рабочей базе без резервной копии небезопасен: см. предупреждение ниже.
3. Для миграции состояния админ-бота на уже работающей базе сделайте резервную копию
   и вызовите **только** защищённый эндпоинт:

   ```
   https://mini-seven-xi.vercel.app/api/admin/migrate-bot-state?token=<SETUP_TOKEN_или_ADMIN_SETUP_TOKEN>
   ```

   Он создаёт лишь новую таблицу `bot_dialog_state` (черновики и ожидаемые ответы бота),
   не запускает демо-данные и не меняет занятия, окна, брони и заказы. Кнопка
   «🔧 Починить схему» удалена: она повторно прогоняла сид и могла сдвинуть даты.
   Старые сообщения с этой кнопкой теперь безопасно отклоняются.
4. Альтернативы: GitHub Actions (**Actions → db → Run workflow**, нужен секрет
   репозитория `DATABASE_URL`) или `psql "$DATABASE_URL" -f db/schema.sql && psql "$DATABASE_URL" -f db/seed.sql`.
4. Проверка: `https://<проект>.vercel.app/api/ping` → `{"ok":true,"node":"v22.x",...}`,
   затем `/api/health?diag=1` → `ok: true` и данные из Neon.

> Почему не build-скрипт: Vercel не передаёт `DATABASE_URL` в окружение сборки
> (видно в логе деплоя), зато переменная есть у функций.

Схема использует `create table if not exists` и `on conflict`, однако текущий сид может сдвинуть даты при повторном запуске. Таблицы: `users`, `courts`, `coaches`, `training_sessions`,
`free_slots`, `bookings`, `products`, `orders`, `admin_audit`, `bot_dialog_state`. Брони и заказы привязаны к `user_id`,
а он — к `telegram_id`, поэтому у каждого игрока свой список.

---

## 3. Vercel

1. **New Project → Import** репозитория. Framework определится как Vite
   (`vercel.json` уже содержит сборку, SPA-rewrite и заголовки).
2. Environment Variables (Production + Preview):

   | Переменная | Значение |
   | --- | --- |
   | `DATABASE_URL` | из Neon (создаётся интеграцией; с Custom Prefix имя будет `tennisapp_DATABASE_URL` — это нормально) |
   | `TELEGRAM_BOT_TOKEN` | токен из @BotFather, без `VITE_` |
   | `VITE_TELEGRAM_BOT_NAME` | имя бота без `@` |
   | `VITE_APP_URL` | `https://<проект>.vercel.app` |
   | `VITE_ADMIN_BOT_URL` | ссылка на бота админа |
   | `PREVIEW_MODE` | `1` только для Preview, в Production `0` |
   | `ADMIN_TELEGRAM_IDS` | `793536041` (опционально: ID зашит по умолчанию) |

3. Frontend ходит на относительные `/api/*` — CORS не нужен.
4. Заголовок `content-security-policy: frame-ancestors …telegram.org` уже разрешает
   встраивание в Telegram Web; для мобильных клиентов Telegram ограничений нет.

---

## 4. Telegram

1. **@BotFather → /newapp** (или /setmenubutton): укажите URL
   `https://<проект>.vercel.app`.
2. Кнопка открытия из бота — web_app-кнопка с тем же URL:
   `{"text": "Открыть клуб", "web_app": {"url": "https://<проект>.vercel.app"}}`,
   либо inline-кнопка `web_app`.
3. В приложении SDK вызывается сам (`initTelegram()`): expand, цвет шапки, haptics.
   `initData` уходит на сервер в заголовке `Authorization: tma <initData>`.
4. Сервер проверяет подпись (`api/_lib/telegram.ts`): HMAC-SHA256 по
   `WebAppData` + bot_token, окно `auth_date` — 10 минут. Без подписи `/api/bookings`,
   `/api/orders`, `/api/me` отвечают 401.
5. После `npm run dev` сайт можно открыть и в обычном браузере: SDK отсутствует,
   приложение работает в демо-режиме.

> ⚠️ Мобильный Telegram иногда открывает мини-апп в отдельном webview. Если нужен именно
> переход на отдельный сайт (вне webview), используйте кнопку-ссылку `url` вместо
> `web_app` — тогда откроется браузер, а «назад» вернёт в чат.

---

## 5. Проверки перед выкладкой

| Проверка | Команда / действие |
| --- | --- |
| Типы | `npm run typecheck` |
| Сборка | `npm run build` |
| Рендер и /api | `npm run smoke` |
| Брони и антиспам | `npm run test:security` |
| Связка Vercel→Neon | `GET /api/health` → `ok: true` |
| Подпись Telegram | открыть мини-апп из бота, `GET /api/me` → 200 |
| Конкурентная бронь | два клиента на одно окно → второму 409 |

---

## 5.1. Панель администратора в боте

Бот `@testtesttennisbot` — это панель клуба. Код: `api/bot/webhook.ts`,
`api/bot/setup.ts`, экраны — `api/bot/_lib/screens.ts`.

**Включить (один раз):**

1. В Vercel → Environment Variables добавить:
   `TELEGRAM_WEBHOOK_SECRET` (случайная строка из A–Z, a–z, 0–9, `_`, `-`, до 256 символов), `SETUP_TOKEN` (случайная строка),
   `ADMIN_TELEGRAM_IDS=793536041`, `VITE_APP_URL=https://mini-seven-xi.vercel.app`.
2. Открыть в браузере (терминал не нужен):

   ```
   https://mini-seven-xi.vercel.app/api/bot/setup?token=<SETUP_TOKEN>
   ```

   Ответ `{"ok":true,"steps":[...]}` — webhook встал, команды меню установлены.
   Доступ разрешён только с верным `SETUP_TOKEN` или подписанной сессией администратора.
   После изменения `TELEGRAM_WEBHOOK_SECRET` обязательно повторите setup: Telegram должен
   отправлять новый секрет. Без него webhook вернёт 403 и бот не будет обрабатывать команды.
   Не публикуйте setup-ссылку и токен.

3. Диагностика одной ссылкой:

   ```
   https://mini-seven-xi.vercel.app/api/health?diag=1
   ```

   Показывает, какие переменные заданы (только факт, не значения), отвечает ли база
   и видит ли функция Telegram API (`telegram.info.last_error_message` объясняет,
   почему апдейты не доходят).
3. Написать боту `/start` с аккаунта `@nikita_tsk`.

**Что умеет:**

| Раздел | Действия |
| --- | --- |
| `/today`, `/tomorrow`, кнопки `‹ Вчера / Завтра ›` | записи на день, суммы, кто записан, отмена одной кнопкой |
| `🕘 Расписание` | заполненность по дням (`🟢 🟡 🔴`), ручные `+ место` / `− место` |
| `🛍 Заказы` | резервы к выдаче, «✔ Выдать» — заказ закрывается, покупателю приходит уведомление |
| `👥 Игроки` | кто сколько раз записывался |
| `/me` | у любого игрока: свои активные записи |

**Права.** Всё, кроме `/start` и `/me`, доступно только из `ADMIN_TELEGRAM_IDS`
(по умолчанию `793536041`). Чужие нажатия отклоняются на сервере с ответом
«Раздел доступен администратору клуба». Каждое действие админа пишется в `admin_audit`.

**Надёжность.** Webhook проверяет `X-Telegram-Bot-Api-Secret-Token`; ответ Telegram
всегда 200, ошибки ловятся и логируются, чтобы апдейт не ретраился бесконечно.

> ⚠️ Если секрет webhook не задан или не совпадает, запросы к webhook отклоняются с 403.

---

## 6. Что дальше

- Панель админа в боте: расписание, цены, места, отмена — те же таблицы, `role='admin'`.
- Уведомления за 2 часа: cron-функция Vercel (`/api/cron/reminders`) + `sendMessage`.
- Оплата: Telegram Stars или ЮKassa; поле `orders.status` уже готово (`reserved → paid`).

### Важно: существующие даты и подготовка базы

До исправления процедуры наполнения не запускайте `/api/admin/setup` на рабочей базе
без резервной копии и проверки: старый `SEED` пересчитывает `starts_at` по `day_offset`
и может перенести существующие занятия и окна. Кнопка «Починить схему» отключена.
Для новой таблицы состояния бота используйте `/api/admin/migrate-bot-state?token=...`
после резервной копии — этот эндпоинт не содержит `SEED`.
