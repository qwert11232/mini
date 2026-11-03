import { dbUrl, getDb, json } from '../_lib/db.js'
import { SCHEMA, SEED } from '../_lib/schema.js'

/**
 * GET/POST /api/admin/setup — подготовить базу Neon из браузера.
 *
 * Зачем: на этапе сборки Vercel переменная DATABASE_URL недоступна (видно в логе
 * `[db-setup] DATABASE_URL не задан`), поэтому схему и демо-данные нельзя накатить
 * из build-скрипта. В функции переменная есть — здесь и применяем.
 *
 * Схема и сид идемпотентны: повторный вызов ничего не ломает.
 * Доступ: ?token= (SETUP_TOKEN / ADMIN_SETUP_TOKEN) либо без токена, если ни один не задан.
 */

async function handler(request: Request): Promise<Response> {
  try {
    if (!dbUrl()) {
      return json(
        {
          ok: false,
          error: 'Строка подключения к базе не найдена в переменных проекта',
          hint: 'Vercel → Settings → Environment Variables → добавь строку подключения Neon (pooled, sslmode=require) и сделай Redeploy',
        },
        500,
      )
    }

    const expected = process.env.ADMIN_SETUP_TOKEN ?? process.env.SETUP_TOKEN
    const provided = new URL(request.url).searchParams.get('token')
    if (expected && provided !== expected) {
      return json({ ok: false, error: 'Неверный или отсутствующий token' }, 401)
    }

    const sql = getDb()
    const applied: string[] = []

    for (const statement of [...SCHEMA, ...SEED]) {
      // sql.query — обычный вызов с текстом (тег-шаблон принимать DDL из массива не умеет).
      await sql.query(statement, [])
      applied.push(statement.slice(0, 24))
    }

    const [counts] = (await sql`
      select
        (select count(*)::int from courts) as courts,
        (select count(*)::int from coaches) as coaches,
        (select count(*)::int from training_sessions) as sessions,
        (select count(*)::int from free_slots) as slots,
        (select count(*)::int from products) as products
    `) as { courts: number; coaches: number; sessions: number; slots: number; products: number }[]

    console.info('[admin/setup] applied', applied.length, counts)

    return json({
      ok: true,
      applied: applied.length,
      counts,
      next: 'Открой /api/health?diag=1 и убедись, что ok: true',
    })
  } catch (error) {
    console.error('[admin/setup]', error instanceof Error ? error.message : error)
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Неизвестная ошибка',
        hint: 'Проверь DATABASE_URL: pooled-строка Neon, sslmode=require. Если таблицы уже есть — схема применяется повторно безопасно.',
      },
      500,
    )
  }
}

/**
 * Vercel (Node runtime) понимает Web-сигнатуру только через объект с методом `fetch`.
 * «Голый» default-экспорт вызывается как handler(req, res) — Response терялся (500/504).
 */
export default { fetch: handler }
