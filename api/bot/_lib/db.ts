import { neon } from '@neondatabase/serverless'

type Sql = ReturnType<typeof neon>

let cached: Sql | null = null

export function getDb(): Sql {
  if (cached) return cached
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL не задан')
  cached = neon(url)
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

export function money(value: number): string {
  return `${new Intl.NumberFormat('ru-RU').format(value)} ₽`
}
