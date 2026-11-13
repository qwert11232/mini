import { adminIds, isAdmin } from './_lib/db.js'
import {
  getWebhookInfo,
  setChatMenuButton,
  setMyCommands,
  setWebhook,
  takeLastError,
  webhookSecret,
  type BotCommand,
} from './_lib/telegram.js'
import { appUrl } from './_lib/app-url.js'
import { verifyInitData } from '../_lib/telegram.js'

/**
 * GET/POST /api/bot/setup — включить бота одной ссылкой из браузера.
 *
 *   https://<домен>/api/bot/setup?token=<SETUP_TOKEN>
 *
 * По умолчанию ставит защищённый webhook и обновляет меню Telegram. Режим
 * ?mode=menu обновляет только кнопку и команды, не трогая webhook и его очередь.
 */

const PLAYER_COMMANDS: BotCommand[] = [
  { command: 'start', description: 'Главное меню' },
  { command: 'me', description: 'Мои записи' },
  { command: 'orders', description: 'Мои заказы' },
  { command: 'schedule', description: 'Расписание занятий' },
  { command: 'help', description: 'Помощь' },
]

const ADMIN_EXTRA_COMMANDS: BotCommand[] = [
  { command: 'today', description: 'Записи на сегодня' },
  { command: 'tomorrow', description: 'Записи на завтра' },
  { command: 'orders', description: 'Заказы к выдаче' },
  { command: 'admin', description: 'Панель администратора' },
]

const ADMIN_SCOPE_COMMANDS: BotCommand[] = [
  { command: 'start', description: 'Панель администратора' },
  { command: 'me', description: 'Мои записи' },
  { command: 'schedule', description: 'Расписание · панель' },
  { command: 'help', description: 'Справка панели' },
  ...ADMIN_EXTRA_COMMANDS,
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

    const requestedMode = url.searchParams.get('mode') ?? 'full'
    if (requestedMode !== 'full' && requestedMode !== 'menu') {
      return json({ ok: false, error: 'Неизвестный режим настройки' }, 400)
    }
    const menuOnly = requestedMode === 'menu'
    const app = appUrl()
    const webhookUrl = `${app}/api/bot/webhook`
    const secret = webhookSecret()
    let webhookSet: boolean | null = null

    if (!menuOnly) {
      if (!secret) {
        return json({ ok: false, error: 'Настройте TELEGRAM_WEBHOOK_SECRET: 1–256 символов A-Z, a-z, 0-9, _ или -' }, 503)
      }
      webhookSet = await setWebhook(webhookUrl, secret)
      steps.push({ step: 'setWebhook', ok: webhookSet, detail: webhookSet ? webhookUrl : takeLastError() })
    }

    const menuButtonSet = await setChatMenuButton(app, 'Открыть приложение')
    steps.push({
      step: 'setChatMenuButton',
      ok: menuButtonSet,
      detail: menuButtonSet ? app : takeLastError(),
    })

    steps.push(...(await configureCommands()))

    if (!menuOnly) {
      const info = await getWebhookInfo()
      steps.push({ step: 'getWebhookInfo', ok: Boolean(info), detail: info ?? takeLastError() })
    }

    const ok = steps.every((step) => step.ok)
    console.info('[bot/setup]', { mode: requestedMode, webhook: webhookSet, ok })

    return json(
      {
        ok,
        mode: requestedMode,
        webhook: webhookUrl,
        webhookConfigured: webhookSet,
        appUrl: app,
        access: access.reason,
        secretConfigured: Boolean(secret),
        secretSkipped: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET) && !secret,
        menuButtonConfigured: menuButtonSet,
        adminIds: adminIds().length,
        steps,
        next: ok
          ? 'Напишите боту /start в личном чате'
          : 'Не все шаги выполнены: проверьте steps. Для chat scope администратор должен начать диалог с ботом.',
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
        hint: 'Проверьте настройки и steps. Не отправляйте токены и ссылки с ними в чат.',
      },
      500,
    )
  }
}

/** Команды меню — подсказка, фактический доступ всегда проверяется webhook. */
async function configureCommands(): Promise<Step[]> {
  const result: Step[] = []

  // Перезаписываем прежний общий список, не передавая Telegram пустой массив.
  const defaults = await setMyCommands(PLAYER_COMMANDS, { type: 'default' })
  result.push({
    step: 'setMyCommands:default',
    ok: defaults,
    detail: defaults ? PLAYER_COMMANDS.length : takeLastError(),
  })

  const players = await setMyCommands(PLAYER_COMMANDS, { type: 'all_private_chats' })
  result.push({
    step: 'setMyCommands:players',
    ok: players,
    detail: players ? PLAYER_COMMANDS.length : takeLastError(),
  })

  for (const id of adminIds()) {
    const chatId = Number(id)
    const configured = await setMyCommands(ADMIN_SCOPE_COMMANDS, { type: 'chat', chat_id: chatId })
    result.push({
      step: 'setMyCommands:admin',
      ok: configured,
      detail: configured ? chatId : { chatId, error: takeLastError() },
    })
  }
  return result
}

type Access = { allowed: boolean; reason: string }

/**
 * Доступ к настройке:
 * 1) ?token= совпадает с SETUP_TOKEN;
 * 2) подпись администратора Telegram (вызов из мини-аппа);
 * Если токен не задан, требуется подпись администратора Telegram.
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
      if (isAdmin(user.id)) return { allowed: true, reason: 'admin_init_data' }
    } catch {
      // подпись не прошла — падаем к следующей проверке
    }
  }

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
