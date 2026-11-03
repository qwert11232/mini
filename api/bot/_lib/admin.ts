import { getDb, money, type Result } from './db.js'
import type { Keyboard } from './telegram.js'

/**
 * Запросы и тексты админ-панели. Всё, что меняет данные, возвращает Result —
 * вебхук по нему решает, что ответить в callback и что перерисовать.
 */

export type { Result } from './db.js'

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'] as const

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Ближайшая дата занятия: day_offset считается от сегодняшнего дня. */
export function sessionDate(dayOffset: number): string {
  const date = new Date()
  date.setDate(date.getDate() + dayOffset)
  return `${date.getDate()}.${String(date.getMonth() + 1).padStart(2, '0')}, ${WEEKDAYS[date.getDay()]}`
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
      (select count(*)::int from bookings where status = 'active' and starts_at::date = current_date) as "todayBookings",
      (select coalesce(sum(price), 0)::int from bookings where status = 'active' and starts_at::date = current_date) as "todayRevenue",
      (select count(*)::int from bookings where status = 'active' and starts_at >= now()) as "upcoming",
      (select count(*)::int from orders where status = 'reserved') as "orders",
      (select count(*)::int from users) as "users",
      (select count(*)::int from free_slots where is_active) as "freeSlots",
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
  created: string
  cancelled: number
  lastSeen: string | null
}

export async function players(limit = 12): Promise<PlayerRow[]> {
  const sql = getDb()
  const rows = (await sql`
    select u.id, u.first_name, u.username, u.telegram_id, u.role,
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
  await sql`update users set role = ${role} where id = ${playerId}`
  return { ok: true }
}

// ─── Записи ─────────────────────────────────────────────────────────────────

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

/** Занять место вручную: клиент позвонил на ресепшен. */
export async function reserveSeat(sessionId: string, adminTelegramId: number): Promise<Result> {
  const sql = getDb()
  const updated = (await sql`
    update training_sessions
    set seats_taken = seats_taken + 1
    where id = ${sessionId} and is_active and seats_taken < seats_total
    returning seats_taken as taken, seats_total as total
  `) as unknown as { taken: number; total: number }[]

  const session = updated[0]
  if (!session) return { ok: false, message: 'Свободных мест нет' }

  // Клиент на ресепшене не в мини-аппе, поэтому заводим запись без user_id:
  // место в занятии уже занято, а имя пишем в название — это видно в «Записях».
  await sql`
    insert into bookings (user_id, kind, source_id, title, subtitle, day_offset, start_time, duration_min, price, starts_at)
    select null, 'training', s.id, s.title, 'ресепшен · ' || ${String(adminTelegramId)}, s.day_offset,
           s.start_time, s.duration_min, s.price, s.starts_at
    from training_sessions s where s.id = ${sessionId}
  `
  await sql`insert into admin_audit (telegram_id, action, payload)
            values (${adminTelegramId}, 'session.reserve', ${JSON.stringify({ sessionId })}::jsonb)`
  return { ok: true, message: `Место занято: ${session.taken}/${session.total}` }
}

/** Закрыть окно аренды — корт занят по телефону. */
export async function closeSlot(slotId: string, adminTelegramId: number): Promise<Result> {
  const sql = getDb()
  const updated = (await sql`
    update free_slots set is_active = false
    where id = ${slotId} and is_active
    returning id, court_id as "courtId", day_offset as "dayOffset", start_time as start
  `) as unknown as { id: string; courtId: string; dayOffset: number; start: string }[]
  const slot = updated[0]
  if (!slot) return { ok: false, message: 'Окно уже закрыто' }

  await sql`
    insert into bookings (user_id, kind, source_id, title, subtitle, day_offset, start_time, duration_min, price, starts_at)
    select null, 'free', f.id, 'Корт ' || f.court_id, 'ресепшен · ' || ${String(adminTelegramId)},
           f.day_offset, f.start_time, f.duration_min, f.price, f.starts_at
    from free_slots f where f.id = ${slotId}
  `
  await sql`insert into admin_audit (telegram_id, action, payload)
            values (${adminTelegramId}, 'slot.close', ${JSON.stringify({ slotId })}::jsonb)`
  return { ok: true, message: 'Окно закрыто под аренду' }
}

/** Вернуть окно аренды в продажу. */
export async function openSlot(slotId: string, adminTelegramId: number): Promise<Result> {
  const sql = getDb()
  const updated = (await sql`
    update free_slots set is_active = true where id = ${slotId} and not is_active returning id
  `) as unknown as { id: string }[]
  if (updated.length === 0) return { ok: false, message: 'Окно уже открыто' }
  await sql`insert into admin_audit (telegram_id, action, payload)
            values (${adminTelegramId}, 'slot.open', ${JSON.stringify({ slotId })}::jsonb)`
  return { ok: true, message: 'Окно открыто' }
}

/** Закрыть запись как посещённую. */
export async function markVisited(bookingId: string, adminTelegramId: number): Promise<Result> {
  const sql = getDb()
  const updated = (await sql`
    update bookings set status = 'visited'
    where id = ${bookingId} and status = 'active'
    returning title
  `) as unknown as { title: string }[]
  if (!updated[0]) return { ok: false, message: 'Запись уже закрыта' }
  await sql`insert into admin_audit (telegram_id, action, payload)
            values (${adminTelegramId}, 'booking.visited', ${JSON.stringify({ bookingId })}::jsonb)`
  return { ok: true, message: 'Отмечено посещение' }
}

/** Вернуть уже отменённую запись, если клиент передумал. */
export async function restoreBooking(bookingId: string, adminTelegramId: number): Promise<Result> {
  const sql = getDb()
  const updated = (await sql`
    update bookings set status = 'active', cancelled_at = null
    where id = ${bookingId} and status = 'cancelled'
    returning kind, source_id as "sourceId"
  `) as unknown as { kind: string; sourceId: string }[]
  const row = updated[0]
  if (!row) return { ok: false, message: 'Нечего восстанавливать' }

  if (row.kind === 'free') {
    await sql`update free_slots set is_active = false where id = ${row.sourceId}`
  } else {
    await sql`update training_sessions set seats_taken = least(seats_taken + 1, seats_total) where id = ${row.sourceId}`
  }
  await sql`insert into admin_audit (telegram_id, action, payload)
            values (${adminTelegramId}, 'booking.restore', ${JSON.stringify({ bookingId })}::jsonb)`
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
             where b.kind = 'free' and b.status = 'active'
               and b.starts_at::date between current_date and current_date + 6) as booked,
           (select count(*)::int from free_slots f
             where f.court_id = c.id and f.is_active
               and f.day_offset between 0 and 6) as open
    from courts c
    where c.is_active
    order by c.sort_order
  `) as unknown as LoadRow[]
}

// ─── Ремонт схемы ───────────────────────────────────────────────────────────

/**
 * В одной транзакции досоздаёт недостающие таблицы и колонки и повторно
 * прогоняет сид. Нужно, потому что на существующей базе `create table if not
 * exists` не добавляет новые колонки (у нас так не появился `admin_note`),
 * а `alter table` в схеме идемпотентен.
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
    .replace('booking.restore', 'восстановил запись')
    .replace('booking.visited', 'отметил посещение')
    .replace('session.seats', 'поправил места')
    .replace('session.reserve', 'занял место')
    .replace('order.issued', 'выдал заказ')
    .replace('product.toggle', 'скрыл/вернул товар')
    .replace('slot.close', 'закрыл окно')
    .replace('slot.open', 'открыл окно')
    .replace('schema.repair', 'починил схему')
  return `${row.createdAt} · ${escapeHtml(who)} — ${action}`
}

export function keyboard(rows: { text: string; data: string }[][]): Keyboard {
  return {
    inline_keyboard: rows.map((row) => row.map((button) => ({ text: button.text, callback_data: button.data }))),
  }
}
