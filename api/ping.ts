import { dbUrl, json } from './_lib/db.js'

/**
 * GET /api/ping — минимальная проверка рантайма: без импорта Neon и без обращений к базе.
 * Если она отвечает, а /api/health нет — проблема в зависимостях, не в проекте.
 */
async function handler(): Promise<Response> {
  return json({
    ok: true,
    node: process.version,
    hasDb: Boolean(dbUrl()),
    dbFrom: dbUrl()?.from ?? null,
    hasBot: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    time: new Date().toISOString(),
  })
}

/**
 * Vercel (Node runtime) понимает Web-сигнатуру только через объект с методом `fetch`.
 * «Голый» default-экспорт вызывается как handler(req, res) — Response терялся (500/504).
 */
export default { fetch: handler }
