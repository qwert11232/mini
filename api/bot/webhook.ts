import { audit, getDb, isAdmin } from './_lib/db.js'
import {
  answerCallback,
  editMessage,
  sendMessage,
  webhookSecret,
  type Update,
} from './_lib/telegram.js'
import {
  cancelBooking,
  markIssued,
  shiftSeats,
} from './_lib/bookings.js'
import {
  closeSlot,
  markVisited,
  openSlot,
  repairSchema,
  reserveSeat,
  restoreBooking,
  toggleProduct,
  saveNote,
  setRole,
  setSessionPrice,
  type Result,
} from './_lib/admin.js'
import {
  appUrl,
  auditScreen,
  courtsScreen,
  dayScreen,
  dbErrorScreen,
  helpScreen,
  menuScreen,
  ordersScreen,
  priceHint,
  productsScreen,
  sessionsScreen,
  slotsScreen,
  usersScreen,
  type Screen,
} from './_lib/screens.js'
import { SCHEMA, SEED } from '../_lib/schema.js'

const HELP = [
  '<b>ДТ · бот клуба</b>',
  '',
  '/start — панель администратора',
  '/today — записи на сегодня',
  '/tomorrow — записи на завтра',
  '/schedule — расписание занятий',
  '/orders — заказы к выдаче',
  '/me — мои записи',
  '/help — эта справка',
  '',
  'Записаться на занятие и арендовать корт можно в приложении.',
].join('\n')

/** Состояние диалога: админ присылает цену или заметку текстом. */
type Pending =
  | { kind: 'price'; sessionId: string }
  | { kind: 'note'; playerId: string }

const pending = new Map<number, Pending>()

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Метод не поддерживается' }), {
      status: 405,
      headers: { 'content-type': 'application/json' },
    })
  }

  // Telegram присылает секрет в заголовке — иначе webhook открыт всему интернету.
  // Секрет, который Telegram не принимает по формату, здесь тоже не проверяем:
  // иначе мы сами отбивали бы все апдейты и бот молчал бы.
  const expected = webhookSecret()
  if (expected && request.headers.get('x-telegram-bot-api-secret-token') !== expected) {
    console.warn('[bot] отклонён запрос с неверным секретом webhook')
    return new Response('forbidden', { status: 403 })
  }

  let update: Update
  try {
    update = (await request.json()) as Update
  } catch {
    return new Response('bad request', { status: 400 })
  }

  try {
    if (update.callback_query) {
      await safe(update.callback_query.from.id, () => handleCallback(update))
    } else if (update.message?.text) {
      await safe(update.message.from?.id, () => handleMessage(update))
    }
  } catch (error) {
    console.error('[bot] ошибка обработки', error instanceof Error ? error.message : error)
  }

  // Telegram ждёт 200, иначе будет ретраить апдейт.
  return new Response('ok', { status: 200 })
}

/**
 * Раньше ошибка «база не подключена» уходила только в лог, а Telegram получал 200 —
 * в чате была тишина. Теперь админ видит причину и кнопку починки схемы.
 */
async function safe(chatId: number | undefined, work: () => Promise<void>): Promise<void> {
  try {
    await work()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.error('[bot] ошибка', reason)
    if (!chatId) return
    const screen = await dbErrorScreen(reason)
    await sendMessage(chatId, screen.text, screen.keyboard)
  }
}

// ─── Сообщения ──────────────────────────────────────────────────────────────

async function handleMessage(update: Update): Promise<void> {
  const message = update.message
  const from = message?.from
  if (!message || !from) return

  const chatId = message.chat.id
  const admin = isAdmin(from.id, from.username)
  const text = (message.text ?? '').trim()
  const command = text.split(/\s+/)[0]?.replace(/@.*$/, '').toLowerCase() ?? ''

  // Текстовый ввод: цена занятия или заметка об игроке.
  const waiting = pending.get(chatId)
  if (waiting && admin && !text.startsWith('/')) {
    pending.delete(chatId)
    const result =
      waiting.kind === 'price'
        ? await setSessionPrice(waiting.sessionId, Number(text.replace(/[^\d]/g, '')), from.id)
        : await saveNote(waiting.playerId, text)
    await answer(chatId, result, waiting.kind === 'price' ? await sessionsScreen(0) : await usersScreen())
    return
  }

  if (command === '/start') {
    if (admin) {
      await render(chatId, await menuScreen())
    } else {
      await sendMessage(chatId, HELP, {
        inline_keyboard: [[{ text: '🎾 Открыть приложение', url: appUrl() }]],
      })
    }
    return
  }

  if (command === '/me') {
    await meScreen(chatId, from.id)
    return
  }

  if (!admin) {
    await sendMessage(chatId, 'Это бот клуба. Записи и аренда — в приложении.', {
      inline_keyboard: [[{ text: '🎾 Открыть приложение', url: appUrl() }]],
    })
    return
  }

  switch (command) {
    case '/today':
      await render(chatId, await dayScreen(0))
      break
    case '/tomorrow':
      await render(chatId, await dayScreen(1))
      break
    case '/schedule':
      await render(chatId, await sessionsScreen(0))
      break
    case '/orders':
      await render(chatId, await ordersScreen())
      break
    case '/help':
      await render(chatId, await helpScreen())
      break
    default:
      await render(chatId, await menuScreen())
  }
}

/** Мои записи — читается без админских прав. */
async function meScreen(chatId: number, telegramId: number): Promise<void> {
  const sql = getDb()
  const rows = (await sql`
    select b.title, b.status,
           to_char(b.starts_at at time zone 'Europe/Moscow', 'DD.MM в HH24:MI') as start
    from bookings b
    join users u on u.id = b.user_id
    where u.telegram_id = ${telegramId} and b.status = 'active'
    order by b.starts_at
    limit 5
  `) as unknown as { title: string; start: string }[]
  if (rows.length === 0) {
    await sendMessage(chatId, 'Активных записей нет. Возьмите корт или запишитесь на занятие в приложении.', {
      inline_keyboard: [[{ text: '🎾 Открыть приложение', url: appUrl() }]],
    })
    return
  }
  const lines = rows.map((row) => `• ${row.start} — ${row.title}`)
  await sendMessage(chatId, [`<b>Ваши записи</b>`, '', ...lines].join('\n'))
}

// ─── Кнопки ─────────────────────────────────────────────────────────────────

async function handleCallback(update: Update): Promise<void> {
  const query = update.callback_query
  if (!query) return

  const chatId = query.message?.chat.id
  const messageId = query.message?.message_id
  const data = query.data ?? ''

  if (!isAdmin(query.from.id, query.from.username)) {
    await answerCallback(query.id, 'Раздел доступен администратору клуба')
    return
  }
  if (!chatId || !messageId) {
    await answerCallback(query.id)
    return
  }

  // id окна аренды содержит время («c1-18:00»), поэтому делим только по первому
  // двоеточию — иначе аргумент обрезался и кнопки свободной игры не срабатывали.
  const separator = data.indexOf(':')
  const action = separator === -1 ? data : data.slice(0, separator)
  const arg = separator === -1 ? '' : data.slice(separator + 1)
  const adminId = query.from.id

  /** Изменение данных: ответ в toast + перерисовка нужного экрана. */
  const change = async (run: () => Promise<Result>, screen: () => Promise<Screen>) => {
    const result = await run()
    await answerCallback(query.id, result.ok ? result.message ?? 'Готово' : result.message)
    if (result.ok) await render(chatId, await screen(), messageId)
  }

  switch (action) {
    case 'menu':
      await answerCallback(query.id)
      await render(chatId, await menuScreen(), messageId)
      return

    case 'help':
      await answerCallback(query.id)
      await render(chatId, await helpScreen(), messageId)
      return

    case 'day':
      await answerCallback(query.id)
      await render(chatId, await dayScreen(Number(arg || 0)), messageId)
      return

    case 'sessions':
      await answerCallback(query.id)
      await render(chatId, await sessionsScreen(Number(arg || 0)), messageId)
      return

    case 'slots':
      await answerCallback(query.id)
      await render(chatId, await slotsScreen(Number(arg || 0)), messageId)
      return

    case 'orders':
      await answerCallback(query.id)
      await render(chatId, await ordersScreen(), messageId)
      return

    case 'users':
      await answerCallback(query.id)
      await render(chatId, await usersScreen(), messageId)
      return

    case 'courts':
      await answerCallback(query.id)
      await render(chatId, await courtsScreen(), messageId)
      return

    case 'products':
      await answerCallback(query.id)
      await render(chatId, await productsScreen(), messageId)
      return

    case 'audit':
      await answerCallback(query.id)
      await render(chatId, await auditScreen(), messageId)
      return

    case 'cancel':
      return change(() => cancelBooking(arg, adminId), async () => dayScreen(0))

    case 'visited':
      return change(() => markVisited(arg, adminId), async () => dayScreen(0))

    case 'seats':
    case 'seatplus': {
      const delta = action === 'seatplus' ? 1 : -1
      return change(() => shiftSeats(arg, delta, adminId), async () => sessionsScreen(0))
    }

    case 'seatreserve':
      return change(() => reserveSeat(arg, adminId), async () => sessionsScreen(0))

    case 'sessprice':
      await answerCallback(query.id)
      pending.set(chatId, { kind: 'price', sessionId: arg })
      await render(chatId, await priceHint(arg), messageId)
      return

    case 'slotclose':
      return change(() => closeSlot(arg, adminId), async () => slotsScreen(0))

    case 'slotopen':
      return change(() => openSlot(arg, adminId), async () => slotsScreen(0))

    case 'issued':
      return change(() => markIssued(arg, adminId), async () => ordersScreen())

    case 'restore':
      return change(() => restoreBooking(arg, adminId), async () => dayScreen(0))

    case 'prodtoggle':
      return change(() => toggleProduct(arg, adminId), async () => productsScreen())

    case 'note':
      await answerCallback(query.id)
      pending.set(chatId, { kind: 'note', playerId: arg })
      await editMessage(
        chatId,
        messageId,
        '<b>Заметка об игроке</b>\n\nПришлите текст одним сообщением — он виден только в панели.',
        { inline_keyboard: [[{ text: '‹ Игроки', callback_data: 'users' }]] },
      )
      return

    case 'role': {
      const result = await setRole(arg, 'coach')
      await answerCallback(query.id, result.ok ? 'Роль: тренер' : result.message)
      await render(chatId, await usersScreen(), messageId)
      return
    }

    case 'repair': {
      const result = await repairSchema([...SCHEMA, ...SEED])
      await audit(adminId, 'schema.repair', { statements: result.applied })
      await answerCallback(query.id, `Схема обновлена: ${result.applied}`)
      await render(chatId, await menuScreen(), messageId)
      return
    }

    default:
      await answerCallback(query.id)
      await render(chatId, await menuScreen(), messageId)
  }
}

/** Ответ после текстового ввода: короткое подтверждение + экран. */
async function answer(chatId: number, result: Result, screen: Screen): Promise<void> {
  await sendMessage(chatId, result.ok ? `Готово: ${result.message ?? ''}` : `Не вышло: ${result.message}`)
  await render(chatId, screen)
}

async function render(chatId: number, screen: Screen, messageId?: number): Promise<void> {
  if (messageId) {
    await editMessage(chatId, messageId, screen.text, screen.keyboard)
    return
  }
  await sendMessage(chatId, screen.text, screen.keyboard)
}

/**
 * Vercel (Node runtime) понимает Web-сигнатуру только через объект с методом `fetch`.
 * «Голый» default-экспорт вызывается как handler(req, res) — Response терялся (500/504).
 */
export default { fetch: handler }
