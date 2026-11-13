import { dbUrl, getDb, json } from '../_lib/db.js'
import { applyBotStateSchema, BOT_STATE_SCHEMA } from '../bot/_lib/state-schema.js'

/**
 * GET/POST /api/admin/migrate-bot-state — безопасная миграция для админ-бота.
 *
 *   https://<домен>/api/admin/migrate-bot-state?token=<ТОКЕН_ПО_ПРИОРИТЕТУ>
 *
 * Создаёт только новую таблицу bot_dialog_state. Не запускает SEED, не меняет
 * даты занятий/окон и не удаляет брони, заказы или товары. Если задан
 * ADMIN_SETUP_TOKEN, нужен именно он; иначе используется SETUP_TOKEN.
 */

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return json({ error: 'Метод не поддерживается' }, 405)
  }

  try {
    if (!dbUrl()) {
      return json(
        {
          ok: false,
          error: 'Строка подключения к базе не найдена в переменных проекта',
        },
        500,
      )
    }

    const expected = process.env.ADMIN_SETUP_TOKEN ?? process.env.SETUP_TOKEN
    const provided = new URL(request.url).searchParams.get('token')
    if (!expected || provided !== expected) {
      return json({ ok: false, error: 'Неверный или отсутствующий token' }, 401)
    }

    await applyBotStateSchema()
    const sql = getDb()
    const [row] = (await sql`
      select to_regclass('public.bot_dialog_state') as relation
    `) as unknown as { relation: string | null }[]

    console.info('[admin/migrate-bot-state] applied', BOT_STATE_SCHEMA.length, {
      table: row?.relation ?? null,
    })

    return json({
      ok: true,
      applied: BOT_STATE_SCHEMA.length,
      table: row?.relation ?? null,
      next: 'Проверьте конструктор занятий в боте: шаги должны сохраняться между сообщениями',
    })
  } catch (error) {
    console.error('[admin/migrate-bot-state]', error instanceof Error ? error.message : error)
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Неизвестная ошибка',
      },
      500,
    )
  }
}

export default { fetch: handler }
