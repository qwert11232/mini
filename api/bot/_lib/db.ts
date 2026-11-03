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

/** Админ проверяется по списку ID из окружения; по умолчанию — владелец клуба. */
const DEFAULT_ADMIN_IDS = '793536041'

export function adminIds(): string[] {
  return (process.env.ADMIN_TELEGRAM_IDS ?? DEFAULT_ADMIN_IDS)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

export function isAdmin(telegramId: number, username?: string): boolean {
  if (adminIds().includes(String(telegramId))) return true
  const usernames = (process.env.ADMIN_TELEGRAM_USERNAMES ?? '')
    .split(',')
    .map((value) => value.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean)
  return Boolean(username && usernames.includes(username.toLowerCase()))
}

export async function audit(telegramId: number, action: string, payload: Record<string, unknown>) {
  const sql = getDb()
  await sql`
    insert into admin_audit (telegram_id, action, payload)
    values (${telegramId}, ${action}, ${JSON.stringify(payload)}::jsonb)
  `
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
