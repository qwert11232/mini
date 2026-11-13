import { isAdmin } from './_lib/db.js'
import {
  answerCallback,
  editMessage,
  sendMessage,
  webhookSecret,
  type TelegramUser,
  type Update,
} from './_lib/telegram.js'
import {
  cancelBooking,
  markIssued,
  cancelManualSeat,
} from './_lib/bookings.js'
import {
  closeSlot,
  bookingDayOffset,
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
import {
  cancelOwnBooking,
  userAboutScreen,
  userBookingsScreen,
  userCancelScreen,
  userHelpScreen,
  userHomeScreen,
  userOrdersScreen,
  userScheduleScreen,
} from './_lib/user-screens.js'

type BotRole = 'admin' | 'player'

const ADMIN_ONLY_COMMANDS = new Set(['/today', '/tomorrow', '/admin'])

function roleOf(from: TelegramUser): BotRole {
  return isAdmin(from.id) ? 'admin' : 'player'
}

function isUserAction(data: string): boolean {
  return data.startsWith('u:')
}

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
  const chat = update.callback_query?.message?.chat ?? update.message?.chat

  try {
    if (!from || !Number.isSafeInteger(from.id) || from.id <= 0 || from.is_bot || !chat) {
      if (update.callback_query) await answerCallback(update.callback_query.id)
      return new Response('ok', { status: 200 })
    }

    // Персональные данные и админ-панель нельзя показывать в группах. Кнопки
    // web_app Telegram тоже разрешает только в личном чате пользователя с ботом.
    if (chat.type !== 'private' || chat.id !== from.id) {
      if (update.callback_query) {
        await answerCallback(update.callback_query.id, 'Откройте бота в личном чате')
      } else if (chat.type !== 'private' && update.message?.text?.trim().startsWith('/')) {
        await sendMessage(chat.id, 'Пожалуйста, откройте бота в личном чате.')
      }
      return new Response('ok', { status: 200 })
    }

    const role = roleOf(from)
    const callbackId = update.callback_query?.id

    // Игрокам таблица черновиков администратора не нужна.
    if (role === 'player') {
      await safe(chat.id, role, callbackId, async () => {
        const state = stateMaps(emptyDialog())
        if (update.callback_query) await handleCallback(update, state, role)
        else if (update.message) await handleMessage(update, state, role)
      })
      return new Response('ok', { status: 200 })
    }

    await safe(chat.id, role, callbackId, async () => {
      const dialog = await loadDialogState(chat.id)
      const state = stateMaps(dialog)
      let failure: unknown = null
      try {
        if (update.callback_query) await handleCallback(update, state, role)
        else if (update.message) await handleMessage(update, state, role)
      } catch (error) {
        // Состояние сохраняем даже при ошибке экрана: шаги не должны теряться.
        failure = error
      }
      await saveDialogState(chat.id, dialog)
      if (failure) throw failure
    })
  } catch (error) {
    console.error('[bot] ошибка обработки', error instanceof Error ? error.message : error)
  }

  // Telegram ждёт 200, иначе будет ретраить апдейт.
  return new Response('ok', { status: 200 })
}

/** Пользователю не показываем технические детали БД и подсказки администратора. */
async function safe(chatId: number, role: BotRole, callbackId: string | undefined, work: () => Promise<void>): Promise<void> {
  try {
    await work()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.error('[bot] ошибка', reason)
    if (callbackId) {
      try {
        await answerCallback(callbackId, 'Не удалось выполнить действие. Попробуйте позже.')
      } catch {
        // Попытаемся хотя бы отправить сообщение в чат.
      }
    }
    const screen = role === 'admin'
      ? await dbErrorScreen(reason)
      : {
          text: '<b>Временно недоступно</b>\n\nНе удалось получить данные. Попробуйте ещё раз позже.',
          keyboard: { inline_keyboard: [[{ text: '‹ Меню', callback_data: 'u:home' }]] },
        }
    await sendMessage(chatId, screen.text, screen.keyboard)
  }
}

// ─── Сообщения ──────────────────────────────────────────────────────────────

async function handleMessage(update: Update, state: DialogMaps, role: BotRole): Promise<void> {
  const message = update.message
  const from = message?.from
  if (!message || !from) return

  const chatId = message.chat.id
  const admin = role === 'admin'
  const photo = message.photo?.[message.photo.length - 1]

  // Фото от админа: обложка товара (в карточке товара или в конструкторе).
  // Игроку нельзя даже случайно перевести диалог в админский сценарий.
  if (photo) {
    if (!admin) {
      await render(chatId, userHomeScreen(from.first_name, 'Фото принимаются только от администратора.'))
      return
    }
    const waiting = state.pending.get(chatId)
    if (waiting?.kind !== 'productPhoto') {
      await sendMessage(chatId, waiting
        ? 'Сейчас ожидается текст. Для отмены нажмите кнопку «Отмена» или отправьте /start.'
        : 'Фото получено, но не выбрано, куда его поставить. Откройте товар → «📷 Фото».')
      return
    }
    if (waiting.productId) {
      const result = await catalog.setProductPhoto(waiting.productId, photo, from.id)
      if (!result.ok) {
        await sendMessage(chatId, `Не вышло: ${result.message}. Попробуйте другое фото.`)
        return
      }
      state.pending.delete(chatId)
      await answer(chatId, result, await productCardScreen(waiting.productId))
      return
    }
    const prepared = await catalog.prepareProductPhoto(photo)
    if (!prepared.ok) {
      await sendMessage(chatId, `Не вышло: ${prepared.message}. Попробуйте другое фото.`)
      return
    }
    const draft = state.productDraft.get(chatId) ?? {}
    draft.image = prepared.image
    state.productDraft.set(chatId, draft)
    state.pending.delete(chatId)
    await render(chatId, newProductScreen(draft))
    return
  }

  const text = (message.text ?? '').trim()
  const command = text.split(/\s+/)[0]?.replace(/@.*$/, '').toLowerCase() ?? ''

  // Текстовый ввод админа: цена, заметка, поля товара или занятия.
  const waiting = state.pending.get(chatId)
  if (waiting && admin && (await handleText(chatId, from.id, waiting, text, state))) return

  if (command === '/start') {
    await render(chatId, admin ? await menuScreen() : userHomeScreen(from.first_name))
    return
  }

  if (command === '/me') {
    await render(chatId, await userBookingsScreen(from.id, admin))
    return
  }

  if (!admin) {
    if (command === '/schedule') {
      await render(chatId, await userScheduleScreen(0, false))
      return
    }
    if (command === '/help') {
      await render(chatId, userHelpScreen(false))
      return
    }
    if (command === '/orders') {
      await render(chatId, await userOrdersScreen(from.id))
      return
    }
    if (ADMIN_ONLY_COMMANDS.has(command)) {
      await render(chatId, userHomeScreen(from.first_name, 'Эта команда доступна только администратору клуба.'))
      return
    }
    await render(chatId, userHomeScreen(from.first_name, 'Не понял сообщение. Напишите /help или выберите кнопку.'))
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
    case '/admin':
      await render(chatId, await menuScreen())
      break
    default:
      await render(chatId, await menuScreen())
  }
}

/** Проверяем поле до изменения черновика; неверный ответ можно прислать повторно. */
function inputError(waiting: Pending, text: string): string | null {
  if (waiting.kind === 'productPhoto') return 'Пришлите фото или нажмите «Отмена».'
  if (waiting.kind === 'note') {
    return text.trim() && text.length <= 500 ? null : 'Заметка должна содержать от 1 до 500 символов.'
  }
  const field = waiting.kind === 'price' ? 'price' : 'field' in waiting ? waiting.field : null
  if (field === 'title' && (!text.trim() || text.trim().length > 120)) return 'Название: от 1 до 120 символов.'
  if (field === 'subtitle' && text.length > 160) return 'Описание: не более 160 символов.'
  if (field === 'time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(text.trim())) return 'Введите время в формате ЧЧ:ММ.'

  const ranges = {
    price: [0, 200000],
    seats: [1, 40],
    duration: [15, 240],
    days: [1, 30],
  } as const
  if (field && field in ranges) {
    const compact = text.replace(/\s/g, '')
    const [min, max] = ranges[field as keyof typeof ranges]
    const value = Number(compact)
    if (!/^\d+$/.test(compact) || !Number.isSafeInteger(value) || value < min || value > max) {
      return `Введите целое число от ${min} до ${max}.`
    }
  }
  return null
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

  const error = inputError(waiting, text)
  if (error) {
    await sendMessage(chatId, error)
    return true
  }
  const digits = Number(text.replace(/\s/g, ''))

  switch (waiting.kind) {
    case 'price': {
      state.pending.delete(chatId)
      await answer(chatId, await setSessionPrice(waiting.sessionId, digits, adminId), await sessionListFor(waiting.sessionId))
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
      await answer(chatId, await catalog.updateSession(waiting.sessionId, patch, adminId), await sessionListFor(waiting.sessionId))
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

// ─── Кнопки ─────────────────────────────────────────────────────────────────

async function handleCallback(update: Update, state: DialogMaps, role: BotRole): Promise<void> {
  const query = update.callback_query
  if (!query) return

  const chatId = query.message?.chat.id
  const messageId = query.message?.message_id
  const data = query.data ?? ''

  // Роль получена по Telegram ID на этом update, а не из callback_data.
  if (role !== 'admin' && !isUserAction(data)) {
    await answerCallback(query.id, 'Раздел доступен администратору клуба')
    return
  }
  if (!chatId || !messageId) {
    await answerCallback(query.id)
    return
  }
  if (role === 'admin') state.pending.delete(chatId)
  if (isUserAction(data)) {
    await handleUserCallback(query, chatId, messageId, role)
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
      await render(chatId, categoryPickScreen(`prodcatset:${arg}`, `prodedit:${arg}`), messageId)
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

    case 'prodresume':
      await answerCallback(query.id)
      await render(chatId, newProductScreen(state.productDraft.get(chatId) ?? {}), messageId)
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
        inline_keyboard: [[{ text: '‹ Отмена', callback_data: 'prodresume' }]],
      })
      return
    }

    case 'newcat':
      await answerCallback(query.id)
      await render(chatId, categoryPickScreen('newcatset', 'prodresume'), messageId)
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
        { inline_keyboard: [[{ text: '‹ К товару', callback_data: 'prodresume' }]] },
      )
      return

    case 'newsave': {
      const draft = state.productDraft.get(chatId)
      if (!draft?.title || draft.price === undefined || !draft.category) {
        await answerCallback(query.id, 'Заполните название, цену и категорию')
        return
      }
      const result = await catalog.createProduct(
        { title: draft.title, subtitle: draft.subtitle, category: draft.category, price: draft.price, image: draft.image },
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

    case 'sesresume':
      await answerCallback(query.id)
      await render(chatId, sessionBuilderScreen(state.sessionDraft.get(chatId) ?? {}, await catalog.coaches(), await catalog.courts()), messageId)
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
        inline_keyboard: [[{ text: '‹ Отмена', callback_data: 'sesresume' }]],
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
              [{ text: '‹ Назад', callback_data: 'sesresume' }],
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
      return change(() => catalog.toggleSession(arg, adminId), () => sessionListFor(arg))

    case 'sesdel': {
      const offset = (await catalog.sessionById(arg))?.dayOffset ?? 0
      return change(() => catalog.deleteSession(arg, adminId), () => sessionsScreen(offset))
    }

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

    case 'slotresume':
      await answerCallback(query.id)
      await render(chatId, slotBuilderScreen(state.slotDraft.get(chatId) ?? {}, await catalog.courts()), messageId)
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
        inline_keyboard: [[{ text: '‹ Отмена', callback_data: 'slotresume' }]],
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

    case 'slotdel': {
      const offset = (await catalog.slotDayOffset(arg)) ?? 0
      return change(() => catalog.deleteSlot(arg, adminId), () => slotsScreen(offset))
    }

    case 'audit':
      await answerCallback(query.id)
      await render(chatId, await auditScreen(), messageId)
      return

    case 'cancel':
      return change(() => cancelBooking(arg, adminId), () => dayForBooking(arg))

    case 'visited':
      return change(() => markVisited(arg, adminId), () => dayForBooking(arg))

    case 'seats':
      return change(() => cancelManualSeat(arg, adminId), () => sessionListFor(arg))

    case 'seatplus':
    case 'seatreserve':
      return change(() => reserveSeat(arg, adminId), () => sessionListFor(arg))

    case 'sessprice':
      await answerCallback(query.id)
      state.pending.set(chatId, { kind: 'price', sessionId: arg })
      await render(chatId, await priceHint(arg), messageId)
      return

    case 'slotclose':
      return change(() => closeSlot(arg, adminId), () => slotsFor(arg))

    case 'slotopen':
      return change(() => openSlot(arg, adminId), () => slotsFor(arg))

    case 'issued':
      return change(() => markIssued(arg, adminId), async () => ordersScreen())

    case 'restore':
      return change(() => restoreBooking(arg, adminId), () => dayForBooking(arg))

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
      await answerCallback(query.id, result.ok ? 'Отметка: тренер (без прав администратора)' : result.message)
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

async function handleUserCallback(
  query: NonNullable<Update['callback_query']>,
  chatId: number,
  messageId: number | undefined,
  role: BotRole,
): Promise<void> {
  const [, action = '', arg = ''] = (query.data ?? '').split(':')
  const adminPreview = role === 'admin'
  const show = async (screen: Screen, text?: string): Promise<void> => {
    await answerCallback(query.id, text)
    await render(chatId, screen, messageId)
  }

  switch (action) {
    case 'home':
      await show(userHomeScreen(query.from.first_name, undefined, adminPreview))
      return
    case 'admin':
      if (adminPreview) {
        await show(await menuScreen())
      } else {
        await answerCallback(query.id, 'Раздел доступен администратору клуба')
      }
      return
    case 'help':
      await show(userHelpScreen(adminPreview))
      return
    case 'about':
      await show(userAboutScreen(adminPreview))
      return
    case 'schedule':
      await show(await userScheduleScreen(Number(arg || 0), adminPreview))
      return
    case 'me':
      await show(await userBookingsScreen(query.from.id, adminPreview))
      return
    case 'orders':
      await show(await userOrdersScreen(query.from.id, adminPreview))
      return
    case 'cancelask':
      await show(await userCancelScreen(arg, query.from.id, adminPreview))
      return
    case 'cancel': {
      const result = await cancelOwnBooking(arg, query.from.id)
      await show(
        await userBookingsScreen(query.from.id, adminPreview, result.ok ? 'Запись отменена.' : result.message),
        result.ok ? 'Запись отменена' : result.message,
      )
      return
    }
    default:
      await show(userHomeScreen(query.from.first_name, 'Раздел не найден.', adminPreview), 'Раздел не найден')
  }
}

/** После изменения остаёмся на той же дате, а не перескакиваем на сегодня. */
async function sessionListFor(sessionId: string): Promise<Screen> {
  const session = await catalog.sessionById(sessionId)
  return sessionsScreen(session?.dayOffset ?? 0)
}

async function slotsFor(slotId: string): Promise<Screen> {
  return slotsScreen((await catalog.slotDayOffset(slotId)) ?? 0)
}

async function dayForBooking(bookingId: string): Promise<Screen> {
  return dayScreen((await bookingDayOffset(bookingId)) ?? 0)
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
