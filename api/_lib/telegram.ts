import { HttpError } from './db.js'
import { isAdminId } from './admin-access.js'

export type TelegramUser = {
  id: number
  firstName: string
  lastName: string | null
  username: string | null
}

const INIT_DATA_MAX_LENGTH = 16_384
const SESSION_MAX_LENGTH = 8_192
const SESSION_LIFETIME_SECONDS = 2 * 60 * 60
const SESSION_DOMAIN = 'dt-mini-app-session-v1.'
const encoder = new TextEncoder()

function botToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new HttpError(503, 'Бот не настроен на сервере')
  return token
}

/**
 * Проверяем именно сырой initData от Telegram, а не initDataUnsafe.
 * Telegram HMAC включает все поля, кроме hash, включая необязательное signature.
 * Сортировка — по кодам символов, без зависящего от локали localeCompare.
 */
export async function verifyInitData(initData: string, maxAgeSeconds = 600): Promise<TelegramUser> {
  const token = botToken()
  if (!initData || initData.length > INIT_DATA_MAX_LENGTH) throw new HttpError(401, 'Некорректные данные Telegram')

  const params = new URLSearchParams(initData)
  const keys = new Set<string>()
  for (const [key] of params.entries()) {
    if (keys.has(key)) throw new HttpError(401, 'Некорректные данные Telegram')
    keys.add(key)
  }

  const hash = params.get('hash')
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) throw new HttpError(401, 'Нет корректной подписи Telegram')
  params.delete('hash')
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const secretKey = await crypto.subtle.importKey(
    'raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const secret = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(token))
  const checkKey = await crypto.subtle.importKey(
    'raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
  )
  const receivedHash = Uint8Array.from(hash.match(/../g) ?? [], (byte) => parseInt(byte, 16))
  const valid = await crypto.subtle.verify('HMAC', checkKey, receivedHash, encoder.encode(dataCheckString))
  if (!valid) throw new HttpError(401, 'Подпись Telegram не совпала')

  const rawDate = params.get('auth_date') ?? ''
  const authDate = Number(rawDate)
  const age = Math.floor(Date.now() / 1000) - authDate
  if (!/^\d+$/.test(rawDate) || !Number.isSafeInteger(authDate) || authDate <= 0 || age < -30 || age > maxAgeSeconds) {
    throw new HttpError(401, 'Сессия Telegram устарела')
  }

  const rawUser = params.get('user')
  let parsed: unknown
  try {
    parsed = rawUser ? JSON.parse(rawUser) : null
  } catch {
    throw new HttpError(401, 'Некорректный пользователь Telegram')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(401, 'В данных Telegram нет пользователя')
  }
  const user = parsed as Record<string, unknown>
  if (!Number.isSafeInteger(user.id) || Number(user.id) <= 0 ||
      typeof user.first_name !== 'string' || user.first_name.length > 512 ||
      (user.last_name != null && (typeof user.last_name !== 'string' || user.last_name.length > 512)) ||
      (user.username != null && (typeof user.username !== 'string' || user.username.length > 128))) {
    throw new HttpError(401, 'Некорректный пользователь Telegram')
  }

  return {
    id: user.id as number,
    firstName: user.first_name || 'Игрок',
    lastName: (user.last_name as string | null | undefined) ?? null,
    username: (user.username as string | null | undefined) ?? null,
  }
}

type SessionPayload = {
  version: 1
  audience: string
  issuedAt: number
  expiresAt: number
  user: TelegramUser
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new HttpError(401, 'Некорректная сессия')
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4))
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    // Одна каноническая запись на подпись; альтернативные формы не принимаем.
    if (encodeBase64Url(bytes) !== value) throw new Error('non-canonical base64url')
    return bytes
  } catch {
    throw new HttpError(401, 'Некорректная сессия')
  }
}

async function sessionKey(usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(botToken()), { name: 'HMAC', hash: 'SHA-256' }, false, usages)
}

/**
 * Короткая bearer-сессия только после проверки свежего initData. Она хранится
 * клиентом только в памяти; она не продлевается и не требует изменений БД.
 * Токен — подписанные, но не зашифрованные данные; его нельзя логировать.
 */
export async function createSession(user: TelegramUser, audience: string): Promise<{ token: string; expiresIn: number }> {
  const issuedAt = Math.floor(Date.now() / 1000)
  const payload: SessionPayload = { version: 1, audience, issuedAt, expiresAt: issuedAt + SESSION_LIFETIME_SECONDS, user }
  const encoded = encodeBase64Url(encoder.encode(JSON.stringify(payload)))
  const key = await sessionKey(['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(SESSION_DOMAIN + encoded))
  return { token: `${encoded}.${encodeBase64Url(new Uint8Array(signature))}`, expiresIn: SESSION_LIFETIME_SECONDS }
}

export async function verifySession(token: string, audience: string): Promise<TelegramUser> {
  if (!token || token.length > SESSION_MAX_LENGTH) throw new HttpError(401, 'Некорректная сессия')
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new HttpError(401, 'Некорректная сессия')
  const signature = decodeBase64Url(parts[1])
  if (signature.length !== 32) throw new HttpError(401, 'Некорректная сессия')
  const key = await sessionKey(['verify'])
  if (!await crypto.subtle.verify('HMAC', key, signature, encoder.encode(SESSION_DOMAIN + parts[0]))) {
    throw new HttpError(401, 'Не удалось подтвердить сессию')
  }

  let payload: unknown
  try {
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64Url(parts[0])))
  } catch {
    throw new HttpError(401, 'Некорректная сессия')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new HttpError(401, 'Некорректная сессия')
  const session = payload as Partial<SessionPayload>
  const user = session.user
  const now = Math.floor(Date.now() / 1000)
  if (session.version !== 1 || session.audience !== audience || !Number.isSafeInteger(session.issuedAt) || !Number.isSafeInteger(session.expiresAt) ||
      (session.issuedAt as number) <= 0 || (session.issuedAt as number) > now + 30 ||
      session.expiresAt !== (session.issuedAt as number) + SESSION_LIFETIME_SECONDS ||
      !user || !Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.firstName !== 'string' ||
      (user.lastName !== null && typeof user.lastName !== 'string') ||
      (user.username !== null && typeof user.username !== 'string')) {
    throw new HttpError(401, 'Некорректная сессия')
  }
  if ((session.expiresAt as number) <= now) throw new HttpError(401, 'Сессия Telegram устарела')
  return user
}

/** Персональные операции принимают только проверенную подпись Telegram или выданную ей сессию. */
export async function resolveUser(request: Request): Promise<TelegramUser | null> {
  const auth = request.headers.get('authorization')
  if (auth?.startsWith('tma-session ')) return verifySession(auth.slice('tma-session '.length), new URL(request.url).origin)
  if (auth?.startsWith('tma ')) return verifyInitData(auth.slice(4))
  return null
}

/** Роль администратора определяется только по списку неизменяемых Telegram ID. */
export function isAdmin(user: TelegramUser): boolean {
  return isAdminId(user.id)
}
