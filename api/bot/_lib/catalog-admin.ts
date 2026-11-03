import { getDb, money, type Result } from './db.js'
import { getFileUrl } from './telegram.js'

/**
 * Управление витриной из бота: товары (с фото) и расписание занятий.
 * Всё, что здесь меняется, сразу видно на сайте — он читает те же таблицы.
 */

/** Ограничение Telegram: фото до 5 МБ (иначе Bot API не отдаст файл). */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024

const CATEGORIES = ['Ракетки', 'Мячи', 'Одежда', 'Аксессуары', 'Услуги'] as const
const GROUPS = ['Группа', 'Сплит', 'Индивидуально', 'Дети', 'Корт-фитнес'] as const
const LEVELS = ['Новичок', 'Любитель', 'Средний', 'Продвинутый'] as const

export { CATEGORIES, GROUPS, LEVELS }

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

// ─── Товары ─────────────────────────────────────────────────────────────────

export type Product = {
  id: string
  title: string
  subtitle: string
  category: string
  price: number
  oldPrice: number | null
  image: string | null
  badge: string | null
  isActive: boolean
  sortOrder: number
}

export async function products(): Promise<Product[]> {
  const sql = getDb()
  return (await sql`
    select id, title, subtitle, category, price, old_price as "oldPrice",
           image, badge, is_active as "isActive", sort_order as "sortOrder"
    from products
    order by sort_order, title
    limit 40
  `) as unknown as Product[]
}

export async function product(id: string): Promise<Product | null> {
  const sql = getDb()
  const rows = (await sql`
    select id, title, subtitle, category, price, old_price as "oldPrice",
           image, badge, is_active as "isActive", sort_order as "sortOrder"
    from products where id = ${id}
  `) as unknown as Product[]
  return rows[0] ?? null
}

type ProductDraft = {
  title: string
  subtitle?: string
  category: string
  price: number
  oldPrice?: number | null
  image?: string | null
  badge?: string | null
}

export async function createProduct(draft: ProductDraft, adminTelegramId: number): Promise<Result & { id?: string }> {
  if (!draft.title.trim()) return { ok: false, message: 'Нужно название' }
  if (!Number.isFinite(draft.price) || draft.price < 0) return { ok: false, message: 'Цена должна быть числом' }
  if (!CATEGORIES.includes(draft.category as (typeof CATEGORIES)[number])) {
    return { ok: false, message: 'Неизвестная категория' }
  }

  const sql = getDb()
  const base = `p-${slug(draft.title) || 'товар'}`
  let id = base
  for (let attempt = 2; attempt < 40; attempt += 1) {
    const exists = (await sql`select 1 from products where id = ${id}`) as unknown as unknown[]
    if (exists.length === 0) break
    id = `${base}-${attempt}`
  }

  const [orderRow] = (await sql`select coalesce(max(sort_order), 0) + 1 as next from products`) as unknown as {
    next: number
  }[]

  await sql`
    insert into products (id, title, subtitle, category, price, old_price, image, badge, colors, sort_order, is_active)
    values (${id}, ${draft.title.trim().slice(0, 120)}, ${(draft.subtitle ?? '').slice(0, 160)},
            ${draft.category}, ${Math.round(draft.price)}, ${draft.oldPrice ?? null},
            ${draft.image ?? null}, ${draft.badge ?? null}, ${'{}'}::text[], ${orderRow?.next ?? 1}, true)
  `
  await sql`insert into admin_audit (telegram_id, action, payload)
            values (${adminTelegramId}, 'product.create', ${JSON.stringify({ id, title: draft.title })}::jsonb)`
  return { ok: true, message: 'товар добавлен на сайт', id }
}

export async function updateProduct(
  id: string,
  patch: Partial<ProductDraft> & { isActive?: boolean },
  adminTelegramId: number,
): Promise<Result> {
  const sql = getDb()
  const values: Record<string, unknown> = {}

  if (patch.title !== undefined) values.title = patch.title.trim().slice(0, 120)
  if (patch.subtitle !== undefined) values.subtitle = patch.subtitle.slice(0, 160)
  if (patch.category !== undefined) values.category = patch.category
  if (patch.price !== undefined) values.price = Math.round(patch.price)
  if (patch.oldPrice !== undefined) values.old_price = patch.oldPrice
  if (patch.image !== undefined) values.image = patch.image
  if (patch.badge !== undefined) values.badge = patch.badge
  if (patch.isActive !== undefined) values.is_active = patch.isActive

  const keys = Object.keys(values)
  if (keys.length === 0) return { ok: false, message: 'Нечего менять' }

  // SET собирается из белого списка полей, значения уходят параметрами.
  const sets = keys.map((key, index) => `${key} = $${index + 1}`).join(', ')
  const updated = await sql.query(`update products set ${sets} where id = $${keys.length + 1} returning id`, [
    ...keys.map((key) => values[key] as string | number | boolean | null),
    id,
  ])
  if ((updated as unknown[]).length === 0) return { ok: false, message: 'Товар не найден' }

  await sql`insert into admin_audit (telegram_id, action, payload)
            values (${adminTelegramId}, 'product.update', ${JSON.stringify({ id, fields: keys })}::jsonb)`
  return { ok: true, message: 'сохранено' }
}

/** Показать/скрыть товар на сайте. */
export async function toggleProduct(id: string, adminTelegramId: number): Promise<Result> {
  const sql = getDb()
  const rows = (await sql`
    update products set is_active = not is_active where id = ${id}
    returning title, is_active
  `) as unknown as { title: string; is_active: boolean }[]
  const row = rows[0]
  if (!row) return { ok: false, message: 'Товар не найден' }
  await sql`insert into admin_audit (telegram_id, action, payload)
            values (${adminTelegramId}, 'product.toggle', ${JSON.stringify({ id, active: row.is_active })}::jsonb)`
  return { ok: true, message: row.is_active ? 'товар снова на сайте' : 'товар скрыт с сайта' }
}

export async function deleteProduct(id: string, adminTelegramId: number): Promise<Result> {
  const sql = getDb()
  const rows = (await sql`
    delete from products
    where id = ${id}
      and not exists (select 1 from orders o where o.product_id = ${id})
    returning title
  `) as unknown as { title: string }[]
  if (!rows[0]) return { ok: false, message: 'Удалить нельзя: есть заказы. Скрыть товар можно кнопкой «Скрыть»' }

  await sql`insert into admin_audit (telegram_id, action, payload)
            values (${adminTelegramId}, 'product.delete', ${JSON.stringify({ id, title: rows[0].title })}::jsonb)`
  return { ok: true, message: 'товар удалён' }
}

/**
 * Фото товара: в базе храним только `tg:<file_id>`. Ссылку Telegram отдавать
 * нельзя — в ней токен бота; картинку сайту отдаёт /api/image.
 */
export async function setProductPhoto(
  id: string,
  photo: { file_id: string; file_size?: number } | undefined,
  adminTelegramId: number,
): Promise<Result> {
  if (!photo) return { ok: false, message: 'Пришлите фото' }
  if (photo.file_size && photo.file_size > MAX_PHOTO_BYTES) {
    return { ok: false, message: 'Фото больше 5 МБ — Telegram такое не отдаст' }
  }

  const url = await getFileUrl(photo.file_id)
  if (!url) return { ok: false, message: 'Telegram не отдал файл — попробуйте другое фото' }

  const sql = getDb()
  await sql`update products set image = ${`tg:${photo.file_id}`} where id = ${id}`
  await sql`insert into admin_audit (telegram_id, action, payload)
            values (${adminTelegramId}, 'product.photo', ${JSON.stringify({ id })}::jsonb)`
  return { ok: true, message: 'фото обновлено' }
}

// ─── Расписание ─────────────────────────────────────────────────────────────

export type Session = {
  id: string
  title: string
  groupKind: string
  level: string
  coachId: string
  courtId: string
  dayOffset: number
  start: string
  durationMin: number
  price: number
  seatsTotal: number
  seatsTaken: number
  isActive: boolean
}

export async function sessionById(id: string): Promise<Session | null> {
  const sql = getDb()
  const rows = (await sql`
    select id, title, group_kind as "groupKind", level, coach_id as "coachId", court_id as "courtId",
           day_offset as "dayOffset", start_time as start, duration_min as "durationMin",
           price, seats_total as "seatsTotal", seats_taken as "seatsTaken", is_active as "isActive"
    from training_sessions where id = ${id}
  `) as unknown as Session[]
  return rows[0] ?? null
}

type SessionDraft = {
  title: string
  groupKind: string
  level: string
  coachId: string
  courtId: string
  start: string
  durationMin: number
  price: number
  seatsTotal: number
}

function validateSession(draft: SessionDraft): string | null {
  if (!draft.title.trim()) return 'Нужно название занятия'
  if (!GROUPS.includes(draft.groupKind as (typeof GROUPS)[number])) return 'Выберите формат'
  if (!LEVELS.includes(draft.level as (typeof LEVELS)[number])) return 'Выберите уровень'
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.start)) return 'Время в формате ЧЧ:ММ'
  if (!(draft.durationMin >= 15 && draft.durationMin <= 240)) return 'Длительность 15–240 минут'
  if (!(draft.seatsTotal >= 1 && draft.seatsTotal <= 40)) return 'Мест от 1 до 40'
  if (!(draft.price >= 0 && draft.price <= 200000)) return 'Цена вне разумных пределов'
  return null
}

/**
 * Создание занятия с повтором: `days` — на сколько дней вперёд поставить.
 * Каждый день — своя строка, поэтому правка одного дня не ломает остальные.
 */
export async function createSession(
  draft: SessionDraft & { days: number },
  adminTelegramId: number,
): Promise<Result & { created?: number }> {
  const error = validateSession(draft)
  if (error) return { ok: false, message: error }
  if (!(draft.days >= 1 && draft.days <= 7)) return { ok: false, message: 'Повтор — от 1 до 7 дней' }

  const sql = getDb()
  const stamp = Date.now().toString(36)
  let created = 0

  for (let day = 0; day < draft.days; day += 1) {
    const id = `s-${stamp}-${day}`
    await sql`
      insert into training_sessions
        (id, title, group_kind, level, coach_id, court_id, day_offset, start_time, duration_min, price, seats_total, seats_taken, is_active)
      values (${id}, ${draft.title.trim().slice(0, 120)}, ${draft.groupKind}, ${draft.level},
              ${draft.coachId}, ${draft.courtId}, ${day}, ${draft.start}, ${draft.durationMin},
              ${Math.round(draft.price)}, ${draft.seatsTotal}, 0, true)
    `
    created += 1
  }

  await sql`
    update training_sessions
    set starts_at = date_trunc('day', now()) + make_interval(days => day_offset) + (start_time || ':00')::interval
    where id like ${`s-${stamp}-%`}
  `
  await sql`insert into admin_audit (telegram_id, action, payload)
            values (${adminTelegramId}, 'session.create',
                    ${JSON.stringify({ title: draft.title, days: draft.days, start: draft.start })}::jsonb)`
  return { ok: true, message: `добавлено дней: ${created}`, created }
}

export async function updateSession(
  id: string,
  patch: Partial<SessionDraft> & { isActive?: boolean },
  adminTelegramId: number,
): Promise<Result> {
  const sql = getDb()
  const values: Record<string, unknown> = {}

  if (patch.title !== undefined) values.title = patch.title.trim().slice(0, 120)
  if (patch.groupKind !== undefined) values.group_kind = patch.groupKind
  if (patch.level !== undefined) values.level = patch.level
  if (patch.coachId !== undefined) values.coach_id = patch.coachId
  if (patch.courtId !== undefined) values.court_id = patch.courtId
  if (patch.start !== undefined) values.start_time = patch.start
  if (patch.durationMin !== undefined) values.duration_min = patch.durationMin
  if (patch.price !== undefined) values.price = Math.round(patch.price)
  if (patch.seatsTotal !== undefined) values.seats_total = patch.seatsTotal
  if (patch.isActive !== undefined) values.is_active = patch.isActive

  const keys = Object.keys(values)
  if (keys.length === 0) return { ok: false, message: 'Нечего менять' }

  const sets = keys.map((key, index) => `${key} = $${index + 1}`).join(', ')
  const updated = await sql.query(`update training_sessions set ${sets} where id = $${keys.length + 1} returning id`, [
    ...keys.map((key) => values[key] as string | number | boolean),
    id,
  ])
  if ((updated as unknown[]).length === 0) return { ok: false, message: 'Занятие не найдено' }

  await sql`insert into admin_audit (telegram_id, action, payload)
            values (${adminTelegramId}, 'session.update', ${JSON.stringify({ id, fields: keys })}::jsonb)`
  return { ok: true, message: 'сохранено' }
}

export async function toggleSession(id: string, adminTelegramId: number): Promise<Result> {
  const sql = getDb()
  const updated = (await sql`
    update training_sessions set is_active = not is_active where id = ${id}
    returning title, is_active
  `) as unknown as { title: string; is_active: boolean }[]
  const row = updated[0]
  if (!row) return { ok: false, message: 'Занятие не найдено' }
  await sql`insert into admin_audit (telegram_id, action, payload)
            values (${adminTelegramId}, 'session.toggle', ${JSON.stringify({ id, active: row.is_active })}::jsonb)`
  return { ok: true, message: row.is_active ? 'занятие вернулось в продажу' : 'занятие снято с продажи' }
}

/**
 * Удаление занятия. Если на него уже записались — не удаляем, а снимаем
 * с продажи, чтобы не потерять записи игроков.
 */
export async function deleteSession(id: string, adminTelegramId: number): Promise<Result> {
  const sql = getDb()
  const rows = (await sql`
    delete from training_sessions s
    where s.id = ${id}
      and not exists (select 1 from bookings b where b.source_id = ${id} and b.status = 'active')
    returning title
  `) as unknown as { title: string }[]

  if (rows[0]) {
    await sql`insert into admin_audit (telegram_id, action, payload)
              values (${adminTelegramId}, 'session.delete', ${JSON.stringify({ id })}::jsonb)`
    return { ok: true, message: 'занятие удалено' }
  }

  const hidden = (await sql`
    update training_sessions set is_active = false where id = ${id} returning title
  `) as unknown as { title: string }[]
  if (!hidden[0]) return { ok: false, message: 'Занятие не найдено' }
  await sql`insert into admin_audit (telegram_id, action, payload)
            values (${adminTelegramId}, 'session.hide', ${JSON.stringify({ id })}::jsonb)`
  return { ok: true, message: 'на занятие есть записи — снял с продажи' }
}

// ─── Свободные окна ─────────────────────────────────────────────────────────

export async function createSlots(
  input: { courtId: string; start: string; durationMin: number; price: number; days: number },
  adminTelegramId: number,
): Promise<Result & { created?: number }> {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.start)) return { ok: false, message: 'Время в формате ЧЧ:ММ' }
  if (!(input.days >= 1 && input.days <= 7)) return { ok: false, message: 'Повтор — от 1 до 7 дней' }

  const sql = getDb()
  let created = 0

  for (let day = 0; day < input.days; day += 1) {
    // id окна = корт + время + день: повторный запуск не создаёт дублей.
    const id = `${input.courtId}-${input.start}-d${day}`
    const inserted = (await sql`
      insert into free_slots (id, court_id, day_offset, start_time, duration_min, price)
      values (${id}, ${input.courtId}, ${day}, ${input.start}, ${input.durationMin}, ${Math.round(input.price)})
      on conflict (id) do nothing
      returning id
    `) as unknown as { id: string }[]
    if (inserted[0]) created += 1
  }

  await sql`
    update free_slots
    set starts_at = date_trunc('day', now()) + make_interval(days => day_offset) + (start_time || ':00')::interval
    where id like ${`${input.courtId}-${input.start}-d%`}
  `
  await sql`insert into admin_audit (telegram_id, action, payload)
            values (${adminTelegramId}, 'slots.create', ${JSON.stringify({ ...input, created })}::jsonb)`
  if (created === 0) return { ok: false, message: 'Такие окна уже есть' }
  return { ok: true, message: `создано окон: ${created}`, created }
}

export async function deleteSlot(slotId: string, adminTelegramId: number): Promise<Result> {
  const sql = getDb()
  const rows = (await sql`
    delete from free_slots f
    where f.id = ${slotId}
      and not exists (select 1 from bookings b where b.source_id = ${slotId} and b.status = 'active')
    returning id
  `) as unknown as { id: string }[]
  if (!rows[0]) return { ok: false, message: 'Окно занято или уже удалено' }
  await sql`insert into admin_audit (telegram_id, action, payload)
            values (${adminTelegramId}, 'slot.delete', ${JSON.stringify({ slotId })}::jsonb)`
  return { ok: true, message: 'окно удалено' }
}

// ─── Справочники для конструктора ───────────────────────────────────────────

export async function coaches(): Promise<{ id: string; name: string; initials: string }[]> {
  const sql = getDb()
  return (await sql`
    select id, name, initials from coaches where is_active order by sort_order
  `) as unknown as { id: string; name: string; initials: string }[]
}

export async function courts(): Promise<{ id: string; name: string; surface: string }[]> {
  const sql = getDb()
  return (await sql`
    select id, name, surface from courts where is_active order by sort_order
  `) as unknown as { id: string; name: string; surface: string }[]
}

export function productTitle(item: Product): string {
  const flag = item.isActive ? '🟢' : '⚪️'
  const photo = item.image ? ' 📷' : ''
  return `${flag}${photo} ${item.title.slice(0, 30)} · ${money(item.price)}`
}
