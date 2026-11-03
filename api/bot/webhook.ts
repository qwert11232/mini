import { audit, getDb, isAdmin } from './_lib/db.js'
import { answerCallback, editMessage, sendMessage, webhookSecret, type Update } from './_lib/telegram.js'
import {
  dayScreen,
  menuScreen,
  ordersScreen,
  sessionsScreen,
  usersScreen,
  type Screen,
} from './_lib/screens.js'

/**
 * POST /api/bot/webhook — единственная точка входа бота.
 *
 * Бот работает как панель администратора: смотрит записи по дням, отменяет их,
 * правит заполненность занятий и выдаёт заказы. Все действия проверяют права
 * на сервере и попадают в admin_audit. Клиентский мини-апп сюда не ходит.
 */

const HELP = [
  '<b>ДТ · бот клуба</b>',
  '',
  '/start — панель администратора',
  '/today — записи на сегодня',
  '/tomorrow — записи на завтра',
  '/schedule — расписание занятий',
  '/orders — заказы к выдаче',
  '/me — моя карточка игрока',
  '',
  'Записаться на занятие и арендовать корт можно в приложении.',
].join('\n')

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
      await handleCallback(update)
    } else if (update.message?.text) {
      await handleMessage(update)
    }
  } catch (error) {
    console.error('[bot] ошибка обработки', error instanceof Error ? error.message : error)
  }

  // Telegram ждёт 200, иначе будет ретраить апдейт.
  return new Response('ok', { status: 200 })
}

/**
 * Раньше ошибка «база не подключена» уходила только в лог, а Telegram получал 200 —
 * в чате была тишина, и причину приходилось искать по /api/health. Теперь админ
 * получает объяснение и ссылку на диагностику.
 */
async function withDb(chatId: number, work: () => Promise<void>): Promise<void> {
  try {
    await work()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.error('[bot] ошибка работы с базой', reason)
    if (chatId > 0) {
      await sendMessage(
        chatId,
        [
          '<b>Панель временно недоступна</b>',
          '',
          `Причина: ${escapeHtml(reason)}`,
          '',
          'Проверка связки: /api/health?diag=1 — там видно, задана ли строка подключения к базе.',
        ].join('\n'),
      )
    } else {
      await sendMessage(chatId, 'Панель временно недоступна: база не отвечает.')
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function handleMessage(update: Update): Promise<void> {
  const message = update.message
  if (!message?.from) return

  const from = message.from
  if (!from) return

  const chatId = message.chat.id
  const admin = isAdmin(from.id, from.username)
  const text = (message.text ?? '').trim()
  const command = text.split(/\s+/)[0]?.replace(/@.*$/, '').toLowerCase() ?? ''

  if (command === '/start') {
    if (admin) {
      await withDb(chatId, async () => render(chatId, await menuScreen()))
    } else {
      await sendMessage(chatId, HELP, {
        inline_keyboard: [[{ text: '🎾 Открыть приложение', url: appUrl() }]],
      })
    }
    return
  }

  if (command === '/me') {
    await withDb(chatId, () => meScreen(chatId, from.id))
    return
  }

  if (!admin) {
    await sendMessage(chatId, 'Это бот клуба. Записи и аренда — в приложении.', {
      inline_keyboard: [[{ text: '🎾 Открыть приложение', url: appUrl() }]],
    })
    return
  }

  await withDb(chatId, async () => {
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
        await sendMessage(chatId, HELP)
        break
      default:
        await render(chatId, await menuScreen())
    }
  })
}

/** Мои записи — читается без админских прав, поэтому вынесено отдельной функцией. */
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

  const [action, arg] = data.split(':')

  switch (action) {
    case 'menu':
      await answerCallback(query.id)
      await render(chatId, await menuScreen(), messageId)
      return

    case 'day':
      await answerCallback(query.id)
      await render(chatId, await dayScreen(Number(arg ?? 0)), messageId)
      return

    case 'sessions': {
      await answerCallback(query.id)
      await render(chatId, await sessionsScreen(Number(arg ?? 0)), messageId)
      return
    }

    case 'orders':
      await answerCallback(query.id)
      await render(chatId, await ordersScreen(), messageId)
      return

    case 'users':
      await answerCallback(query.id)
      await render(chatId, await usersScreen(), messageId)
      return

    case 'cancel': {
      const result = await cancelBooking(arg ?? '', query.from.id)
      await answerCallback(query.id, result.ok ? 'Запись отменена' : 'Не удалось отменить')
      await render(chatId, await dayScreen(0), messageId)
      return
    }

    case 'seats':
    case 'seatplus': {
      const delta = action === 'seatplus' ? 1 : -1
      const result = await shiftSeats(arg ?? '', delta, query.from.id)
      await answerCallback(query.id, result.ok ? 'Места обновлены' : 'Не удалось изменить места')
      await render(chatId, await sessionsScreen(0), messageId)
      return
    }

    case 'issued': {
      const result = await markIssued(arg ?? '', query.from.id)
      await answerCallback(query.id, result.ok ? 'Заказ выдан' : 'Заказ уже выдан')
      await render(chatId, await ordersScreen(), messageId)
      return
    }

    default:
      await answerCallback(query.id)
      await render(chatId, await menuScreen(), messageId)
  }
}

async function render(chatId: number, screen: Screen, messageId?: number): Promise<void> {
  if (messageId) {
    await editMessage(chatId, messageId, screen.text, screen.keyboard)
    return
  }
  await sendMessage(chatId, screen.text, screen.keyboard)
}

type Result = { ok: true } | { ok: false; message: string }

/** Отмена записи админом: возвращает место или окно аренды в продажу. */
async function cancelBooking(bookingId: string, adminTelegramId: number): Promise<Result> {
  if (!bookingId) return { ok: false, message: 'Запись не найдена' }
  const sql = getDb()

  const cancelled = (await sql`
    update bookings
    set status = 'cancelled', cancelled_at = now()
    where id = ${bookingId} and status = 'active'
    returning kind, source_id as "sourceId", title
  `) as unknown as { kind: string; sourceId: string; title: string }[]

  const row = cancelled[0]
  if (!row) return { ok: false, message: 'Запись уже отменена' }

  if (row.kind === 'free') {
    await sql`update free_slots set is_active = true where id = ${row.sourceId}`
  } else {
    await sql`update training_sessions set seats_taken = greatest(seats_taken - 1, 0) where id = ${row.sourceId}`
  }

  await audit(adminTelegramId, 'booking.cancel', { bookingId, kind: row.kind, title: row.title })
  console.info('[bot] booking cancelled', { bookingId, by: adminTelegramId })
  return { ok: true }
}

/** Ручная корректировка числа записавшихся (админ видит реальную явку). */
async function shiftSeats(sessionId: string, delta: number, adminTelegramId: number): Promise<Result> {
  if (!sessionId) return { ok: false, message: 'Занятие не найдено' }
  const sql = getDb()

  const updated = (await sql`
    update training_sessions
    set seats_taken = least(greatest(seats_taken + ${delta}, 0), seats_total)
    where id = ${sessionId}
    returning seats_taken as taken, seats_total as total, title
  `) as unknown as { taken: number; total: number; title: string }[]

  const row = updated[0]
  if (!row) return { ok: false, message: 'Занятие не найдено' }

  await audit(adminTelegramId, 'session.seats', { sessionId, delta, taken: row.taken })
  return { ok: true }
}

async function markIssued(orderId: string, adminTelegramId: number): Promise<Result> {
  if (!orderId) return { ok: false, message: 'Заказ не найден' }
  const sql = getDb()

  const updated = (await sql`
    update orders set status = 'issued'
    where id = ${orderId} and status = 'reserved'
    returning id, price
  `) as unknown as { id: string; price: number }[]

  if (!updated[0]) return { ok: false, message: 'Заказ уже выдан' }

  await audit(adminTelegramId, 'order.issued', { orderId, price: updated[0].price })
  const [buyer] = (await sql`
    select u.telegram_id as "telegramId", p.title
    from orders o join users u on u.id = o.user_id join products p on p.id = o.product_id
    where o.id = ${orderId}
  `) as unknown as { telegramId: number; title: string }[]

  if (buyer) {
    // Покупателю — короткое уведомление, что заказ готов.
    await sendMessage(buyer.telegramId, `Заказ готов к выдаче: <b>${buyer.title}</b>. Ждём на ресепшене.`)
  }
  return { ok: true }
}

function appUrl(): string {
  return process.env.VITE_APP_URL ?? 'https://mini-seven-xi.vercel.app'
}

/**
 * Vercel (Node runtime) понимает Web-сигнатуру только через объект с методом `fetch`.
 * «Голый» default-экспорт вызывается как handler(req, res) — Response терялся (500/504).
 */
export default { fetch: handler }
