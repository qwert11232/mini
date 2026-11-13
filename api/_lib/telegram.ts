import { HttpError } from './db.js'
import { isAdminId } from './admin-access.js'

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
  if (!Number.isFinite(authDate) || authDate <= 0 || age < -30 || age > maxAgeSeconds) throw new HttpError(401, 'Сессия Telegram устарела')

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

/**
 * Гостевая сессия для браузера вне Telegram: подписи нет, поэтому опознаём
 * устройство по случайному ключу из localStorage (заголовок X-DT-Device).
 * Это не аутентификация личности, а метка «этот же браузер» — она нужна, чтобы
 * записи с сайта доезжали до админки и не смешивались с чужими.
 */
const GUEST_ID_OFFSET = 900_000_000

export class GuestSession implements TelegramUser {
  readonly id: number
  readonly firstName = 'Гость с сайта'
  readonly lastName = null
  readonly username = null

  constructor(readonly deviceKey: string) {
    // Стабильный псевдо-Telegram-ID: один браузер — одна карточка в базе.
    let hash = 0
    for (let i = 0; i < deviceKey.length; i += 1) {
      hash = (hash * 31 + deviceKey.charCodeAt(i)) % 100_000_000
    }
    this.id = GUEST_ID_OFFSET + hash
  }
}

/** Ключ устройства: 8–64 символа из безопасного алфавита. */
export function readGuestSession(request: Request): GuestSession | null {
  const key = request.headers.get('x-dt-device')
  if (!key || !/^[A-Za-z0-9_-]{8,64}$/.test(key)) return null
  return new GuestSession(key)
}

/** Тело запроса: либо initData (prod), либо dev-user (только локальный предпросмотр). */
export async function resolveUser(request: Request): Promise<TelegramUser | null> {
  const auth = request.headers.get('authorization')
  const initData = auth?.startsWith('tma ') ? auth.slice(4) : null
  if (!initData) return null
  return verifyInitData(initData)
}

/** Роль администратора определяется только по списку неизменяемых Telegram ID. */
export function isAdmin(user: TelegramUser): boolean {
  return isAdminId(user.id)
}

export function isPreviewMode(): boolean {
  return process.env.PREVIEW_MODE === '1' || process.env.VERCEL_ENV === 'preview'
}
