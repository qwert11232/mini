import { isAdmin } from './_lib/db.ts'
import { getWebhookInfo, setMyCommands, setWebhook } from './_lib/telegram.ts'
import { verifyInitData } from '../_lib/telegram.ts'

/**
 * GET/POST /api/bot/setup — включить бота одной ссылкой из браузера.
 *
 *   https://<домен>/api/bot/setup?token=<SETUP_TOKEN>
 *
 * Делает три вещи: ставит webhook, регистрирует команды меню, отдаёт getWebhookInfo.
 * Любая ошибка возвращается JSON-ом с причиной — функция не должна падать 500,
 * иначе в браузере видно только «A function needed by this page failed».
 */

const COMMANDS = [
  { command: 'start', description: 'Панель администратора' },
  { command: 'today', description: 'Записи на сегодня' },
  { command: 'tomorrow', description: 'Записи на завтра' },
  { command: 'schedule', description: 'Расписание занятий' },
  { command: 'orders', description: 'Заказы к выдаче' },
  { command: 'me', description: 'Мои записи' },
]

type Step = { step: string; ok: boolean; detail?: unknown }

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return json({ error: 'Метод не поддерживается' }, 405)
  }

  const url = new URL(request.url)
  const steps: Step[] = []

  try {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      return json(
        {
          ok: false,
          error: 'TELEGRAM_BOT_TOKEN не задан в переменных окружения проекта',
          hint: 'Vercel → Settings → Environment Variables → добавь TELEGRAM_BOT_TOKEN и сделай Redeploy',
        },
        500,
      )
    }

    if (!(await isAllowed(request, url))) {
      return json(
        {
          ok: false,
          error: 'Нужен SETUP_TOKEN',
          hint: 'Открой ссылку с ?token=<SETUP_TOKEN>, где SETUP_TOKEN задан в Vercel',
        },
        401,
      )
    }

    const base = (process.env.VITE_APP_URL ?? url.origin).replace(/\/$/, '')
    const webhookUrl = `${base}/api/bot/webhook`
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? ''

    const webhookSet = await setWebhook(webhookUrl, secret)
    steps.push({ step: 'setWebhook', ok: webhookSet, detail: webhookUrl })

    await setMyCommands(COMMANDS)
    steps.push({ step: 'setMyCommands', ok: true, detail: COMMANDS.length })

    const info = await getWebhookInfo()
    steps.push({ step: 'getWebhookInfo', ok: true, detail: info })

    const ok = webhookSet
    console.info('[bot/setup]', { webhookUrl, ok, secretConfigured: Boolean(secret) })

    return json(
      {
        ok,
        webhook: webhookUrl,
        secretConfigured: Boolean(secret),
        adminIds: (process.env.ADMIN_TELEGRAM_IDS ?? '793536041').split(',').length,
        steps,
        next: ok ? 'Напиши боту /start' : 'Telegram не подтвердил webhook — смотри detail',
      },
      ok ? 200 : 502,
    )
  } catch (error) {
    console.error('[bot/setup]', error instanceof Error ? error.message : error)
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Неизвестная ошибка',
        steps,
        hint: 'Если это сетевой таймаут — повтори ссылку, Telegram иногда отвечает медленно',
      },
      500,
    )
  }
}

/** Доступ: SETUP_TOKEN из query строки либо подпись администратора Telegram. */
async function isAllowed(request: Request, url: URL): Promise<boolean> {
  const setupToken = process.env.SETUP_TOKEN
  const provided = url.searchParams.get('token')
  if (setupToken && provided === setupToken) return true

  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('tma ')) return false

  try {
    const user = await verifyInitData(auth.slice(4))
    return isAdmin(user.id, user.username ?? undefined)
  } catch {
    return false
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}
