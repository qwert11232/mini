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
  reserveSeat,
  restoreBooking,
  toggleProduct,
  saveNote,
  setRole,
  setSessionPrice,
  type Result,
} from './_lib/admin.js'
import * as catalog from './_lib/catalog-admin.js'
import {
  appUrl,
  auditScreen,
  courtsScreen,
  dayScreen,
  dbErrorScreen,
  helpScreen,
  menuScreen,
  categoryPickScreen,
  newProductScreen,
  ordersScreen,
  priceHint,
  productCardScreen,
  productFieldScreen,
  productListScreen,
  sessionBuilderScreen,
  sessionCardScreen,
  slotBuilderScreen,
  sessionsScreen,
  slotsScreen,
  usersScreen,
  type Screen,
} from './_lib/screens.js'
import {
  emptyDialog,
  loadDialogState,
  saveDialogState,
  stateMaps,
  type DialogMaps,
  type Pending,
} from './_lib/state.js'

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


async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Метод не поддерживается' }), {
      status: 405,
      headers: { 'content-type': 'application/json' },
    })
  }

  // Без секрета любой мог подделать update с ID администратора.
  const expected = webhookSecret()
  if (!expected || request.headers.get('x-telegram-bot-api-secret-token') !== expected) {
    console.warn('[bot] отклонён запрос с неверным секретом webhook')
    return new Response('forbidden', { status: 403 })
  }

  let update: Update
  try {
    update = (await request.json()) as Update
  } catch {
    return new Response('bad request', { status: 400 })
  }

  const from = update.callback_query?.from ?? update.message?.from
  const chatId = update.callback_query?.message?.chat.id ?? update.message?.chat.id
  const admin = from ? isAdmin(from.id, from.username) : false

  try {
    if (!chatId) {
      // Callback без сообщения (например, inline-режим) всё равно нужно закрыть.
      if (update.callback_query) await answerCallback(update.callback_query.id)
      return new Response('ok', { status: 200 })
    }

    // Гостям таблица состояния не нужна: их сообщения не запускают конструкторы.
    if (!admin) {
      await safe(chatId, async () => {
        const state = stateMaps(emptyDialog())
        if (update.callback_query) await handleCallback(update, state)
        else if (update.message) await handleMessage(update, state)
      })
      return new Response('ok', { status: 200 })
    }

    await safe(chatId, async () => {
      const dialog = await loadDialogState(chatId)
      const state = stateMaps(dialog)
      let failure: unknown = null
      try {
        if (update.callback_query) await handleCallback(update, state)
        else if (update.message) await handleMessage(update, state)
      } catch (error) {
        // Состояние сохраняем даже при ошибке экрана: шаги не должны теряться.
        failure = error
      }
      await saveDialogState(chatId, dialog)
      if (failure) throw failure
    })
  } catch (error) {
    console.error('[bot] ошибка обработки', error instanceof Error ? error.message : error)
  }

  // Telegram ждёт 200, иначе будет ретраить апдейт.
  return new Response('ok', { status: 200 })
}

/**
 * Раньше ошибка «база не подключена» уходила только в лог, а Telegram получал 200 —
 * в чате была тишина. Теперь админ видит причину и ссылку на диагностику.
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

async function handleMessage(update: Update, state: DialogMaps): Promise<void> {
  const message = update.message
  const from = message?.from
  if (!message || !from) return

  // Фото от админа: обложка товара (в карточке товара или в конструкторе).
  const photo = message.photo?.[message.photo.length - 1]
  if (photo && isAdmin(from.id, from.username)) {
    const waiting = state.pending.get(message.chat.id)
    state.pending.delete(message.chat.id)
    const target = waiting?.kind === 'productPhoto' ? waiting.productId : null
    if (target) {
      const result = await catalog.setProductPhoto(target, photo, from.id)
      await answer(message.chat.id, result, await productCardScreen(target))
      return
    }
    await sendMessage(message.chat.id, 'Фото получено, но не выбрано, куда его поставить. Откройте товар → «📷 Фото».')
    return
  }

  const chatId = message.chat.id
  const admin = isAdmin(from.id, from.username)
  const text = (message.text ?? '').trim()
  const command = text.split(/\s+/)[0]?.replace(/@.*$/, '').toLowerCase() ?? ''

  // Текстовый ввод от админа: цена, заметка, поля товара или занятия.
  const waiting = state.pending.get(chatId)
  if (waiting && admin && (await handleText(chatId, from.id, waiting, text, state))) return

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

/**
 * Текстовый ввод админа. Возвращает true, если сообщение было ответом на вопрос
 * конструктора и обрабатывать его как команду не нужно.
 */
async function handleText(chatId: number, adminId: number, waiting: Pending, text: string, state: DialogMaps): Promise<boolean> {
  if (text.startsWith('/')) {
    state.pending.delete(chatId)
    return false
  }

  const digits = Number(text.replace(/[^\d]/g, ''))

  switch (waiting.kind) {
    case 'price': {
      state.pending.delete(chatId)
      await answer(chatId, await setSessionPrice(waiting.sessionId, digits, adminId), await sessionsScreen(0))
      return true
    }
    case 'note': {
      state.pending.delete(chatId)
      await answer(chatId, await saveNote(waiting.playerId, text), await usersScreen())
      return true
    }
    case 'sessionField': {
      state.pending.delete(chatId)
      const patch =
        waiting.field === 'price'
          ? { price: digits }
          : waiting.field === 'time'
            ? { start: text.trim() }
            : waiting.field === 'seats'
              ? { seatsTotal: digits }
              : { durationMin: digits }
      await answer(chatId, await catalog.updateSession(waiting.sessionId, patch, adminId), await sessionsScreen(0))
      return true
    }
    case 'productField': {
      state.pending.delete(chatId)
      const patch =
        waiting.field === 'price'
          ? { price: digits }
          : waiting.field === 'title'
            ? { title: text }
            : { subtitle: text }
      await answer(
        chatId,
        await catalog.updateProduct(waiting.productId, patch, adminId),
        await productCardScreen(waiting.productId),
      )
      return true
    }
    case 'newProductField': {
      state.pending.delete(chatId)
      const draft = state.productDraft.get(chatId) ?? {}
      if (waiting.field === 'title') draft.title = text.trim()
      if (waiting.field === 'subtitle') draft.subtitle = text.trim()
      if (waiting.field === 'price') draft.price = digits
      state.productDraft.set(chatId, draft)
      await render(chatId, newProductScreen(draft))
      return true
    }
    case 'newSessionField': {
      state.pending.delete(chatId)
      const draft = state.sessionDraft.get(chatId) ?? {}
      if (waiting.field === 'title') draft.title = text.trim()
      if (waiting.field === 'time') draft.time = text.trim()
      if (waiting.field === 'price') draft.price = digits
      if (waiting.field === 'seats') draft.seats = digits
      if (waiting.field === 'duration') draft.durationMin = digits
      if (waiting.field === 'days') draft.days = Math.min(Math.max(digits, 1), 30)
      state.sessionDraft.set(chatId, draft)
      await render(chatId, sessionBuilderScreen(draft, await catalog.coaches(), await catalog.courts()))
      return true
    }
    case 'newSlotField': {
      state.pending.delete(chatId)
      const draft = state.slotDraft.get(chatId) ?? {}
      if (waiting.field === 'time') draft.time = text.trim()
      if (waiting.field === 'price') draft.price = digits
      if (waiting.field === 'days') draft.days = Math.min(Math.max(digits, 1), 30)
      state.slotDraft.set(chatId, draft)
      await render(chatId, slotBuilderScreen(draft, await catalog.courts()))
      return true
    }
    default:
      state.pending.delete(chatId)
      return false
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

async function handleCallback(update: Update, state: DialogMaps): Promise<void> {
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
      await render(chatId, await productListScreen(), messageId)
      return

    // ── Товары: карточка, поля, фото, создание ───────────────────────────
    case 'prodedit':
      await answerCallback(query.id)
      await render(chatId, await productCardScreen(arg), messageId)
      return

    case 'prodprice':
    case 'prodtitle':
    case 'prodsub': {
      await answerCallback(query.id)
      const field = action === 'prodprice' ? 'price' : action === 'prodtitle' ? 'title' : 'subtitle'
      state.pending.set(chatId, { kind: 'productField', productId: arg, field })
      const hint =
        field === 'price'
          ? 'Новая цена товара — пришлите число'
          : field === 'title'
            ? 'Новое название товара'
            : 'Новое описание товара'
      await render(chatId, productFieldScreen(hint), messageId)
      return
    }

    case 'prodcat': {
      await answerCallback(query.id)
      await render(chatId, categoryPickScreen(`prodcatset:${arg}`), messageId)
      return
    }

    case 'prodcatset': {
      const [productId = '', indexRaw = '0'] = arg.split(':')
      const category = catalog.CATEGORIES[Number(indexRaw)]
      if (!category) {
        await answerCallback(query.id, 'Категория не найдена')
        return
      }
      return change(() => catalog.updateProduct(productId, { category }, adminId), async () => productCardScreen(productId))
    }

    case 'prodphoto':
      await answerCallback(query.id)
      state.pending.set(chatId, { kind: 'productPhoto', productId: arg })
      await editMessage(
        chatId,
        messageId,
        '<b>Фото товара</b>\n\nПришлите картинку прямо в чат — она сразу появится на сайте.',
        { inline_keyboard: [[{ text: '‹ Товар', callback_data: `prodedit:${arg}` }]] },
      )
      return

    case 'prodtoggle':
      return change(() => catalog.toggleProduct(arg, adminId), async () => productCardScreen(arg))

    case 'proddel': {
      const result = await catalog.deleteProduct(arg, adminId)
      await answerCallback(query.id, result.message)
      await render(chatId, await productListScreen(), messageId)
      return
    }

    case 'prodnue':
      await answerCallback(query.id)
      state.productDraft.set(chatId, {})
      await render(chatId, newProductScreen({}), messageId)
      return

    case 'newname':
    case 'newprice':
    case 'newsub': {
      await answerCallback(query.id)
      const field = action === 'newname' ? 'title' : action === 'newprice' ? 'price' : 'subtitle'
      state.pending.set(chatId, { kind: 'newProductField', field })
      const hint =
        field === 'title'
          ? 'Название товара'
          : field === 'price'
            ? 'Цена товара — число'
            : 'Короткое описание (необязательно)'
      await editMessage(chatId, messageId, `<b>${hint}</b>\n\nПришлите значение сообщением.`, {
        inline_keyboard: [[{ text: '‹ Отмена', callback_data: 'prodnue' }]],
      })
      return
    }

    case 'newcat':
      await answerCallback(query.id)
      await render(chatId, categoryPickScreen('newcatset'), messageId)
      return

    case 'newcatset': {
      const category = catalog.CATEGORIES[Number(arg)]
      if (!category) {
        await answerCallback(query.id, 'Категория не найдена')
        return
      }
      const draft = state.productDraft.get(chatId) ?? {}
      draft.category = category
      state.productDraft.set(chatId, draft)
      await answerCallback(query.id, category)
      await render(chatId, newProductScreen(draft), messageId)
      return
    }

    case 'newphoto':
      await answerCallback(query.id)
      state.pending.set(chatId, { kind: 'productPhoto', productId: '' })
      await editMessage(
        chatId,
        messageId,
        '<b>Фото товара</b>\n\nПришлите картинку в чат — она привяжется, когда вы сохраните товар.',
        { inline_keyboard: [[{ text: '‹ К товару', callback_data: 'prodnue' }]] },
      )
      return

    case 'newsave': {
      const draft = state.productDraft.get(chatId)
      if (!draft?.title || draft.price === undefined || !draft.category) {
        await answerCallback(query.id, 'Заполните название, цену и категорию')
        return
      }
      const result = await catalog.createProduct(
        { title: draft.title, subtitle: draft.subtitle, category: draft.category, price: draft.price },
        adminId,
      )
      if (result.ok && result.id) {
        state.productDraft.delete(chatId)
        await answerCallback(query.id, result.message)
        await render(chatId, await productCardScreen(result.id), messageId)
        return
      }
      await answerCallback(query.id, result.message)
      return
    }

    case 'newnothing':
      await answerCallback(query.id, 'Заполните название, цену и категорию')
      return

    // ── Расписание: конструктор и карточка занятия ───────────────────────
    case 'sesnue':
      await answerCallback(query.id)
      state.sessionDraft.set(chatId, { days: 1, durationMin: 60 })
      await render(chatId, sessionBuilderScreen({ days: 1, durationMin: 60 }, await catalog.coaches(), await catalog.courts()), messageId)
      return

    case 'sesname':
    case 'sestime':
    case 'sesprice':
    case 'sesseats':
    case 'sesdur':
    case 'sesdays': {
      await answerCallback(query.id)
      const field =
        action === 'sesname'
          ? 'title'
          : action === 'sestime'
            ? 'time'
            : action === 'sesprice'
              ? 'price'
              : action === 'sesseats'
                ? 'seats'
                : action === 'sesdur'
                  ? 'duration'
                  : 'days'
      state.pending.set(chatId, { kind: 'newSessionField', field })
      const hint =
        field === 'title'
          ? 'Название занятия'
          : field === 'time'
            ? 'Время начала, ЧЧ:ММ'
            : field === 'price'
              ? 'Цена занятия — число'
              : field === 'seats'
                ? 'Сколько мест в группе'
                : field === 'duration'
                  ? 'Длительность в минутах'
                  : 'На сколько дней вперёд поставить (1–30)'
      await editMessage(chatId, messageId, `<b>${hint}</b>\n\nПришлите значение сообщением.`, {
        inline_keyboard: [[{ text: '‹ Отмена', callback_data: 'sessions:0' }]],
      })
      return
    }

    case 'sesgroup':
    case 'seslevel': {
      await answerCallback(query.id)
      const isGroup = action === 'sesgroup'
      const items: readonly string[] = isGroup ? catalog.GROUPS : catalog.LEVELS
      await render(
        chatId,
        {
          text: isGroup ? '<b>Формат занятия</b>' : '<b>Уровень группы</b>',
          keyboard: {
            inline_keyboard: [
              ...items.map((item, index) => [
                { text: item, callback_data: `${isGroup ? 'sesgroupset' : 'seslevelset'}:${index}` },
              ]),
              [{ text: '‹ Назад', callback_data: 'sessions:0' }],
            ],
          },
        },
        messageId,
      )
      return
    }

    case 'sesgroupset':
    case 'seslevelset':
    case 'sescoach':
    case 'sescourt': {
      const draft = state.sessionDraft.get(chatId) ?? {}
      if (action === 'sesgroupset') draft.groupIndex = Number(arg)
      if (action === 'seslevelset') draft.levelIndex = Number(arg)
      if (action === 'sescoach') draft.coachId = arg
      if (action === 'sescourt') draft.courtId = arg
      state.sessionDraft.set(chatId, draft)
      await answerCallback(query.id)
      await render(chatId, sessionBuilderScreen(draft, await catalog.coaches(), await catalog.courts()), messageId)
      return
    }

    case 'sessave': {
      const draft = state.sessionDraft.get(chatId)
      await answerCallback(query.id)
      if (!draft) return
      const result = await catalog.createSession(
        {
          title: String(draft.title ?? ''),
          groupKind: catalog.GROUPS[draft.groupIndex ?? -1] ?? '',
          level: catalog.LEVELS[draft.levelIndex ?? -1] ?? '',
          coachId: String(draft.coachId ?? ''),
          courtId: String(draft.courtId ?? ''),
          start: String(draft.time ?? ''),
          durationMin: Number(draft.durationMin ?? 60),
          price: Number(draft.price ?? 0),
          seatsTotal: Number(draft.seats ?? 0),
          days: Number(draft.days ?? 1),
        },
        adminId,
      )
      if (result.ok) state.sessionDraft.delete(chatId)
      await sendMessage(chatId, result.ok ? `Готово: ${result.message}` : `Не вышло: ${result.message}`)
      await render(chatId, await sessionsScreen(0), messageId)
      return
    }

    case 'sesnothing':
      await answerCallback(query.id, 'Заполните все поля')
      return

    case 'sescard': {
      await answerCallback(query.id)
      const row = await catalog.sessionById(arg)
      if (!row) {
        await sendMessage(chatId, 'Занятие не найдено.')
        return
      }
      await render(chatId, sessionCardScreen({ ...row, active: row.isActive }), messageId)
      return
    }

    case 'sestoggle':
      return change(() => catalog.toggleSession(arg, adminId), async () => sessionsScreen(0))

    case 'sesdel':
      return change(() => catalog.deleteSession(arg, adminId), async () => sessionsScreen(0))

    case 'sessprice2':
    case 'sestime2':
    case 'sesseats2': {
      await answerCallback(query.id)
      state.pending.set(chatId, {
        kind: 'sessionField',
        sessionId: arg,
        field: action === 'sessprice2' ? 'price' : action === 'sestime2' ? 'time' : 'seats',
      })
      await editMessage(
        chatId,
        messageId,
        action === 'sessprice2'
          ? '<b>Новая цена занятия</b>\n\nПришлите число.'
          : action === 'sestime2'
            ? '<b>Новое время занятия</b>\n\nПришлите ЧЧ:ММ.'
            : '<b>Сколько мест</b>\n\nПришлите число.',
        { inline_keyboard: [[{ text: '‹ Расписание', callback_data: 'sessions:0' }]] },
      )
      return
    }

    // ── Свободная игра: конструктор окон ─────────────────────────────────
    case 'slotnue':
      await answerCallback(query.id)
      state.slotDraft.set(chatId, { days: 1 })
      await render(chatId, slotBuilderScreen({ days: 1 }, await catalog.courts()), messageId)
      return

    case 'slottime':
    case 'slotprice':
    case 'slotdays': {
      await answerCallback(query.id)
      const field = action === 'slottime' ? 'time' : action === 'slotprice' ? 'price' : 'days'
      state.pending.set(chatId, { kind: 'newSlotField', field })
      const hint =
        field === 'time'
          ? 'Время начала окна, ЧЧ:ММ'
          : field === 'price'
            ? 'Цена аренды — число'
            : 'На сколько дней вперёд (1–30)'
      await editMessage(chatId, messageId, `<b>${hint}</b>\n\nПришлите значение сообщением.`, {
        inline_keyboard: [[{ text: '‹ Отмена', callback_data: 'slots:0' }]],
      })
      return
    }

    case 'slotcourt': {
      const draft = state.slotDraft.get(chatId) ?? {}
      draft.courtId = arg
      state.slotDraft.set(chatId, draft)
      await answerCallback(query.id)
      await render(chatId, slotBuilderScreen(draft, await catalog.courts()), messageId)
      return
    }

    case 'slotsave': {
      const draft = state.slotDraft.get(chatId)
      await answerCallback(query.id)
      if (!draft?.time || draft.price === undefined || !draft.courtId) {
        await sendMessage(chatId, 'Заполните время, цену и корт.')
        return
      }
      const result = await catalog.createSlots(
        { courtId: draft.courtId, start: draft.time, durationMin: 60, price: draft.price, days: draft.days ?? 1 },
        adminId,
      )
      if (result.ok) state.slotDraft.delete(chatId)
      await sendMessage(chatId, result.ok ? `Готово: ${result.message}` : `Не вышло: ${result.message}`)
      await render(chatId, await slotsScreen(0), messageId)
      return
    }

    case 'slotnothing':
      await answerCallback(query.id, 'Заполните время, цену и корт')
      return

    case 'slotdel':
      return change(() => catalog.deleteSlot(arg, adminId), async () => slotsScreen(0))

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
      state.pending.set(chatId, { kind: 'price', sessionId: arg })
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
      return change(() => toggleProduct(arg, adminId), async () => productListScreen())

    case 'note':
      await answerCallback(query.id)
      state.pending.set(chatId, { kind: 'note', playerId: arg })
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

    case 'repair':
      // Старые сообщения могут содержать кнопку. Не запускаем SEED на живой базе.
      await answerCallback(query.id, 'Автоматическое восстановление отключено. Обратитесь к разработчику.')
      return

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
