import { isAdmin } from './_lib/db.js'
import { getWebhookInfo, setMyCommands, setWebhook } from './_lib/telegram.js'
import { verifyInitData } from '../_lib/telegram.js'

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

async function handler(request: Request): Promise<Response> {
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

    const access = await checkAccess(request, url)
    if (!access.allowed) {
      return json(
        {
          ok: false,
          error: 'Нет доступа к настройке',
          hint: 'Открой ссылку с ?token=<SETUP_TOKEN> или из мини-аппа под админом',
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
        access: access.reason,
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

type Access = { allowed: boolean; reason: string }

/**
 * Доступ к настройке:
 * 1) ?token= совпадает с SETUP_TOKEN;
 * 2) подпись администратора Telegram (вызов из мини-аппа);
 * 3) SETUP_TOKEN не задан — разрешаем: эндпоинт только переустанавливает webhook
 *    на собственный адрес приложения и не принимает URL извне, поэтому вреда нет.
 */
async function checkAccess(request: Request, url: URL): Promise<Access> {
  const setupToken = process.env.SETUP_TOKEN
  const provided = url.searchParams.get('token')

  if (setupToken) {
    if (provided === setupToken) return { allowed: true, reason: 'setup_token' }
  }

  const auth = request.headers.get('authorization')
  if (auth?.startsWith('tma ')) {
    try {
      const user = await verifyInitData(auth.slice(4))
      if (isAdmin(user.id, user.username ?? undefined)) return { allowed: true, reason: 'admin_init_data' }
    } catch {
      // подпись не прошла — падаем к следующей проверке
    }
  }

  if (!setupToken) return { allowed: true, reason: 'no_setup_token_configured' }
  return { allowed: false, reason: 'denied' }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * Vercel (Node runtime) понимает Web-сигнатуру только через объект с методом `fetch`.
 * «Голый» default-экспорт вызывается как handler(req, res) — Response терялся (500/504).
 */
export default { fetch: handler }
