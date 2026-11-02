import { failure, getDb, json } from './_lib/db'

/**
 * GET /api/health — быстрый чек связки: Vercel-функция жива, Neon отвечает,
 * бот настроен. Секреты наружу не отдаются, только факт их наличия.
 */
export default async function handler(): Promise<Response> {
  try {
    const sql = getDb()
    const [row] = await sql`select now() as "dbTime", current_database() as "database"`
    return json({
      ok: true,
      db: (row as { database: string }).database,
      dbTime: (row as { dbTime: string }).dbTime,
      bot: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    })
  } catch (error) {
    return failure(error, 'health')
  }
}
