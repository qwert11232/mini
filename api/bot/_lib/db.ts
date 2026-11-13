import { neon } from '@neondatabase/serverless'
import { dbUrl } from '../../_lib/db.js'

export type { Keyboard } from './telegram.js'

/** Результат действия панели: вебхук отвечает текстом в callback. */
export type Result = { ok: true; message?: string } | { ok: false; message: string }

type Sql = ReturnType<typeof neon>

let cached: Sql | null = null

export function getDb(): Sql {
  if (cached) return cached
  const found = dbUrl()
  if (!found) throw new Error('DATABASE_URL не задан')
  cached = neon(found.url)
  return cached
}

// Общая проверка ID используется и ботом, и Mini App.
export { adminIds, isAdminId as isAdmin } from '../../_lib/admin-access.js'

export async function audit(telegramId: number, action: string, payload: Record<string, unknown>) {
  const sql = getDb()
  await sql`
    insert into admin_audit (telegram_id, action, payload)
    values (${telegramId}, ${action}, ${JSON.stringify(payload)}::jsonb)
  `
}

/** Дата клуба для экранов, независимо от таймзоны сервера. */
export function clubDate(offset: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const part = (type: string): number => Number(parts.find((item) => item.type === type)?.value ?? 0)
  const date = new Date(Date.UTC(part('year'), part('month') - 1, part('day') + offset))
  const weekdays = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
  return `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}, ${weekdays[date.getUTCDay()]}`
}

/** Дата в московском времени — клуб работает по нему, независимо от часового пояса читающего. */
export function clubTime(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${new Intl.NumberFormat('ru-RU').format(value)} ₽`
}
