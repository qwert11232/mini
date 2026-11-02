import { HttpError, failure, getDb, json, readNumber, readString } from './_lib/db.js'
import { resolveUser } from './_lib/telegram.js'

type BookingBody = {
  kind?: unknown
  sourceId?: unknown
  title?: unknown
  subtitle?: unknown
  dayOffset?: unknown
  start?: unknown
  durationMin?: unknown
  price?: unknown
}

const KINDS = new Set(['training', 'free'])

/** GET /api/bookings — записи текущего пользователя. */
export async function listBookings(request: Request): Promise<Response> {
  try {
    const user = await resolveUser(request)
    if (!user) throw new HttpError(401, 'Требуется вход через Telegram')

    const sql = getDb()
    const rows = await sql`
      select b.id, b.kind, b.source_id as "sourceId", b.title, b.subtitle,
             b.day_offset as "dayOffset", b.start_time as start,
             b.duration_min as "durationMin", b.price,
             to_char(b.starts_at at time zone 'Europe/Moscow', 'YYYY-MM-DD HH24:MI') as "startsAt",
             extract(epoch from b.created_at) * 1000 as "createdAt"
      from bookings b
      join users u on u.id = b.user_id
      where u.telegram_id = ${user.id} and b.status = 'active'
      order by b.created_at desc
    `
    return json({ bookings: rows, user: { firstName: user.firstName } })
  } catch (error) {
    return failure(error, 'bookings.list')
  }
}

/** POST /api/bookings — создать запись. Повтор на то же место не дублируется. */
export async function createBooking(request: Request): Promise<Response> {
  try {
    const user = await resolveUser(request)
    if (!user) throw new HttpError(401, 'Требуется вход через Telegram')

    const body = (await request.json().catch(() => null)) as BookingBody | null
    if (!body) throw new HttpError(400, 'Некорректное тело запроса')

    const kind = readString(body.kind, 'kind', 12)
    if (!KINDS.has(kind)) throw new HttpError(400, 'Неизвестный тип записи')
    const sourceId = readString(body.sourceId, 'sourceId', 80)
    const title = readString(body.title, 'title', 120)
    const subtitle = readString(body.subtitle, 'subtitle', 160)
    const dayOffset = readNumber(body.dayOffset, 'dayOffset', 0, 30)
    const start = readString(body.start, 'start', 5)
    const durationMin = readNumber(body.durationMin, 'durationMin', 15, 240)
    const price = readNumber(body.price, 'price', 0, 200000)

    const sql = getDb()

    const [slotRow] = await sql`
      select to_char(coalesce(
               (select starts_at from training_sessions where id = ${sourceId}),
               (select starts_at from free_slots where id = ${sourceId})
             ) at time zone 'Europe/Moscow', 'YYYY-MM-DD HH24:MI') as "startsAt"
    `
    const startsAt = (slotRow as { startsAt: string | null } | undefined)?.startsAt
    if (!startsAt) throw new HttpError(404, 'Занятие или окно не найдены')

    const [userRow] = await sql`
      insert into users (telegram_id, first_name, last_name, username)
      values (${user.id}, ${user.firstName}, ${user.lastName}, ${user.username})
      on conflict (telegram_id) do update
        set first_name = excluded.first_name,
            last_name = excluded.last_name,
            username = excluded.username,
            last_seen_at = now()
      returning id
    `
    const userId = (userRow as { id: string } | undefined)?.id
    if (!userId) throw new HttpError(500, 'Не удалось определить пользователя')

    if (kind === 'free') {
      const updated = await sql`
        update free_slots
        set is_active = false
        where id = ${sourceId} and is_active
        returning id
      `
      if (updated.length === 0) throw new HttpError(409, 'Это время уже заняли — выберите другое')
    }

    if (kind === 'training') {
      const updated = await sql`
        update training_sessions
        set seats_taken = seats_taken + 1
        where id = ${sourceId} and seats_taken < seats_total
        returning id
      `
      if (updated.length === 0) {
        const exists = await sql`select 1 from training_sessions where id = ${sourceId}`
        if (exists.length > 0) throw new HttpError(409, 'Мест на это занятие больше нет')
      }
    }

    const [booking] = await sql`
      insert into bookings (user_id, kind, source_id, title, subtitle, day_offset, start_time, duration_min, price, starts_at)
      values (${userId}, ${kind}, ${sourceId}, ${title}, ${subtitle}, ${dayOffset}, ${start}, ${durationMin}, ${price},
              ${startsAt}::timestamp at time zone 'Europe/Moscow')
      returning id
    `

    console.info('[api/bookings.create] created', { userId, kind, sourceId })
    return json({ id: (booking as { id: string } | undefined)?.id }, 201)
  } catch (error) {
    return failure(error, 'bookings.create')
  }
}

/** DELETE /api/bookings?id=... — отмена. */
export async function cancelBooking(request: Request): Promise<Response> {
  try {
    const user = await resolveUser(request)
    if (!user) throw new HttpError(401, 'Требуется вход через Telegram')

    const id = new URL(request.url).searchParams.get('id')
    if (!id) throw new HttpError(400, 'Не передан id записи')

    const sql = getDb()
    const cancelled = await sql`
      update bookings b
      set status = 'cancelled', cancelled_at = now()
      from users u
      where b.id = ${id} and u.id = b.user_id and u.telegram_id = ${user.id} and b.status = 'active'
      returning b.kind, b.source_id as "sourceId"
    `

    const row = cancelled[0] as { kind: string; sourceId: string } | undefined
    if (!row) throw new HttpError(404, 'Запись не найдена')

    if (row.kind === 'free') {
      await sql`update free_slots set is_active = true where id = ${row.sourceId}`
    } else {
      await sql`update training_sessions set seats_taken = greatest(seats_taken - 1, 0) where id = ${row.sourceId}`
    }

    return json({ ok: true })
  } catch (error) {
    return failure(error, 'bookings.cancel')
  }
}

/** Роутер: Vercel вызывает один файл на все методы. */
export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'GET') return listBookings(request)
  if (request.method === 'POST') return createBooking(request)
  if (request.method === 'DELETE') return cancelBooking(request)
  return json({ error: 'Метод не поддерживается' }, 405)
}
