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

Если `/api` недоступен, приложение само переходит в демо-режим на localStorage —
то есть сайт открывается даже одним статичным `dist/` (например, через file-сервер).

---

## 2. Neon

1. На Vercel: **Storage → Create Database → Neon** (или через neon.tech) — база и
   `DATABASE_URL` появятся в проекте автоматически.
2. Применить схему и демо-данные. Вариант А — GitHub Actions
   (`.github/workflows/db.yml`): добавьте секрет репозитория `DATABASE_URL` и запустите
   workflow **db** (Run workflow, `seed = true`).
   Вариант Б — вручную: `psql "$DATABASE_URL" -f db/schema.sql && psql "$DATABASE_URL" -f db/seed.sql`.
3. Проверка: `curl https://<проект>.vercel.app/api/health` → `{"ok":true,"db":"neondb","bot":true}`.

Схема идемпотентна (`create table if not exists`, `on conflict`), сид тоже — можно
применять повторно. Таблицы: `users`, `courts`, `coaches`, `training_sessions`,
`free_slots`, `bookings`, `products`, `orders`. Брони и заказы привязаны к `user_id`,
а он — к `telegram_id`, поэтому у каждого игрока свой список.

---

## 3. Vercel

1. **New Project → Import** репозитория. Framework определится как Vite
   (`vercel.json` уже содержит сборку, SPA-rewrite и заголовки).
2. Environment Variables (Production + Preview):

   | Переменная | Значение |
   | --- | --- |
   | `DATABASE_URL` | из Neon (создаётся интеграцией) |
   | `TELEGRAM_BOT_TOKEN` | токен из @BotFather, без `VITE_` |
   | `VITE_TELEGRAM_BOT_NAME` | имя бота без `@` |
   | `VITE_APP_URL` | `https://<проект>.vercel.app` |
   | `VITE_ADMIN_BOT_URL` | ссылка на бота админа |
   | `PREVIEW_MODE` | `1` только для Preview, в Production `0` |

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
| Связка Vercel→Neon | `GET /api/health` → `ok: true` |
| Подпись Telegram | открыть мини-апп из бота, `GET /api/me` → 200 |
| Конкурентная бронь | два клиента на одно окно → второму 409 |

---

## 6. Что дальше (после подключения бота)

- Панель админа в боте: расписание, цены, места, отмена — те же таблицы, `role='admin'`.
- Уведомления за 2 часа: cron-функция Vercel (`/api/cron/reminders`) + `sendMessage`.
- Оплата: Telegram Stars или ЮKassa; поле `orders.status` уже готово (`reserved → paid`).
