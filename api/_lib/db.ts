import { neon } from '@neondatabase/serverless'

/**
 * Строка подключения может лежать под разными именами: интеграция Neon в Vercel
 * исторически ставит DATABASE_URL, но встречаются POSTGRES_URL / NEON_DATABASE_URL.
 * Ищем по списку приоритетов, чтобы не гадать по имени переменной.
 */
const DB_URL_KEYS = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'NEON_DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL_NON_POOLING',
] as const

export function dbUrl(): { url: string; from: string } | null {
  for (const key of DB_URL_KEYS) {
    const value = process.env[key]
    if (value) return { url: value, from: key }
  }
  return null
}

/** Какие из поддерживаемых имён реально заданы — для диагностики (без секретов). */
export function dbUrlPresence(): Record<string, boolean> {
  const result: Record<string, boolean> = {}
  for (const key of DB_URL_KEYS) result[key] = Boolean(process.env[key])
  return result
}

/**
 * Neon: один HTTP-запрос на SQL-вызов, без пула соединений.
 * Строка подключения обычно содержит ?sslmode=require.
 */
export function getDb() {
  const found = dbUrl()
  if (!found) throw new Error('DATABASE_URL не задан')
  return neon(found.url)
}

export class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/** Единый обработчик ошибок: наружу — короткое сообщение, в лог — детали. */
export function failure(error: unknown, scope: string): Response {
  if (error instanceof HttpError) {
    return json({ error: error.message }, error.status)
  }
  console.error(`[api/${scope}]`, error instanceof Error ? error.message : error)
  return json({ error: 'Внутренняя ошибка сервиса' }, 500)
}

export function readString(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError(400, `Поле «${field}» обязательно`)
  }
  const trimmed = value.trim()
  if (trimmed.length > maxLength) throw new HttpError(400, `Поле «${field}» слишком длинное`)
  return trimmed
}

export function readNumber(value: unknown, field: string, min: number, max: number): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num) || num < min || num > max) {
    throw new HttpError(400, `Поле «${field}» вне допустимого диапазона`)
  }
  return Math.round(num)
}
