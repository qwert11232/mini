import { json } from './_lib/db.js'

/**
 * GET /api/ping — минимальная проверка рантайма: без импорта Neon и без обращений к базе.
 * Если она отвечает, а /api/health нет — проблема в зависимостях, не в проекте.
 */
export default async function handler(): Promise<Response> {
  return json({
    ok: true,
    node: process.version,
    hasDb: Boolean(process.env.DATABASE_URL),
    hasBot: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    time: new Date().toISOString(),
  })
}
