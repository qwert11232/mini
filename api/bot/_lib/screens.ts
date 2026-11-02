import { getDb, money } from './db.js'
import type { Keyboard } from './telegram.js'

export type Screen = { text: string; keyboard: Keyboard }

type BookingRow = {
  id: string
  kind: string
  title: string
  price: number
  firstName: string
  username: string | null
  start: string
}

type SessionRow = {
  id: string
  title: string
  groupKind: string
  start: string
  dayOffset: number
  seatsTotal: number
  seatsTaken: number
  price: number
}

/** Главное меню админки. */
export async function menuScreen(): Promise<Screen> {
  const sql = getDb()
  const [stats] = (await sql`
    select
      (select count(*)::int from bookings where status = 'active' and starts_at::date = current_date) as today,
      (select count(*)::int from bookings where status = 'active' and starts_at >= now()) as upcoming,
      (select count(*)::int from orders where status = 'reserved') as orders,
      (select count(*)::int from users) as users
  `) as { today: number; upcoming: number; orders: number; users: number }[]

  const text = [
    '<b>ДТ · Панель клуба</b>',
    '',
    `Сегодня записей: <b>${stats?.today ?? 0}</b>`,
    `Предстоящих: <b>${stats?.upcoming ?? 0}</b>`,
    `Заказов к выдаче: <b>${stats?.orders ?? 0}</b>`,
    `Игроков в базе: <b>${stats?.users ?? 0}</b>`,
  ].join('\n')

  return {
    text,
    keyboard: {
      inline_keyboard: [
        [
          { text: '📅 Записи на сегодня', callback_data: 'day:0' },
          { text: '🗓 Завтра', callback_data: 'day:1' },
        ],
        [
          { text: '🕘 Расписание', callback_data: 'sessions:0' },
          { text: '🛍 Заказы', callback_data: 'orders' },
        ],
        [
          { text: '👥 Игроки', callback_data: 'users' },
          { text: '🌐 Открыть приложение', url: appUrl() },
        ],
      ],
    },
  }
}

/** Записи на день: offset 0 — сегодня, 1 — завтра. */
export async function dayScreen(offset: number): Promise<Screen> {
  const sql = getDb()
  const rows = (await sql`
    select b.id, b.kind, b.title, b.subtitle, b.price,
           to_char(b.starts_at at time zone 'Europe/Moscow', 'HH24:MI') as start,
           u.first_name as "firstName", u.username, u.telegram_id as "telegramId"
    from bookings b
    join users u on u.id = b.user_id
    where b.status = 'active'
      and b.starts_at::date = current_date + ${offset}
    order by b.starts_at
  `) as unknown as (BookingRow & { start: string })[]

  const label = offset === 0 ? 'Сегодня' : 'Завтра'
  const total = rows.reduce((sum, row) => sum + row.price, 0)

  if (rows.length === 0) {
    return {
      text: `<b>${label}</b>\n\nЗаписей нет.`,
      keyboard: navigation(offset),
    }
  }

  const lines = rows.map((row, index) => {
    const who = row.username ? `${row.firstName} (@${row.username})` : row.firstName
    const kind = row.kind === 'free' ? 'аренда' : 'занятие'
    return `${index + 1}. <b>${row.start}</b> · ${row.title}\n    ${kind} · ${who} · ${money(row.price)}`
  })

  const buttons = rows.slice(0, 10).map((row, index) => [
    { text: `✖ ${String(index + 1).padStart(2, '0')} · ${row.start} ${row.title.slice(0, 22)}`, callback_data: `cancel:${row.id}` },
  ])

  return {
    text: [`<b>${label}</b> · ${rows.length} записей на ${money(total)}`, '', ...lines].join('\n'),
    keyboard: { inline_keyboard: [...buttons, ...navigation(offset).inline_keyboard] },
  }
}

/** Расписание занятий с заполненностью. */
export async function sessionsScreen(offset: number): Promise<Screen> {
  const sql = getDb()
  const rows = (await sql`
    select id, title, group_kind as "groupKind", start_time as start,
           day_offset as "dayOffset", seats_total as "seatsTotal",
           seats_taken as "seatsTaken", price
    from training_sessions
    where is_active and day_offset = ${offset}
    order by start_time
  `) as unknown as SessionRow[]

  const label = offset === 0 ? 'Сегодня' : offset === 1 ? 'Завтра' : `Через ${offset} дн.`

  if (rows.length === 0) {
    return { text: `<b>Расписание · ${label}</b>\n\nЗанятий нет.`, keyboard: sessionNavigation(offset) }
  }

  const lines = rows.map((row) => {
    const free = row.seatsTotal - row.seatsTaken
    const mark = free === 0 ? '🔴' : free <= 1 ? '🟡' : '🟢'
    return `${mark} <b>${row.start}</b> ${row.title}\n    ${row.seatsTaken}/${row.seatsTotal} мест · ${money(row.price)}`
  })

  const buttons = rows.slice(0, 8).map((row) => [
    { text: `− место · ${row.start}`, callback_data: `seats:${row.id}` },
    { text: `+ место · ${row.start}`, callback_data: `seatplus:${row.id}` },
  ])

  return {
    text: [`<b>Расписание · ${label}</b>`, '', ...lines].join('\n'),
    keyboard: { inline_keyboard: [...buttons, ...sessionNavigation(offset).inline_keyboard] },
  }
}

export async function ordersScreen(): Promise<Screen> {
  const sql = getDb()
  const rows = (await sql`
    select o.id, o.price, o.quantity, p.title, u.first_name as "firstName", u.username,
           to_char(o.created_at at time zone 'Europe/Moscow', 'DD.MM HH24:MI') as created
    from orders o
    join users u on u.id = o.user_id
    join products p on p.id = o.product_id
    where o.status = 'reserved'
    order by o.created_at desc
    limit 20
  `) as unknown as { id: string; price: number; quantity: number; title: string; firstName: string; username: string | null; created: string }[]

  if (rows.length === 0) {
    return { text: '<b>Заказы к выдаче</b>\n\nНет активных резервов.', keyboard: backMenu() }
  }

  const lines = rows.map(
    (row) => `• ${row.title} ×${row.quantity} · ${money(row.price)}\n   ${row.firstName}${row.username ? ` (@${row.username})` : ''} · ${row.created}`,
  )

  return {
    text: [`<b>Заказы к выдаче</b> · ${rows.length}`, '', ...lines].join('\n'),
    keyboard: {
      inline_keyboard: [
        ...rows.slice(0, 6).map((row) => [
          { text: `✔ Выдать · ${row.title.slice(0, 24)}`, callback_data: `issued:${row.id}` },
        ]),
        [{ text: '‹ Меню', callback_data: 'menu' }],
      ],
    },
  }
}

export async function usersScreen(): Promise<Screen> {
  const sql = getDb()
  const rows = (await sql`
    select u.first_name as "firstName", u.username, u.telegram_id as "telegramId",
           count(b.id)::int as bookings,
           to_char(max(b.created_at) at time zone 'Europe/Moscow', 'DD.MM') as last
    from users u
    left join bookings b on b.user_id = u.id and b.status = 'active'
    group by u.id
    order by count(b.id) desc, u.created_at desc
    limit 20
  `) as unknown as { firstName: string; username: string | null; telegramId: number; bookings: number; last: string | null }[]

  if (rows.length === 0) {
    return { text: '<b>Игроки</b>\n\nПока никто не заходил.', keyboard: backMenu() }
  }

  const lines = rows.map((row, index) => {
    const who = row.username ? `${row.firstName} (@${row.username})` : row.firstName
    return `${index + 1}. ${who} — ${row.bookings} записей${row.last ? `, последняя ${row.last}` : ''}`
  })

  return {
    text: [`<b>Игроки</b> · ${rows.length}`, '', ...lines].join('\n'),
    keyboard: backMenu(),
  }
}

export function navigation(offset: number): Keyboard {
  return {
    inline_keyboard: [
      [
        { text: '‹ Вчера', callback_data: `day:${Math.max(offset - 1, 0)}` },
        { text: 'Обновить', callback_data: `day:${offset}` },
        { text: 'Завтра ›', callback_data: `day:${offset + 1}` },
      ],
      [
        { text: '🕘 Расписание', callback_data: 'sessions:0' },
        { text: '‹ Меню', callback_data: 'menu' },
      ],
    ],
  }
}

export function sessionNavigation(offset: number): Keyboard {
  return {
    inline_keyboard: [
      [
        { text: '‹', callback_data: `sessions:${Math.max(offset - 1, 0)}` },
        { text: 'Обновить', callback_data: `sessions:${offset}` },
        { text: '›', callback_data: `sessions:${offset + 1}` },
      ],
      [{ text: '‹ Меню', callback_data: 'menu' }],
    ],
  }
}

export function backMenu(): Keyboard {
  return { inline_keyboard: [[{ text: '‹ Меню', callback_data: 'menu' }]] }
}

export function appUrl(): string {
  return process.env.VITE_APP_URL ?? 'https://mini-seven-xi.vercel.app'
}
