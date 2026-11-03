import { getDb, money } from './db.js'
import { ensureCustomerSchema, formatClientNo } from '../../_lib/customers.js'
import * as catalog from './catalog-admin.js'
import type { Keyboard } from './telegram.js'
import {
  auditLine,
  auditLog,
  courtLoad,
  places,
  productLine,
  products,
  sessionDate,
  summary,
  players,
  type PlayerRow,
} from './admin.js'

export type Screen = { text: string; keyboard: Keyboard }

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function appUrl(): string {
  return process.env.VITE_APP_URL ?? 'https://mini-seven-xi.vercel.app'
}

function backMenu(): Keyboard {
  return { inline_keyboard: [[{ text: '‹ Меню', callback_data: 'menu' }]] }
}

// ─── Главное меню ───────────────────────────────────────────────────────────

export async function menuScreen(): Promise<Screen> {
  const stats = await summary()
  const recent = await auditLog(3)

  const text = [
    '<b>ДТ · Панель клуба</b>',
    '',
    `Сегодня: <b>${stats.todayBookings}</b> записей на <b>${money(stats.todayRevenue)}</b>`,
    `Предстоящих: <b>${stats.upcoming}</b> · заказов к выдаче: <b>${stats.orders}</b>`,
    `Игроков в базе: <b>${stats.users}</b> · свободных окон: <b>${stats.freeSlots}</b>`,
    ...(recent[0] ? ['', `<i>${auditLine(recent[0])}</i>`] : []),
  ].join('\n')

  return {
    text,
    keyboard: {
      inline_keyboard: [
        [
          { text: '📅 Сегодня', callback_data: 'day:0' },
          { text: '🗓 Завтра', callback_data: 'day:1' },
        ],
        [
          { text: '🕘 Расписание', callback_data: 'sessions:0' },
          { text: '🎾 Свободная игра', callback_data: 'slots:0' },
        ],
        [
          { text: '🛍 Заказы', callback_data: 'orders' },
          { text: '👥 Игроки', callback_data: 'users' },
        ],
        [
          { text: '🏟 Корты', callback_data: 'courts' },
          { text: '📦 Товары', callback_data: 'products' },
        ],
        [
          { text: '🧾 Журнал действий', callback_data: 'audit' },
          { text: '🌐 Приложение', url: appUrl() },
        ],
      ],
    },
  }
}

// ─── Записи на день ─────────────────────────────────────────────────────────

type DayRow = {
  id: string
  kind: string
  title: string
  price: number
  start: string
  firstName: string | null
  username: string | null
  clientNo: number | null
  phone: string | null
  sourceId: string
}

export async function dayScreen(offset: number): Promise<Screen> {
  await ensureCustomerSchema()
  const sql = getDb()
  const rows = (await sql`
    select b.id, b.kind, b.title, b.price, b.source_id as "sourceId",
           to_char(b.starts_at at time zone 'Europe/Moscow', 'HH24:MI') as start,
           u.first_name as "firstName", u.username, u.client_no as "clientNo", u.phone
    from bookings b
    left join users u on u.id = b.user_id
    where b.status = 'active' and b.starts_at::date = current_date + ${offset}::int
    order by b.starts_at
  `) as unknown as DayRow[]

  const label = offset === 0 ? 'Сегодня' : offset === 1 ? 'Завтра' : sessionDate(offset)
  const total = rows.reduce((sum, row) => sum + row.price, 0)

  if (rows.length === 0) {
    return {
      text: [`<b>${label}</b> · ${sessionDate(offset)}`, '', 'Записей нет.'].join('\n'),
      keyboard: navigation(offset),
    }
  }

  const lines = rows.map((row, index) => {
    const who = row.firstName
      ? row.username
        ? `${escapeHtml(row.firstName)} (@${row.username})`
        : escapeHtml(row.firstName)
      : 'ресепшен'
    const kind = row.kind === 'free' ? 'аренда' : 'занятие'
    const phone = row.phone ? ` · <a href="tel:${row.phone}">${row.phone}</a>` : ''
    return `${index + 1}. <b>${row.start}</b> · ${escapeHtml(row.title)}\n    ${kind} · ${who} · ${formatClientNo(row.clientNo)}${phone} · ${money(row.price)}`
  })

  const buttons = rows.slice(0, 8).flatMap((row, index) => {
    const number = String(index + 1).padStart(2, '0')
    return [
      [
        { text: `✔ ${number} посещено`, callback_data: `visited:${row.id}` },
        { text: `✖ ${number} отменить`, callback_data: `cancel:${row.id}` },
      ],
    ]
  })

  return {
    text: [`<b>${label}</b> · ${sessionDate(offset)} · ${rows.length} на ${money(total)}`, '', ...lines].join('\n'),
    keyboard: { inline_keyboard: [...buttons, ...navigation(offset).inline_keyboard] },
  }
}

function navigation(offset: number): Keyboard {
  return {
    inline_keyboard: [
      [
        { text: '‹', callback_data: `day:${Math.max(offset - 1, 0)}` },
        { text: 'Обновить', callback_data: `day:${offset}` },
        { text: '›', callback_data: `day:${offset + 1}` },
      ],
      [
        { text: '🕘 Расписание', callback_data: 'sessions:0' },
        { text: '‹ Меню', callback_data: 'menu' },
      ],
    ],
  }
}

// ─── Расписание ─────────────────────────────────────────────────────────────

type SessionRow = {
  id: string
  title: string
  start: string
  dayOffset: number
  seatsTotal: number
  seatsTaken: number
  price: number
  coach: string
  court: string
  active: boolean
}

export async function sessionsScreen(offset: number): Promise<Screen> {
  const sql = getDb()
  const rows = (await sql`
    select s.id, s.title, s.start_time as start, s.day_offset as "dayOffset",
           s.seats_total as "seatsTotal", s.seats_taken as "seatsTaken", s.price,
           c.name as coach, k.name as court, s.is_active as active
    from training_sessions s
    left join coaches c on c.id = s.coach_id
    left join courts k on k.id = s.court_id
    where s.day_offset = ${offset}
    order by s.start_time
  `) as unknown as SessionRow[]

  const label = offset === 0 ? 'сегодня' : offset === 1 ? 'завтра' : sessionDate(offset)
  if (rows.length === 0) {
    return {
      text: [`<b>Расписание · ${label}</b>`, '', 'Занятий нет.'].join('\n'),
      keyboard: sessionNavigation(offset),
    }
  }

  const lines = rows.map((row) => {
    const free = row.seatsTotal - row.seatsTaken
    const mark = !row.active ? '⚪️' : free === 0 ? '🔴' : free <= 1 ? '🟡' : '🟢'
    return `${mark} <b>${row.start}</b> ${escapeHtml(row.title)}\n    ${row.seatsTaken}/${row.seatsTotal} мест · ${escapeHtml(row.court ?? '')} · ${escapeHtml(row.coach ?? '')} · ${money(row.price)}`
  })

  const buttons = rows.slice(0, 6).map((row) => [
    { text: `+1 место · ${row.start}`, callback_data: `seatplus:${row.id}` },
    { text: `−1 место · ${row.start}`, callback_data: `seats:${row.id}` },
    { text: `✏️ ${row.start}`, callback_data: `sescard:${row.id}` },
  ])

  return {
    text: [`<b>Расписание · ${label}</b> · ${sessionDate(offset)}`, '', ...lines].join('\n'),
    keyboard: { inline_keyboard: [...buttons, ...sessionNavigation(offset).inline_keyboard] },
  }
}

function sessionNavigation(offset: number): Keyboard {
  return {
    inline_keyboard: [
      [
        { text: '‹', callback_data: `sessions:${Math.max(offset - 1, 0)}` },
        { text: 'Обновить', callback_data: `sessions:${offset}` },
        { text: '›', callback_data: `sessions:${offset + 1}` },
      ],
      [{ text: '＋ Добавить занятие', callback_data: 'sesnue' }],
      [
        { text: '🎾 Свободная игра', callback_data: 'slots:0' },
        { text: '‹ Меню', callback_data: 'menu' },
      ],
    ],
  }
}

// ─── Свободная игра ─────────────────────────────────────────────────────────

type SlotRow = {
  id: string
  court: string
  surface: string
  dayOffset: number
  start: string
  price: number
  active: boolean
}

export async function slotsScreen(offset: number): Promise<Screen> {
  const sql = getDb()
  const rows = (await sql`
    select f.id, f.day_offset as "dayOffset", f.start_time as start, f.price, f.is_active as active,
           c.name as court, c.surface
    from free_slots f
    left join courts c on c.id = f.court_id
    where f.day_offset = ${offset}
    order by f.start_time, c.sort_order
  `) as unknown as SlotRow[]

  const label = offset === 0 ? 'сегодня' : offset === 1 ? 'завтра' : sessionDate(offset)
  const open = rows.filter((row) => row.active)
  const taken = rows.filter((row) => !row.active)

  const lines = [
    ...open.map((row) => `🟢 <b>${row.start}</b> ${escapeHtml(row.court ?? '')} · ${escapeHtml(row.surface ?? '')} · ${money(row.price)}`),
    ...taken.map((row) => `🔴 <b>${row.start}</b> ${escapeHtml(row.court ?? '')} · занято`),
  ]

  const buttons = open.slice(0, 8).flatMap((row) => [
    [
      { text: `🔒 Закрыть ${row.start} · ${row.court ?? ''}`, callback_data: `slotclose:${row.id}` },
    ],
  ])
  const restore = taken.slice(0, 4).map((row) => [
    { text: `🔓 Вернуть ${row.start} · ${row.court ?? ''}`, callback_data: `slotopen:${row.id}` },
  ])

  return {
    text: [
      `<b>Свободная игра · ${label}</b> · ${sessionDate(offset)}`,
      '',
      `Открыто: <b>${open.length}</b> · занято: <b>${taken.length}</b>`,
      '',
      ...(lines.length > 0 ? lines : ['Окон нет.']),
    ].join('\n'),
    keyboard: {
      inline_keyboard: [
        [{ text: '＋ Добавить окно', callback_data: 'slotnue' }],
        ...buttons,
        ...restore,
        [
          { text: '‹', callback_data: `slots:${Math.max(offset - 1, 0)}` },
          { text: 'Обновить', callback_data: `slots:${offset}` },
          { text: '›', callback_data: `slots:${offset + 1}` },
        ],
        [{ text: '‹ Меню', callback_data: 'menu' }],
      ],
    },
  }
}

// ─── Заказы ─────────────────────────────────────────────────────────────────

export async function ordersScreen(): Promise<Screen> {
  await ensureCustomerSchema()
  const sql = getDb()
  const rows = (await sql`
    select o.id, o.price, o.quantity, p.title, u.first_name as "firstName", u.username,
           u.client_no as "clientNo", u.phone,
           o.contact_name as "contactName", o.contact_phone as "contactPhone",
           to_char(o.created_at at time zone 'Europe/Moscow', 'DD.MM HH24:MI') as created
    from orders o
    join users u on u.id = o.user_id
    join products p on p.id = o.product_id
    where o.status = 'reserved'
    order by o.created_at desc
    limit 20
  `) as unknown as {
    id: string
    price: number
    quantity: number
    title: string
    firstName: string
    username: string | null
    clientNo: number | null
    phone: string | null
    contactName: string | null
    contactPhone: string | null
    created: string
  }[]

  const [handed] = (await sql`
    select count(*)::int as count,
           coalesce(sum(price), 0)::int as revenue
    from orders
    where status in ('paid', 'issued')
      and created_at::date = current_date
  `) as unknown as { count: number; revenue: number }[]

  const header = `<b>Заказы</b>\n\nВыдано сегодня: <b>${handed?.count ?? 0}</b> на <b>${money(handed?.revenue ?? 0)}</b>`

  if (rows.length === 0) {
    return { text: `${header}\n\nК выдаче ничего нет.`, keyboard: backMenu() }
  }

  const lines = rows.map((row) => {
    const name = row.contactName || row.firstName
    const phone = row.contactPhone || row.phone
    const phoneLine = phone
      ? `📞 <a href="tel:${phone}">${phone}</a>`
      : '📞 телефон не указан'
    return `• ${escapeHtml(row.title)} ×${row.quantity} · ${money(row.price)}\n   ${formatClientNo(row.clientNo)} · ${escapeHtml(name)}${row.username ? ` (@${row.username})` : ''}\n   ${phoneLine} · ${row.created}`
  })

  return {
    text: [header, '', ...lines].join('\n'),
    keyboard: {
      inline_keyboard: [
        ...rows.slice(0, 8).map((row) => [
          { text: `✔ Выдать · ${row.title.slice(0, 24)}`, callback_data: `issued:${row.id}` },
        ]),
        [{ text: '‹ Меню', callback_data: 'menu' }],
      ],
    },
  }
}

// ─── Игроки ─────────────────────────────────────────────────────────────────

export async function usersScreen(): Promise<Screen> {
  const rows = await players(12)

  if (rows.length === 0) {
    return { text: '<b>Игроки</b>\n\nПока никто не заходил.', keyboard: backMenu() }
  }

  const lines = rows.map((row, index) => {
    const who = row.username ? `${escapeHtml(row.first_name)} (@${row.username})` : escapeHtml(row.first_name)
    const badges = [
      row.role === 'admin' ? 'админ' : row.role === 'coach' ? 'тренер' : null,
      row.cancelled > 0 ? `${row.cancelled} отмен` : null,
    ].filter(Boolean)
    const tail = badges.length > 0 ? ` · ${badges.join(' · ')}` : ''
    const phone = row.phone ? `\n    📞 <a href="tel:${row.phone}">${row.phone}</a>` : ''
    return `${index + 1}. ${who} · ${formatClientNo(row.clientNo)}${tail}\n    заходил ${row.lastSeen ?? '—'}${phone}`
  })

  const buttons = rows.slice(0, 6).map((row) => [
    { text: `📝 ${row.first_name.slice(0, 16)}`, callback_data: `note:${row.id}` },
    { text: `🎭 ${row.first_name.slice(0, 12)}`, callback_data: `role:${row.id}` },
  ])

  return {
    text: [`<b>Игроки</b> · ${rows.length}`, '', ...lines].join('\n'),
    keyboard: { inline_keyboard: [...buttons, ...backMenu().inline_keyboard] },
  }
}

export function playerCard(row: PlayerRow): Screen {
  const who = row.username ? `${escapeHtml(row.first_name)} (@${row.username})` : escapeHtml(row.first_name)
  return {
    text: [
      `<b>${who}</b>`,
      '',
      `Клиент: <b>${formatClientNo(row.clientNo)}</b>`,
      `Роль: ${row.role === 'admin' ? 'администратор' : row.role === 'coach' ? 'тренер' : 'игрок'}`,
      row.phone ? `Телефон: <a href="tel:${row.phone}">${row.phone}</a>` : 'Телефон: не указан',
      `В базе с ${row.created} · заходил ${row.lastSeen ?? '—'}`,
      `Отменённых записей: ${row.cancelled}`,
    ].join('\n'),
    keyboard: {
      inline_keyboard: [
        [
          { text: '📝 Заметка', callback_data: `note:${row.id}` },
          { text: '🎭 Роль', callback_data: `role:${row.id}` },
        ],
        [{ text: '‹ Игроки', callback_data: 'users' }],
      ],
    },
  }
}

// ─── Корты ──────────────────────────────────────────────────────────────────

export async function courtsScreen(): Promise<Screen> {
  const rows = await courtLoad()
  if (rows.length === 0) {
    return { text: '<b>Корты</b>\n\nКортов нет — запустите /api/admin/setup.', keyboard: backMenu() }
  }

  const lines = rows.map(
    (row) => `• <b>${escapeHtml(row.court)}</b> · ${escapeHtml(row.surface)}\n    занято на неделе: ${row.booked} · свободно окон: ${row.open}`,
  )

  return {
    text: ['<b>Корты · загрузка на 7 дней</b>', '', ...lines].join('\n'),
    keyboard: { inline_keyboard: [[{ text: '🎾 Свободная игра', callback_data: 'slots:0' }], ...backMenu().inline_keyboard] },
  }
}

// ─── Товары ─────────────────────────────────────────────────────────────────

export async function productsScreen(): Promise<Screen> {
  const rows = await products()
  if (rows.length === 0) {
    return { text: '<b>Товары</b>\n\nКаталог пуст.', keyboard: backMenu() }
  }

  const active = rows.filter((row) => row.is_active).length
  return {
    text: [
      '<b>Витрина магазина</b>',
      '',
      `В продаже: <b>${active}</b> из ${rows.length}. Скрытые товары не показываются в приложении.`,
      '',
      ...rows.map(productLine),
    ].join('\n'),
    keyboard: {
      inline_keyboard: [
        ...rows.slice(0, 8).map((row) => [
          {
            text: `${row.is_active ? '⚪️ Скрыть' : '🟢 Вернуть'} · ${row.title.slice(0, 22)}`,
            callback_data: `prodtoggle:${row.id}`,
          },
        ]),
        [{ text: '‹ Меню', callback_data: 'menu' }],
      ],
    },
  }
}

// ─── Журнал ─────────────────────────────────────────────────────────────────

export async function auditScreen(): Promise<Screen> {
  const rows = await auditLog(12)
  if (rows.length === 0) {
    return { text: '<b>Журнал действий</b>\n\nПока пусто.', keyboard: backMenu() }
  }
  return {
    text: ['<b>Журнал действий</b>', '', ...rows.map((row) => `• ${auditLine(row)}`)].join('\n'),
    keyboard: backMenu(),
  }
}

// ─── Служебные ──────────────────────────────────────────────────────────────

export async function helpScreen(): Promise<Screen> {
  const sql = getDb()
  const [counts] = (await sql`
    select
      (select count(*)::int from courts) as courts,
      (select count(*)::int from bookings) as bookings,
      (select count(*)::int from admin_audit) as audit
  `) as unknown as { courts: number; bookings: number; audit: number }[]

  return {
    text: [
      '<b>Как пользоваться панелью</b>',
      '',
      '📅 <b>Сегодня / Завтра</b> — записи дня. У каждой две кнопки: отметить посещение или отменить (место вернётся в продажу).',
      '🕘 <b>Расписание</b> — занятия по дням. «＋ Добавить занятие»: название, время, цена, места, формат, тренер, корт и повтор на несколько дней. По кнопке ✏️ у занятия — цена, время, места, снятие с продажи и удаление.',
      '🎾 <b>Свободная игра</b> — окна аренды: «＋ Добавить окно» создаёт окна на неделю вперёд; окно можно закрыть под телефонную бронь или удалить.',
      '🛍 <b>Заказы</b> — резервы из магазина: «Выдать» закрывает заказ и уведомляет покупателя.',
      '👥 <b>Игроки</b> — заметка о клиенте и роль (игрок / тренер / админ).',
      '🏟 <b>Корты</b> — загрузка на неделю.',
      '📦 <b>Товары</b> — вся витрина: «＋ Новый товар» (название, цена, категория, описание, фото) и правка любого товара. Фото присылается картинкой прямо в чат. Всё, что вы меняете, сразу видно на сайте.',
      '🧾 <b>Журнал</b> — кто и что менял.',
      '',
      'У каждой карточки внизу есть «‹ Меню».',
      '',
      `<i>В базе: кортов ${counts?.courts ?? 0}, записей ${counts?.bookings ?? 0}, действий ${counts?.audit ?? 0}.</i>`,
    ].join('\n'),
    keyboard: backMenu(),
  }
}

export async function dbErrorScreen(reason: string): Promise<Screen> {
  return {
    text: [
      '<b>Панель временно недоступна</b>',
      '',
      `Причина: ${escapeHtml(reason)}`,
      '',
      'Проверка связки: /api/health?diag=1',
    ].join('\n'),
    keyboard: {
      inline_keyboard: [
        [{ text: '🔧 Починить схему', callback_data: 'repair' }],
        [{ text: '🌐 Проверка /api/health', url: `${appUrl()}/api/health?diag=1` }],
      ],
    },
  }
}

export async function priceHint(sessionId: string): Promise<Screen> {
  const sql = getDb()
  const [row] = (await sql`
    select title, price, start_time as start from training_sessions where id = ${sessionId}
  `) as unknown as { title: string; price: number; start: string }[]
  if (!row) return { text: 'Занятие не найдено.', keyboard: backMenu() }
  return {
    text: [
      `<b>${escapeHtml(row.title)}</b> · ${row.start}`,
      '',
      `Текущая цена: <b>${money(row.price)}</b>`,
      '',
      'Изменить цену: пришлите число в чат — например, <code>1600</code>. Отмена — «‹ Меню».',
    ].join('\n'),
    keyboard: { inline_keyboard: [[{ text: '‹ Расписание', callback_data: 'sessions:0' }]] },
  }
}

export { places }

// ─── Управление витриной: товары ────────────────────────────────────────────

export type ProductDraft = {
  title?: string
  subtitle?: string
  category?: string
  price?: number
  photoRequested?: boolean
}

export async function productListScreen(): Promise<Screen> {
  const rows = await catalog.products()
  if (rows.length === 0) {
    return {
      text: '<b>Товары</b>\n\nКаталог пуст — добавьте первый товар.',
      keyboard: { inline_keyboard: [[{ text: '＋ Новый товар', callback_data: 'prodnue' }], ...backMenu().inline_keyboard] },
    }
  }

  const active = rows.filter((row) => row.isActive).length
  return {
    text: [
      '<b>Витрина магазина</b>',
      '',
      `На сайте: <b>${active}</b> из ${rows.length}`,
      '📷 — у товара есть фото. Нажмите на товар, чтобы изменить.',
      '',
      ...rows.map(catalog.productTitle),
    ].join('\n'),
    keyboard: {
      inline_keyboard: [
        ...rows.slice(0, 8).map((row) => [
          { text: `${row.isActive ? '🟢' : '⚪️'} ${row.title.slice(0, 26)}`, callback_data: `prodedit:${row.id}` },
        ]),
        [{ text: '＋ Новый товар', callback_data: 'prodnue' }],
        ...backMenu().inline_keyboard,
      ],
    },
  }
}

export async function productCardScreen(id: string): Promise<Screen> {
  const item = await catalog.product(id)
  if (!item) return { text: 'Товар не найден.', keyboard: backMenu() }

  return {
    text: [
      `<b>${escapeHtml(item.title)}</b>`,
      '',
      `Категория: ${escapeHtml(item.category)}`,
      `Цена: <b>${money(item.price)}</b>${item.oldPrice ? ` (было ${money(item.oldPrice)})` : ''}`,
      item.subtitle ? `Описание: ${escapeHtml(item.subtitle)}` : 'Описание: —',
      `Фото: ${item.image ? 'есть' : 'нет'} · На сайте: ${item.isActive ? 'да' : 'скрыт'}`,
      '',
      'Меняйте кнопками ниже. Фото — просто отправьте картинку в этот чат.',
    ].join('\n'),
    keyboard: {
      inline_keyboard: [
        [
          { text: '💰 Цена', callback_data: `prodprice:${item.id}` },
          { text: '🏷 Категория', callback_data: `prodcat:${item.id}` },
        ],
        [
          { text: '✏️ Название', callback_data: `prodtitle:${item.id}` },
          { text: '📝 Описание', callback_data: `prodsub:${item.id}` },
        ],
        [
          { text: '📷 Фото', callback_data: `prodphoto:${item.id}` },
          { text: item.isActive ? '⚪️ Скрыть' : '🟢 Показать', callback_data: `prodtoggle:${item.id}` },
        ],
        [{ text: '🗑 Удалить', callback_data: `proddel:${item.id}` }],
        [{ text: '‹ Товары', callback_data: 'products' }],
      ],
    },
  }
}

/** Шаг конструктора: спрашиваем одно поле за раз. */
export function productFieldScreen(hint: string): Screen {
  return {
    text: `<b>${escapeHtml(hint)}</b>\n\nПришлите значение одним сообщением. Отмена — кнопка ниже.`,
    keyboard: { inline_keyboard: [[{ text: '‹ Отмена', callback_data: 'products' }]] },
  }
}

export function newProductScreen(draft: ProductDraft): Screen {
  const ready = Boolean(draft.title && draft.price !== undefined && draft.category)
  return {
    text: [
      '<b>Новый товар</b>',
      '',
      `Название: ${draft.title ? escapeHtml(draft.title) : '—'}`,
      `Цена: ${draft.price !== undefined ? money(draft.price) : '—'}`,
      `Категория: ${draft.category ?? '—'}`,
      `Описание: ${draft.subtitle ? escapeHtml(draft.subtitle) : '—'}`,
      `Фото: ${draft.photoRequested ? 'будет добавлено' : 'нет'}`,
      '',
      ready ? 'Всё готово — нажмите «Сохранить».' : 'Заполните название, цену и категорию.',
    ].join('\n'),
    keyboard: {
      inline_keyboard: [
        [{ text: '✏️ Название', callback_data: 'newname' }, { text: '💰 Цена', callback_data: 'newprice' }],
        [
          { text: '🏷 Категория', callback_data: 'newcat' },
          { text: '📝 Описание', callback_data: 'newsub' },
        ],
        [{ text: '📷 Фото', callback_data: 'newphoto' }],
        ready
          ? [{ text: '✅ Сохранить и показать на сайте', callback_data: 'newsave' }]
          : [{ text: '— заполните поля —', callback_data: 'newnothing' }],
        [{ text: '‹ Товары', callback_data: 'products' }],
      ],
    },
  }
}

export function categoryPickScreen(prefix: string): Screen {
  return {
    text: '<b>Категория</b>\n\nВыберите раздел витрины.',
    keyboard: {
      inline_keyboard: [
        ...catalog.CATEGORIES.map((category, index) => [{ text: category, callback_data: `${prefix}:${index}` }]),
        [{ text: '‹ Назад', callback_data: 'products' }],
      ],
    },
  }
}

// ─── Расписание: конструктор ────────────────────────────────────────────────

export type SessionBuildDraft = {
  title?: string
  time?: string
  durationMin?: number
  price?: number
  seats?: number
  days?: number
  groupIndex?: number
  levelIndex?: number
  coachId?: string
  courtId?: string
}

export function sessionBuilderScreen(
  draft: SessionBuildDraft,
  coaches: { id: string; name: string }[],
  courts: { id: string; name: string }[],
): Screen {
  const group = draft.groupIndex !== undefined ? catalog.GROUPS[draft.groupIndex] : '—'
  const level = draft.levelIndex !== undefined ? catalog.LEVELS[draft.levelIndex] : '—'
  const ready = Boolean(
    draft.title &&
      draft.time &&
      draft.groupIndex !== undefined &&
      draft.levelIndex !== undefined &&
      draft.coachId &&
      draft.courtId &&
      draft.price !== undefined &&
      draft.seats,
  )

  return {
    text: [
      '<b>Новое занятие в расписании</b>',
      '',
      `Название: ${draft.title ? escapeHtml(draft.title) : '—'}`,
      `Формат: ${group} · уровень: ${level}`,
      `Время: ${draft.time ?? '—'} · ${draft.durationMin ?? 60} мин`,
      `Цена: ${draft.price !== undefined ? money(draft.price) : '—'} · мест: ${draft.seats ?? '—'}`,
      `Тренер: ${coaches.find((c) => c.id === draft.coachId)?.name ?? '—'}`,
      `Корт: ${courts.find((c) => c.id === draft.courtId)?.name ?? '—'}`,
      `Повтор: ${draft.days ?? 1} дн.`,
      '',
      ready ? 'Готово — сохраняйте, занятие сразу появится на сайте.' : 'Заполните все поля.',
    ].join('\n'),
    keyboard: {
      inline_keyboard: [
        [{ text: '✏️ Название', callback_data: 'sesname' }, { text: '🕘 Время', callback_data: 'sestime' }],
        [{ text: '💰 Цена', callback_data: 'sesprice' }, { text: '🪑 Мест', callback_data: 'sesseats' }],
        [{ text: '📚 Формат', callback_data: 'sesgroup' }, { text: '🎚 Уровень', callback_data: 'seslevel' }],
        coaches.slice(0, 4).map((coach) => ({
          text: `${draft.coachId === coach.id ? '✓ ' : ''}${coach.name.split(' ')[0]}`,
          callback_data: `sescoach:${coach.id}`,
        })),
        courts.slice(0, 4).map((court) => ({
          text: `${draft.courtId === court.id ? '✓ ' : ''}${court.name}`,
          callback_data: `sescourt:${court.id}`,
        })),
        [
          { text: `Повтор: ${draft.days ?? 1} дн.`, callback_data: 'sesdays' },
          { text: '⏱ Длительность', callback_data: 'sesdur' },
        ],
        ready
          ? [{ text: '✅ Сохранить занятие', callback_data: 'sessave' }]
          : [{ text: '— заполните поля —', callback_data: 'sesnothing' }],
        [{ text: '‹ Расписание', callback_data: 'sessions:0' }],
      ],
    },
  }
}

export function sessionCardScreen(row: {
  id: string
  title: string
  start: string
  dayOffset: number
  seatsTotal: number
  seatsTaken: number
  price: number
  active: boolean
}): Screen {
  return {
    text: [
      `<b>${escapeHtml(row.title)}</b>`,
      '',
      `${sessionDate(row.dayOffset)} · ${row.start}`,
      `Мест: ${row.seatsTaken}/${row.seatsTotal} · ${money(row.price)}`,
      `На сайте: ${row.active ? 'показывается' : 'снято с продажи'}`,
    ].join('\n'),
    keyboard: {
      inline_keyboard: [
        [
          { text: '💰 Цена', callback_data: `sessprice2:${row.id}` },
          { text: '🕘 Время', callback_data: `sestime2:${row.id}` },
        ],
        [
          { text: '🪑 Мест', callback_data: `sesseats2:${row.id}` },
          { text: row.active ? '⚪️ Снять' : '🟢 Вернуть', callback_data: `sestoggle:${row.id}` },
        ],
        [{ text: '🗑 Удалить', callback_data: `sesdel:${row.id}` }],
        [{ text: '‹ Расписание', callback_data: 'sessions:0' }],
      ],
    },
  }
}

export function slotBuilderScreen(
  draft: { time?: string; price?: number; days?: number; courtId?: string },
  courts: { id: string; name: string }[],
): Screen {
  const ready = Boolean(draft.time && draft.price !== undefined && draft.courtId)
  return {
    text: [
      '<b>Новое окно свободной игры</b>',
      '',
      `Время: ${draft.time ?? '—'}`,
      `Цена: ${draft.price !== undefined ? money(draft.price) : '—'}`,
      `Корт: ${courts.find((c) => c.id === draft.courtId)?.name ?? '—'}`,
      `Повтор: ${draft.days ?? 1} дн.`,
      '',
      ready ? 'Готово — окно появится в приложении.' : 'Заполните время, цену и корт.',
    ].join('\n'),
    keyboard: {
      inline_keyboard: [
        courts.slice(0, 4).map((court) => ({
          text: `${draft.courtId === court.id ? '✓ ' : ''}${court.name}`,
          callback_data: `slotcourt:${court.id}`,
        })),
        [
          { text: '🕘 Время', callback_data: 'slottime' },
          { text: '💰 Цена', callback_data: 'slotprice' },
        ],
        [{ text: `Повтор: ${draft.days ?? 1} дн.`, callback_data: 'slotdays' }],
        ready
          ? [{ text: '✅ Создать окна', callback_data: 'slotsave' }]
          : [{ text: '— заполните поля —', callback_data: 'slotnothing' }],
        [{ text: '‹ Свободная игра', callback_data: 'slots:0' }],
      ],
    },
  }
}

export { catalog }
