import { HttpError } from './db'

export type TelegramUser = {
  id: number
  firstName: string
  lastName: string | null
  username: string | null
}

/**
 * Проверка initData по HMAC-SHA256 (алгоритм Telegram Web Apps).
 * Формула: secret = HMAC_SHA256("WebAppData", bot_token),
 *          hash   = HMAC_SHA256(secret, data_check_string).
 * Никогда не доверяем данным, пришедшим из клиента, без этой проверки.
 */
export async function verifyInitData(initData: string, maxAgeSeconds = 600): Promise<TelegramUser> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) throw new HttpError(503, 'Бот не настроен на сервере')

  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) throw new HttpError(401, 'Нет подписи Telegram')

  params.delete('hash')
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const encoder = new TextEncoder()
  const secretKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode('WebAppData'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const secret = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(botToken))
  const checkKey = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', checkKey, encoder.encode(dataCheckString))
  const hex = [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('')

  if (hex !== hash) throw new HttpError(401, 'Подпись Telegram не совпала')

  const authDate = Number(params.get('auth_date') ?? 0)
  const age = Math.floor(Date.now() / 1000) - authDate
  if (!authDate || age > maxAgeSeconds) throw new HttpError(401, 'Сессия Telegram устарела')

  const rawUser = params.get('user')
  if (!rawUser) throw new HttpError(400, 'В initData нет пользователя')

  let parsed: { id?: number; first_name?: string; last_name?: string; username?: string }
  try {
    parsed = JSON.parse(rawUser)
  } catch {
    throw new HttpError(400, 'Некорректный user в initData')
  }
  if (!parsed.id) throw new HttpError(400, 'Некорректный user в initData')

  return {
    id: parsed.id,
    firstName: parsed.first_name ?? 'Гость',
    lastName: parsed.last_name ?? null,
    username: parsed.username ?? null,
  }
}

/** Тело запроса: либо initData (prod), либо dev-user (только локальный предпросмотр). */
export async function resolveUser(request: Request): Promise<TelegramUser | null> {
  const auth = request.headers.get('authorization')
  const initData = auth?.startsWith('tma ') ? auth.slice(4) : null
  if (!initData) return null
  return verifyInitData(initData)
}

export function isPreviewMode(): boolean {
  return process.env.PREVIEW_MODE === '1' || process.env.VERCEL_ENV === 'preview'
}
