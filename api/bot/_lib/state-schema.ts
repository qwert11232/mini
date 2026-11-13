import { getDb } from './db.js'

/** Только отдельная таблица черновиков бота. Демо-данные здесь не применяются. */
export const BOT_STATE_SCHEMA = [
  `create table if not exists public.bot_dialog_state (
     chat_id bigint primary key,
     pending jsonb,
     product_draft jsonb,
     session_draft jsonb,
     slot_draft jsonb,
     updated_at timestamptz not null default now()
   )`,
]

/**
 * Создаёт только таблицу бота и проверяет её доступность. Два холодных
 * инстанса могут одновременно создать таблицу: после гонки повторно проверяем
 * её наличие, не подавляя посторонние ошибки БД.
 */
export async function applyBotStateSchema(): Promise<void> {
  const sql = getDb()
  try {
    for (const statement of BOT_STATE_SCHEMA) await sql.query(statement, [])
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null
    if (code !== '42P07' && code !== '23505') throw error
    const [row] = (await sql`select to_regclass('public.bot_dialog_state') as relation`) as unknown as { relation: string | null }[]
    if (!row?.relation) throw error
  }
  // Если таблица с таким именем существовала ранее с другой структурой,
  // лучше явно сообщить об ошибке, чем изменять её автоматически.
  await sql`select chat_id, pending, product_draft, session_draft, slot_draft, updated_at
            from public.bot_dialog_state limit 0`
}
