import { clubDate, getDb, money, type Result } from './db.js'
import { ensureCustomerSchema } from '../../_lib/customers.js'
import type { Keyboard } from './telegram.js'

/**
 * Запросы и тексты админ-панели. Всё, что меняет данные, возвращает Result —
 * вебхук по нему решает, что ответить в callback и что перерисовать.
 */

export type { Result } from './db.js'

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Дата клуба, отсчитываемая от сегодняшнего дня в Москве. */
export function sessionDate(dayOffset: number): string {
  return clubDate(dayOffset)
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

export function places(count: number): string {
  return `${count} ${plural(count, 'место', 'места', 'мест')}`
}

// ─── Сводка и журнал ─────────────────────────────────────────────────────────

export type Summary = {
  todayBookings: number
  todayRevenue: number
  upcoming: number
  orders: number
  users: number
  freeSlots: number
  sessions: number
}

export async function summary(): Promise<Summary> {
  const sql = getDb()
  const [row] = (await sql`
    select
      (select count(*)::int from bookings where status = 'active' and (starts_at at time zone 'Europe/Moscow')::date = (now() at time zone 'Europe/Moscow')::date) as "todayBookings",
      (select coalesce(sum(price), 0)::int from bookings where status = 'active' and (starts_at at time zone 'Europe/Moscow')::date = (now() at time zone 'Europe/Moscow')::date) as "todayRevenue",
      (select count(*)::int from bookings where status = 'active' and starts_at >= now()) as "upcoming",
      (select count(*)::int from orders where status = 'reserved') as "orders",
      (select count(*)::int from users) as "users",
      (select count(*)::int from free_slots where is_active and starts_at > now()) as "freeSlots",
      (select count(*)::int from training_sessions where is_active) as "sessions"
  `) as unknown as Summary[]

  return (
    row ?? {
      todayBookings: 0,
      todayRevenue: 0,
      upcoming: 0,
      orders: 0,
      users: 0,
      freeSlots: 0,
      sessions: 0,
    }
  )
}

export type AuditRow = {
  action: string
  createdAt: string
  who: string | null
}

export async function auditLog(limit = 10): Promise<AuditRow[]> {
  const sql = getDb()
  const rows = (await sql`
    select a.action, a.telegram_id as "telegramId",
           to_char(a.created_at at time zone 'Europe/Moscow', 'DD.MM HH24:MI') as "createdAt",
           u.first_name as who
    from admin_audit a
    left join users u on u.telegram_id = a.telegram_id
    order by a.created_at desc
    limit ${limit}
  `) as unknown as AuditRow[]
  return rows
}

// ─── Игроки ─────────────────────────────────────────────────────────────────

export type PlayerRow = {
  id: string
  first_name: string
  username: string | null
  telegram_id: number
  role: string
  clientNo: number | null
  phone: string | null
  created: string
  cancelled: number
  lastSeen: string | null
}

export async function players(limit = 12): Promise<PlayerRow[]> {
  await ensureCustomerSchema()
  const sql = getDb()
  const rows = (await sql`
    select u.id, u.first_name, u.username, u.telegram_id, u.role,
           u.client_no as "clientNo", u.phone,
           to_char(u.created_at at time zone 'Europe/Moscow', 'DD.MM.YY') as created,
           (select count(*)::int from bookings b where b.user_id = u.id and b.status = 'cancelled') as cancelled,
           to_char(u.last_seen_at at time zone 'Europe/Moscow', 'DD.MM HH24:MI') as "lastSeen"
    from users u
    order by u.last_seen_at desc
    limit ${limit}
  `) as unknown as PlayerRow[]
  return rows
}

/** Внутренняя заметка администратора о клиенте — видна только в панели. */
export async function saveNote(playerId: string, note: string): Promise<Result> {
  const sql = getDb()
  const updated = (await sql`
    update users set admin_note = ${note.slice(0, 500)} where id = ${playerId} returning id
  `) as unknown as { id: string }[]
  if (updated.length === 0) return { ok: false, message: 'Игрок не найден' }
  return { ok: true, message: 'заметка сохранена' }
}

export async function setRole(playerId: string, role: string): Promise<Result> {
  if (!['player', 'coach', 'admin'].includes(role)) return { ok: false, message: 'Неизвестная роль' }
  const sql = getDb()
  const updated = await sql`update users set role = ${role} where id = ${playerId} returning id`
  return updated.length ? { ok: true } : { ok: false, message: 'Игрок не найден' }
}

// ─── Записи ─────────────────────────────────────────────────────────────────

/** День записи относительно календаря клуба, для возврата к тому же экрану. */
export async function bookingDayOffset(bookingId: string): Promise<number | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId)) return null
  const sql = getDb()
  const [row] = (await sql`
    select (starts_at at time zone 'Europe/Moscow')::date - (now() at time zone 'Europe/Moscow')::date as offset
    from bookings where id = ${bookingId}::uuid
  `) as unknown as { offset: number | null }[]
  return row?.offset ?? null
}

/** Новая цена занятия из текста админа. */
export async function setSessionPrice(sessionId: string, price: number, adminTelegramId: number): Promise<Result> {
  if (!Number.isFinite(price) || price < 0 || price > 200000) return { ok: false, message: 'Цена вне разумных пределов' }
  const sql = getDb()
  const updated = (await sql`
    update training_sessions set price = ${Math.round(price)}
    where id = ${sessionId}
    returning title, price
  `) as unknown as { title: string; price: number }[]
  const row = updated[0]
  if (!row) return { ok: false, message: 'Занятие не найдено' }
  await sql`insert into admin_audit (telegram_id, action, payload)
            values (${adminTelegramId}, 'session.price', ${JSON.stringify({ sessionId, price: row.price })}::jsonb)`
  return { ok: true, message: `Новая цена: ${money(row.price)}` }
}

/** Занять место вручную: место и телефонная запись создаются атомарно. */
export async function reserveSeat(sessionId: string, adminTelegramId: number): Promise<Result> {
  const sql = getDb()
  const updated = (await sql`
    with reserved as (
      update training_sessions s set seats_taken = seats_taken + 1
      where s.id = ${sessionId} and s.is_active and s.seats_taken < s.seats_total and s.starts_at > now()
      returning s.*
    ), inserted as (
      insert into bookings (user_id, kind, source_id, title, subtitle, day_offset, start_time, duration_min, price, starts_at)
      select null, 'training', r.id, r.title, 'ресепшен · ' || ${String(adminTelegramId)}, r.day_offset,
             r.start_time, r.duration_min, r.price, r.starts_at
      from reserved r returning id
    ), logged as (
      insert into admin_audit (telegram_id, action, payload)
      select ${adminTelegramId}, 'session.reserve', ${JSON.stringify({ sessionId })}::jsonb
      from inserted returning id
    ) select r.seats_taken as taken, r.seats_total as total from reserved r where exists (select 1 from inserted)
  `) as unknown as { taken: number; total: number }[]
  const session = updated[0]
  if (!session) return { ok: false, message: 'Свободных мест нет или занятие уже началось' }
  return { ok: true, message: `Место занято: ${session.taken}/${session.total}` }
}

/** Закрыть окно под телефонную бронь и создать запись одной SQL-командой. */
export async function closeSlot(slotId: string, adminTelegramId: number): Promise<Result> {
  const sql = getDb()
  const inserted = await sql`
    with closed as (
      update free_slots f set is_active = false
      where f.id = ${slotId} and f.is_active and f.starts_at > now()
        and not exists (select 1 from bookings b where b.kind = 'free' and b.source_id = f.id and b.status = 'active')
      returning f.*
    ), booked as (
      insert into bookings (user_id, kind, source_id, title, subtitle, day_offset, start_time, duration_min, price, starts_at)
      select null, 'free', f.id, 'Корт ' || f.court_id, 'ресепшен · ' || ${String(adminTelegramId)},
             f.day_offset, f.start_time, f.duration_min, f.price, f.starts_at
      from closed f returning id
    ), logged as (
      insert into admin_audit (telegram_id, action, payload)
      select ${adminTelegramId}, 'slot.close', ${JSON.stringify({ slotId })}::jsonb
      from booked returning id
    ) select id from booked
  `
  if (inserted.length === 0) return { ok: false, message: 'Окно уже закрыто или недоступно' }
  return { ok: true, message: 'Окно закрыто под аренду' }
}

/** Не открываем окно с активной бронью игрока; ручные брони закрываем атомарно. */
export async function openSlot(slotId: string, adminTelegramId: number): Promise<Result> {
  const sql = getDb()
  const opened = await sql`
    with manual as materialized (
      -- Сначала блокируем телефонные записи, затем окно: тот же порядок,
      -- что у отмены записи. Иначе одновременные действия дают deadlock.
      select b.id from bookings b
      where b.kind = 'free' and b.source_id = ${slotId} and b.status = 'active' and b.user_id is null
      order by b.id for update
    ), opened as (
      update free_slots f set is_active = true
      where f.id = ${slotId} and not f.is_active
        and (select count(*) from manual) >= 0
        and not exists (
          select 1 from bookings b
          where b.kind = 'free' and b.source_id = f.id and b.status = 'active' and b.user_id is not null
        )
      returning f.id
    ), cancelled_manual as (
      update bookings b set status = 'cancelled', cancelled_at = now()
      from opened f, manual m
      where b.id = m.id and b.source_id = f.id and b.status = 'active'
      returning b.id
    ), logged as (
      insert into admin_audit (telegram_id, action, payload)
      select ${adminTelegramId}, 'slot.open', ${JSON.stringify({ slotId })}::jsonb
      from opened returning id
    ) select id from opened
  `
  if (opened.length === 0) {
    return { ok: false, message: 'Окно уже открыто или занято игроком; сначала отмените его запись' }
  }
  return { ok: true, message: 'Окно открыто' }
}

/** Посещение можно отметить только после начала записи. */
export async function markVisited(bookingId: string, adminTelegramId: number): Promise<Result> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId)) {
    return { ok: false, message: 'Запись не найдена' }
  }
  const sql = getDb()
  const updated = await sql`
    with visited as (
      update bookings set status = 'visited'
      where id = ${bookingId}::uuid and status = 'active' and starts_at <= now()
      returning id
    ), logged as (
      insert into admin_audit (telegram_id, action, payload)
      select ${adminTelegramId}, 'booking.visited', ${JSON.stringify({ bookingId })}::jsonb
      from visited returning id
    ) select id from visited
  `
  if (!updated.length) return { ok: false, message: 'Запись закрыта или ещё не началась' }
  return { ok: true, message: 'Отмечено посещение' }
}

/** Восстановить бронь только при наличии свободного окна или места. */
export async function restoreBooking(bookingId: string, adminTelegramId: number): Promise<Result> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId)) {
    return { ok: false, message: 'Запись не найдена' }
  }
  const sql = getDb()
  let updated: { id: string }[]
  try {
    updated = (await sql`
      with target as materialized (
        select b.id, b.kind, b.source_id, b.user_id, b.starts_at, b.duration_min
        from bookings b where b.id = ${bookingId}::uuid and b.status = 'cancelled' and b.starts_at > now()
        for update
      ), reserved_slot as (
        update free_slots f set is_active = false from target t
        where t.kind = 'free' and t.source_id = f.id and f.is_active and f.starts_at > now()
          and f.starts_at = t.starts_at and f.duration_min = t.duration_min
          and not exists (select 1 from bookings b where b.kind = 'free' and b.source_id = f.id and b.status = 'active')
        returning f.id
      ), reserved_seat as (
        update training_sessions s set seats_taken = seats_taken + 1 from target t
        where t.kind = 'training' and t.source_id = s.id and s.is_active and s.starts_at > now()
          and s.starts_at = t.starts_at and s.duration_min = t.duration_min
          and s.seats_taken < s.seats_total
          and not exists (select 1 from bookings b where b.user_id = t.user_id and b.kind = 'training'
                          and b.source_id = s.id and b.status = 'active')
        returning s.id
      ), restored as (
        update bookings b set status = 'active', cancelled_at = null
        from target t where b.id = t.id
          and ((t.kind = 'free' and exists (select 1 from reserved_slot))
            or (t.kind = 'training' and exists (select 1 from reserved_seat)))
        returning b.id
      ), logged as (
        insert into admin_audit (telegram_id, action, payload)
        select ${adminTelegramId}, 'booking.restore', ${JSON.stringify({ bookingId })}::jsonb
        from restored returning id
      ) select id from restored
    `) as unknown as { id: string }[]
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      return { ok: false, message: 'Игрок уже записан на это занятие' }
    }
    throw error
  }
  if (!updated[0]) return { ok: false, message: 'Запись недоступна: место занято или расписание изменилось' }
  return { ok: true, message: 'Запись восстановлена' }
}

// ─── Товары ─────────────────────────────────────────────────────────────────

export type ProductRow = {
  id: string
  title: string
  price: number
  is_active: boolean
}

export async function products(): Promise<ProductRow[]> {
  const sql = getDb()
  return (await sql`
    select id, title, price, is_active
    from products
    order by sort_order
    limit 12
  `) as unknown as ProductRow[]
}

export async function toggleProduct(productId: string, adminTelegramId: number): Promise<Result> {
  const sql = getDb()
  const updated = (await sql`
    update products set is_active = not is_active
    where id = ${productId}
    returning title, is_active
  `) as unknown as { title: string; is_active: boolean }[]
  const row = updated[0]
  if (!row) return { ok: false, message: 'Товар не найден' }
  await sql`insert into admin_audit (telegram_id, action, payload)
            values (${adminTelegramId}, 'product.toggle', ${JSON.stringify({ productId, active: row.is_active })}::jsonb)`
  return { ok: true, message: row.is_active ? 'Товар в продаже' : 'Товар скрыт' }
}

export function productLine(row: ProductRow): string {
  return `${row.is_active ? '🟢' : '⚪️'} ${escapeHtml(row.title)} · ${money(row.price)}`
}

// ─── Корты и загрузка ───────────────────────────────────────────────────────

export type LoadRow = { court: string; surface: string; booked: number; open: number }

export async function courtLoad(): Promise<LoadRow[]> {
  const sql = getDb()
  return (await sql`
    select c.name as court, c.surface,
           (select count(*)::int from bookings b
             join free_slots f on f.id = b.source_id and f.court_id = c.id
             where b.kind = 'free' and b.status = 'active'
               and (b.starts_at at time zone 'Europe/Moscow')::date between
                   (now() at time zone 'Europe/Moscow')::date and (now() at time zone 'Europe/Moscow')::date + 6) as booked,
           (select count(*)::int from free_slots f
             where f.court_id = c.id and f.is_active and f.starts_at > now()
               and (f.starts_at at time zone 'Europe/Moscow')::date <= (now() at time zone 'Europe/Moscow')::date + 6) as open
    from courts c
    where c.is_active
    order by c.sort_order
  `) as unknown as LoadRow[]
}

// ─── Ремонт схемы ───────────────────────────────────────────────────────────

/**
 * Оставлена для обратной совместимости, webhook её больше не вызывает.
 * Statements включали SCHEMA + SEED: повторный прогон на рабочей базе мог
 * добавить демо-данные и сдвинуть starts_at. Для миграции состояния бота
 * используйте /api/admin/migrate-bot-state — он создаёт только новую таблицу.
 */
export async function repairSchema(statements: string[]): Promise<{ applied: number }> {
  const sql = getDb()
  // Один запрос на соединение: DDL в Neon HTTP выполняется последовательно.
  for (const statement of statements) {
    await sql.query(statement, [])
  }
  return { applied: statements.length }
}

export function auditLine(row: AuditRow): string {
  const who = row.who ?? 'админ'
  const action = row.action
    .replace('booking.cancel', 'отменил запись')
    .replace('booking.self_cancel', 'отменил свою запись')
    .replace('booking.restore', 'восстановил запись')
    .replace('booking.visited', 'отметил посещение')
    .replace('session.seats', 'поправил места')
    .replace('session.reserve', 'занял место')
    .replace('session.manual_cancel', 'отменил запись ресепшена')
    .replace('order.issued', 'выдал заказ')
    .replace('product.toggle', 'скрыл/вернул товар')
    .replace('slot.close', 'закрыл окно')
    .replace('slot.open', 'открыл окно')
    .replace('schema.repair', 'починил схему')
  return `${escapeHtml(row.createdAt)} · ${escapeHtml(who)} — ${escapeHtml(action)}`
}

export function keyboard(rows: { text: string; data: string }[][]): Keyboard {
  return {
    inline_keyboard: rows.map((row) => row.map((button) => ({ text: button.text, callback_data: button.data }))),
  }
}
