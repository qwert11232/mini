import { neon } from '@neondatabase/serverless'

/**
 * Строка подключения может лежать под разными именами. Интеграция Neon в Vercel
 * ставит свои переменные, а при подключении с «Custom Prefix» — ещё и с префиксом
 * (у нас в проекте встречался `tennisapp_`). Поэтому сначала известные имена,
 * затем — любая переменная, значение которой похоже на строку подключения.
 */
const DB_URL_KEYS = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'NEON_DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL_NON_POOLING',
  'POSTGRES_PRISMA_URL',
  'POSTGRES_URL_NO_SSL',
] as const

/** Имена, которые не могут быть строкой подключения, даже если содержат «URL». */
const DB_URL_NOISE = /PASSWORD|_USER$|HOST|DATABASE$|NO_SSL|NON_SSL/i

function looksLikeUrl(value: string | undefined): value is string {
  return Boolean(value && /^postgres(ql)?:\/\//i.test(value.trim()))
}

/** Pooled-строка предпочтительнее: у Neon это хост с `-pooler`. */
function rank(name: string, url: string): number {
  if (/-pooler/.test(url)) return 0
  if (/UNPOOLED|NON_POOLING/i.test(name)) return 2
  return 1
}

/**
 * У Prisma-строки в хвосте бывают `pgbouncer=true`, `connect_timeout`, `schema` —
 * HTTP-драйверу Neon они не нужны и только мешают. Заодно гарантируем TLS.
 */
function normalizeDbUrl(url: string): string {
  try {
    const parsed = new URL(url.trim())
    for (const key of ['pgbouncer', 'connect_timeout', 'schema', 'statement_cache_size', 'connection_limit']) {
      parsed.searchParams.delete(key)
    }
    if (!parsed.searchParams.has('sslmode')) parsed.searchParams.set('sslmode', 'require')
    return parsed.toString()
  } catch {
    return url.trim()
  }
}

export function dbUrl(): { url: string; from: string } | null {
  for (const key of DB_URL_KEYS) {
    const value = process.env[key]
    if (looksLikeUrl(value)) return { url: normalizeDbUrl(value), from: key }
  }

  // Ни одно ожидаемое имя не подошло — ищем любую переменную с postgres-строкой
  // (префикс интеграции, своё имя и т.п.).
  const candidates = Object.entries(process.env)
    .filter(([name, value]) => !DB_URL_NOISE.test(name) && looksLikeUrl(value))
    .map(([name, value]) => ({ name, url: String(value) }))
    .sort((a, b) => rank(a.name, a.url) - rank(b.name, b.url))

  const best = candidates[0]
  return best ? { url: normalizeDbUrl(best.url), from: best.name } : null
}

/** Какие из ожидаемых имён содержат строку подключения — для диагностики (без значений). */
export function dbUrlPresence(): Record<string, boolean> {
  const result: Record<string, boolean> = {}
  for (const key of DB_URL_KEYS) result[key] = looksLikeUrl(process.env[key])
  return result
}

/** Все имена переменных, где лежит postgres://… — только имена, без значений. */
export function dbUrlCandidates(): string[] {
  return Object.entries(process.env)
    .filter(([name, value]) => !DB_URL_NOISE.test(name) && looksLikeUrl(value))
    .map(([name]) => name)
    .sort()
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

/** Необязательный текст: пустая строка допустима (например, подзаголовок записи). */
export function readOptionalString(value: unknown, field: string, maxLength = 200): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') throw new HttpError(400, `Поле «${field}» должно быть строкой`)
  const trimmed = value.trim()
  if (trimmed.length > maxLength) throw new HttpError(400, `Поле «${field}» слишком длинное`)
  return trimmed
}

/**
 * Телефон приводим к международному виду: его удобно показать в боте и
 * открыть через tel:. Российские номера принимаем и как 8…, и как +7… .
 */
export function normalizePhone(value: string): string {
  if (/[A-Za-zА-Яа-яЁё]/.test(value)) {
    throw new HttpError(400, 'В телефоне должны быть только цифры и знаки + ( ) -')
  }
  const digits = value.replace(/\D/g, '')
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return `+7${digits.slice(1)}`
  }
  if (digits.length === 10) return `+7${digits}`
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`
  throw new HttpError(400, 'Введите телефон с кодом города или страны (10–15 цифр)')
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
