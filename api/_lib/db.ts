import { neon } from '@neondatabase/serverless'

/**
 * Neon: один HTTP-запрос на SQL-вызов, без пула соединений.
 * DATABASE_URL в Vercel задаётся интеграцией Neon и содержит ?sslmode=require.
 */
export function getDb() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL не задан')
  return neon(url)
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
