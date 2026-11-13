import { audit, clubDate, getDb, money, type Result } from './db.js'
import { appButton } from './app-url.js'
import type { InlineButton } from './telegram.js'
import type { Screen } from './screens.js'

/**
 * Пользовательская часть бота. Здесь только чтение каталога/своих записей и
 * отмена своей будущей записи. Управление клубом остаётся в админских экранах;
 * webhook дополнительно проверяет роль на каждом сообщении и callback.
 */

const BOOKING_LIMIT = 12
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function homeRows(adminPreview: boolean): InlineButton[][] {
  return [
    [{ text: '‹ Меню', callback_data: 'u:home' }],
    ...(adminPreview ? [[{ text: '‹ Панель администратора', callback_data: 'u:admin' }]] : []),
  ]
}

export function userHomeScreen(firstName?: string, notice?: string, adminPreview = false): Screen {
  const name = firstName?.trim()
  const lines = [
    '<b>ДТ · Теннисный клуб</b>',
    '',
    `Здравствуйте${name ? `, ${escapeHtml(name)}` : ''}!`,
    'Здесь можно посмотреть расписание и свои записи, а записаться на занятие, арендовать корт и заказать товары — в приложении.',
  ]
  if (notice) lines.push('', `<i>${escapeHtml(notice)}</i>`)

  return {
    text: lines.join('\n'),
    keyboard: {
      inline_keyboard: [
        [appButton('🎾 Открыть приложение')],
        [
          { text: '📅 Мои записи', callback_data: 'u:me' },
          { text: '🛍 Мои заказы', callback_data: 'u:orders' },
        ],
        [
          { text: '🕘 Расписание', callback_data: 'u:schedule:0' },
          { text: 'ℹ️ О клубе', callback_data: 'u:about' },
        ],
        [{ text: '❓ Помощь', callback_data: 'u:help' }],
        ...(adminPreview ? [[{ text: '‹ Панель администратора', callback_data: 'u:admin' }]] : []),
      ],
    },
  }
}

export function userHelpScreen(adminPreview = false): Screen {
  return {
    text: [
      '<b>Помощь</b>',
      '',
      '/start — главное меню',
      '/me — мои активные записи',
      '/orders — мои заказы',
      '/schedule — расписание занятий по дням',
      '/help — эта справка',
      '',
      'Запись, аренда корта и магазин — в приложении. Свою будущую запись можно отменить здесь, в разделе «Мои записи».',
    ].join('\n'),
    keyboard: {
      inline_keyboard: [
        [appButton('🎾 Открыть приложение')],
        [{ text: '📅 Мои записи', callback_data: 'u:me' }],
        ...homeRows(adminPreview),
      ],
    },
  }
}

export function userAboutScreen(adminPreview = false): Screen {
  return {
    text: [
      '<b>О клубе</b>',
      '',
      'ДТ — теннисный клуб. Занятия, свободная игра и магазин доступны в приложении.',
      'Там же можно посмотреть расписание, свободные окна и цены.',
    ].join('\n'),
    keyboard: {
      inline_keyboard: [
        [appButton('🎾 Открыть приложение')],
        ...homeRows(adminPreview),
      ],
    },
  }
}

type ScheduleRow = {
  title: string
  start: string
  durationMin: number
  price: number
  free: number
  coach: string | null
  court: string | null
}

export async function userScheduleScreen(offset: number, adminPreview = false): Promise<Screen> {
  const day = Number.isFinite(offset) ? Math.max(0, Math.min(Math.trunc(offset), 29)) : 0
  // Как и в каталоге приложения: день определяется starts_at, отображается start_time.
  const sql = getDb()
  const rows = (await sql`
    select s.title, s.start_time as start, s.duration_min as "durationMin", s.price,
           greatest(s.seats_total - s.seats_taken, 0)::int as free,
           c.name as coach, k.name as court
    from training_sessions s
    left join coaches c on c.id = s.coach_id
    left join courts k on k.id = s.court_id
    where s.is_active
      and s.starts_at > now()
      and (s.starts_at at time zone 'Europe/Moscow')::date =
          (now() at time zone 'Europe/Moscow')::date + ${day}::int
    order by s.starts_at
    limit 12
  `) as unknown as ScheduleRow[]

  const lines = rows.map((row) => {
    const free = Number(row.free)
    const mark = free === 0 ? '🔴' : free <= 1 ? '🟡' : '🟢'
    const places = free === 0 ? 'мест нет' : `свободно мест: ${free}`
    const details = [places, `${row.durationMin} мин`, row.coach, row.court, money(row.price)]
      .filter((item): item is string => Boolean(item))
      .map(escapeHtml)
    return [
      `${mark} <b>${escapeHtml(row.start)}</b> · ${escapeHtml(row.title)}`,
      `    ${details.join(' · ')}`,
    ].join('\n')
  })

  return {
    text: [
      `<b>Расписание · ${clubDate(day)}</b>`,
      '',
      ...(lines.length > 0 ? lines : ['На этот день занятий нет.']),
      ...(rows.length === 12 ? ['', 'Показано до 12 занятий. Полное расписание — в приложении.'] : []),
    ].join('\n'),
    keyboard: {
      inline_keyboard: [
        [
          { text: '‹', callback_data: `u:schedule:${Math.max(day - 1, 0)}` },
          { text: 'Обновить', callback_data: `u:schedule:${day}` },
          { text: '›', callback_data: `u:schedule:${Math.min(day + 1, 29)}` },
        ],
        [appButton('🎾 Записаться')],
        [
          { text: '📅 Мои записи', callback_data: 'u:me' },
          { text: '‹ Меню', callback_data: 'u:home' },
        ],
        ...(adminPreview ? [[{ text: '‹ Панель администратора', callback_data: 'u:admin' }]] : []),
      ],
    },
  }
}

type OrderRow = {
  title: string
  quantity: number
  price: number
  status: string
  created: string
}

export async function userOrdersScreen(telegramId: number, adminPreview = false): Promise<Screen> {
  const sql = getDb()
  const rows = (await sql`
    select p.title, o.quantity, o.price, o.status,
           to_char(o.created_at at time zone 'Europe/Moscow', 'DD.MM.YYYY') as created
    from orders o
    join users u on u.id = o.user_id
    join products p on p.id = o.product_id
    where u.telegram_id = ${telegramId}
    order by o.created_at desc
    limit 10
  `) as unknown as OrderRow[]
  const statuses: Record<string, string> = {
    reserved: 'в резерве',
    paid: 'оплачен',
    issued: 'выдан',
    cancelled: 'отменён',
  }
  const lines = rows.map((row) =>
    `• <b>${escapeHtml(row.title)}</b> · ${row.quantity} шт. · ${money(row.price)}\n` +
    `    ${escapeHtml(statuses[row.status] ?? 'статус уточняется')} · ${escapeHtml(row.created)}`,
  )
  return {
    text: ['<b>Ваши заказы</b>', '', ...(lines.length ? lines : ['Заказов пока нет.']), ...(rows.length === 10 ? ['', 'Показаны последние 10 заказов.'] : [])].join('\n'),
    keyboard: {
      inline_keyboard: [
        [appButton('🎾 Открыть приложение')],
        [{ text: 'Обновить', callback_data: 'u:orders' }, { text: '‹ Меню', callback_data: 'u:home' }],
        ...(adminPreview ? [[{ text: '‹ Панель администратора', callback_data: 'u:admin' }]] : []),
      ],
    },
  }
}

type BookingRow = {
  id: string
  kind: string
  title: string
  price: number
  start: string
  canCancel: boolean
}

export async function userBookingsScreen(
  telegramId: number,
  adminPreview = false,
  notice?: string,
): Promise<Screen> {
  const sql = getDb()
  const rows = (await sql`
    select b.id, b.kind, b.title, b.price,
           to_char(b.starts_at at time zone 'Europe/Moscow', 'DD.MM') || ', ' || b.start_time as start,
           (b.starts_at > now()) as "canCancel"
    from bookings b
    join users u on u.id = b.user_id
    where u.telegram_id = ${telegramId}
      and b.status = 'active'
      and b.starts_at + b.duration_min * interval '1 minute' > now()
    order by b.starts_at
    limit ${BOOKING_LIMIT}
  `) as unknown as BookingRow[]

  const lines = rows.map((row, index) => {
    const kind = row.kind === 'free' ? 'Аренда корта' : 'Занятие'
    return [
      `${index + 1}. <b>${escapeHtml(row.start)}</b> · ${escapeHtml(row.title)}`,
      `    ${kind} · ${money(row.price)}${row.canCancel ? '' : ' · уже началось'}`,
    ].join('\n')
  })
  const text = [
    '<b>Ваши записи</b>',
    '',
    ...(notice ? [`<i>${escapeHtml(notice)}</i>`, ''] : []),
    ...(lines.length > 0 ? [...lines, '', 'Показаны ближайшие записи. Все записи — в приложении.'] : ['Ближайших активных записей нет.']),
  ].join('\n')

  return {
    text,
    keyboard: {
      inline_keyboard: [
        ...rows.filter((row) => row.canCancel).map((row) => [
          { text: `✖ Отменить · ${row.start}`, callback_data: `u:cancelask:${row.id}` },
        ]),
        [appButton('🎾 Записаться ещё')],
        [
          { text: 'Обновить', callback_data: 'u:me' },
          { text: '‹ Меню', callback_data: 'u:home' },
        ],
        ...(adminPreview ? [[{ text: '‹ Панель администратора', callback_data: 'u:admin' }]] : []),
      ],
    },
  }
}

export async function userCancelScreen(
  bookingId: string,
  telegramId: number,
  adminPreview = false,
): Promise<Screen> {
  if (!UUID.test(bookingId)) {
    return userBookingsScreen(telegramId, adminPreview, 'Запись уже недоступна для отмены.')
  }
  const sql = getDb()
  const rows = (await sql`
    select b.title, to_char(b.starts_at at time zone 'Europe/Moscow', 'DD.MM') || ', ' || b.start_time as start
    from bookings b
    join users u on u.id = b.user_id
    where b.id = ${bookingId}
      and u.telegram_id = ${telegramId}
      and b.status = 'active'
      and b.starts_at > now()
  `) as unknown as { title: string; start: string }[]

  const row = rows[0]
  if (!row) {
    return userBookingsScreen(telegramId, adminPreview, 'Запись уже недоступна для отмены.')
  }

  return {
    text: [
      '<b>Отменить запись?</b>',
      '',
      `${escapeHtml(row.start)} · ${escapeHtml(row.title)}`,
      '',
      'Место или окно аренды вернётся в продажу. При аренде нескольких окон каждое отменяется отдельно.',
    ].join('\n'),
    keyboard: {
      inline_keyboard: [
        [{ text: '✅ Да, отменить', callback_data: `u:cancel:${bookingId}` }],
        [{ text: '‹ Мои записи', callback_data: 'u:me' }],
        ...(adminPreview ? [[{ text: '‹ Панель администратора', callback_data: 'u:admin' }]] : []),
      ],
    },
  }
}

/** Владелец, отмена и возврат места проверяются/применяются одной SQL-командой. */
export async function cancelOwnBooking(bookingId: string, telegramId: number): Promise<Result> {
  if (!UUID.test(bookingId)) return { ok: false, message: 'Запись не найдена или уже отменена' }
  const sql = getDb()
  const cancelled = (await sql`
    with cancelled as (
      update bookings b set status = 'cancelled', cancelled_at = now()
      from users u
      where b.id = ${bookingId}::uuid
        and b.user_id = u.id
        and u.telegram_id = ${telegramId}
        and b.status = 'active'
        and b.starts_at > now()
      returning b.id, b.kind, b.source_id
    ), released_slot as (
      update free_slots f set is_active = true from cancelled c
      where c.kind = 'free' and f.id = c.source_id
        and not exists (select 1 from bookings b where b.kind = 'free' and b.source_id = f.id and b.status = 'active' and b.id <> c.id)
      returning f.id
    ), released_seat as (
      update training_sessions s set seats_taken = greatest(s.seats_taken - 1, 0) from cancelled c
      where c.kind = 'training' and s.id = c.source_id returning s.id
    ) select kind, source_id as "sourceId" from cancelled
  `) as unknown as { kind: string; sourceId: string }[]

  const row = cancelled[0]
  if (!row) return { ok: false, message: 'Запись не найдена или уже отменена' }

  try {
    await audit(telegramId, 'booking.self_cancel', { bookingId, kind: row.kind })
  } catch (error) {
    // Отмена уже применена; отсутствие журнала не должно показывать игроку ошибку.
    console.warn('[bot] self-cancel audit skipped', error instanceof Error ? error.message : error)
  }
  console.info('[bot] booking.self_cancel', { bookingId, kind: row.kind })
  return { ok: true, message: 'Запись отменена' }
}
