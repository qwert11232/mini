/**
 * Вызовы Telegram Bot API. Токен берётся только из окружения и никогда не
 * логируется; сообщения об ошибках содержат метод и код ответа, без URL с токеном.
 */

type ApiResponse<T> = { ok: true; result: T } | { ok: false; description?: string; error_code?: number }

/** Последняя ошибка Bot API — нужна в диагностике вместо безликого false. */
export type ApiError = { method: string; status: number; code?: number; description?: string }

let lastError: ApiError | null = null

export function takeLastError(): ApiError | null {
  const error = lastError
  lastError = null
  return error
}

export type InlineButton =
  | { text: string; callback_data: string }
  | { text: string; url: string }

export type Keyboard = { inline_keyboard: InlineButton[][] }

export type TelegramUser = {
  id: number
  is_bot?: boolean
  first_name: string
  last_name?: string
  username?: string
}

export type Update = {
  update_id: number
  message?: {
    message_id: number
    from?: TelegramUser
    chat: { id: number; type: string }
    text?: string
  }
  callback_query?: {
    id: string
    from: TelegramUser
    data?: string
    message?: { message_id: number; chat: { id: number } }
  }
}

function token(): string {
  const value = process.env.TELEGRAM_BOT_TOKEN
  if (!value) throw new Error('TELEGRAM_BOT_TOKEN не задан')
  return value
}

async function call<T>(method: string, payload: Record<string, unknown>): Promise<T | null> {
  const response = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const data = (await response.json().catch(() => null)) as ApiResponse<T> | null
  if (!data?.ok) {
    lastError = {
      method,
      status: response.status,
      code: data && 'error_code' in data ? data.error_code : undefined,
      description: data && 'description' in data ? data.description : undefined,
    }
    console.error(`[bot] ${method} failed`, lastError)
    return null
  }
  lastError = null
  return data.result
}

export async function sendMessage(
  chatId: number,
  text: string,
  keyboard?: Keyboard,
): Promise<void> {
  await call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: keyboard,
  })
}

export async function editMessage(
  chatId: number,
  messageId: number,
  text: string,
  keyboard?: Keyboard,
): Promise<void> {
  const edited = await call('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    reply_markup: keyboard,
  })
  // «message is not modified» — нормальная ситуация при повторном рендере.
  if (!edited) return
}

export async function answerCallback(id: string, text?: string): Promise<void> {
  await call('answerCallbackQuery', { callback_query_id: id, text, show_alert: false })
}

/**
 * Telegram принимает secret_token только из символов A-Za-z0-9_- (1–256).
 * Если в переменной есть что-то ещё, setWebhook отвечает Bad Request — и webhook
 * не встаёт. Такой секрет игнорируем целиком (на приёме апдейтов — тоже).
 */
export function webhookSecret(): string | null {
  const value = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!value) return null
  return /^[A-Za-z0-9_-]{1,256}$/.test(value) ? value : null
}

export async function setWebhook(url: string, secret: string | null): Promise<boolean> {
  const result = await call<boolean>('setWebhook', {
    url,
    ...(secret ? { secret_token: secret } : {}),
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  })
  return Boolean(result)
}

export async function getWebhookInfo(): Promise<unknown> {
  return call('getWebhookInfo', {})
}

export async function setMyCommands(commands: { command: string; description: string }[]): Promise<void> {
  await call('setMyCommands', { commands })
}
