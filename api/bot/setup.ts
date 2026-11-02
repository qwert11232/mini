import { isAdmin } from './_lib/db.ts'
import { getWebhookInfo, setMyCommands, setWebhook } from './_lib/telegram.ts'
import { verifyInitData } from '../_lib/telegram.ts'

/**
 * POST /api/bot/setup — включить бота: выставить webhook и команды.
 *
 * Вызывать вручную (curl) с секретом SETUP_TOKEN, чтобы случайный человек
 * не перевешивал webhook. Админ с подписью Telegram тоже допускается.
 *
 *   curl -X POST "https://<домен>/api/bot/setup?token=$SETUP_TOKEN"
 */
export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST' && request.method !== 'GET') {
    return json({ error: 'Метод не поддерживается' }, 405)
  }

  const url = new URL(request.url)
  const token = url.searchParams.get('token')
  const setupToken = process.env.SETUP_TOKEN

  let allowed = Boolean(setupToken && token === setupToken)

  if (!allowed) {
    const auth = request.headers.get('authorization')
    if (auth?.startsWith('tma ')) {
      try {
        const user = await verifyInitData(auth.slice(4))
        allowed = isAdmin(user.id, user.username ?? undefined)
      } catch {
        allowed = false
      }
    }
  }

  if (!allowed) return json({ error: 'Нужен SETUP_TOKEN или подпись администратора' }, 401)

  const base = process.env.VITE_APP_URL ?? url.origin
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? ''
  const webhookUrl = `${base}/api/bot/webhook`

  const ok = await setWebhook(webhookUrl, secret)
  await setMyCommands([
    { command: 'start', description: 'Панель администратора' },
    { command: 'today', description: 'Записи на сегодня' },
    { command: 'tomorrow', description: 'Записи на завтра' },
    { command: 'schedule', description: 'Расписание занятий' },
    { command: 'orders', description: 'Заказы к выдаче' },
    { command: 'me', description: 'Мои записи' },
  ])

  const info = await getWebhookInfo()
  console.info('[bot] setup', { webhookUrl, ok })

  return json({
    ok,
    webhook: webhookUrl,
    secretConfigured: Boolean(secret),
    commands: 6,
    info,
  })
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}
