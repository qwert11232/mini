import { failure, getDb, json } from './_lib/db.ts'
import { getWebhookInfo } from './bot/_lib/telegram.ts'

/**
 * GET /api/health — чек связки Vercel → Neon → бот.
 *
 * GET /api/health?diag=1 — расширенная диагностика: проверяет переменные окружения
 * и доступ к Telegram API. Нужна, когда в браузере видно только 500 без причины.
 * Секреты наружу не отдаются — только факт их наличия и длина.
 */
export default async function handler(request: Request): Promise<Response> {
  const diag = new URL(request.url).searchParams.has('diag')

  try {
    const sql = getDb()
    const [row] = await sql`select now() as "dbTime", current_database() as "database"`
    const db = row as { database: string; dbTime: string }

    const base = { ok: true, db: db.database, dbTime: db.dbTime, bot: Boolean(process.env.TELEGRAM_BOT_TOKEN) }
    if (!diag) return json(base)

    const env = {
      DATABASE_URL: Boolean(process.env.DATABASE_URL),
      TELEGRAM_BOT_TOKEN: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      TELEGRAM_WEBHOOK_SECRET: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET),
      SETUP_TOKEN: Boolean(process.env.SETUP_TOKEN),
      ADMIN_TELEGRAM_IDS: (process.env.ADMIN_TELEGRAM_IDS ?? '793536041').split(',').length,
      VITE_APP_URL: process.env.VITE_APP_URL ?? '(не задан, берётся origin запроса)',
    }

    const telegram = process.env.TELEGRAM_BOT_TOKEN
      ? await getWebhookInfo().then(
          (info) => ({ reachable: true, info }),
          (error: unknown) => ({
            reachable: false,
            error: error instanceof Error ? error.message : 'ошибка Telegram API',
          }),
        )
      : { reachable: false, error: 'TELEGRAM_BOT_TOKEN не задан' }

    return json({ ...base, env, telegram })
  } catch (error) {
    // Для диагностики причина важнее общего «внутренняя ошибка»: без неё
    // в браузере видно только 500 и неясно, что именно сломалось.
    if (diag) {
      console.error('[api/health] diag failure', error instanceof Error ? error.message : error)
      return json(
        {
          ok: false,
          error: error instanceof Error ? error.message : 'Неизвестная ошибка',
          env: {
            DATABASE_URL: Boolean(process.env.DATABASE_URL),
            TELEGRAM_BOT_TOKEN: Boolean(process.env.TELEGRAM_BOT_TOKEN),
            TELEGRAM_WEBHOOK_SECRET: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET),
            SETUP_TOKEN: Boolean(process.env.SETUP_TOKEN),
            VITE_APP_URL: process.env.VITE_APP_URL ?? '(не задан)',
          },
          hint: 'Проверь DATABASE_URL: строка должна быть pooled и содержать sslmode=require',
        },
        500,
      )
    }
    return failure(error, 'health')
  }
}
