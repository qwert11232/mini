import { HttpError, failure, getDb, json, readString } from './_lib/db.js'
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
    if (!user) throw new HttpError(401, 'Откройте приложение в Telegram, чтобы увидеть записи')

    const telegramId = user.id
    const sql = getDb()
    const rows = await sql`
      select b.id, b.kind, b.source_id as "sourceId", b.title, b.subtitle,
             ((b.starts_at at time zone 'Europe/Moscow')::date - (now() at time zone 'Europe/Moscow')::date) as "dayOffset", b.start_time as start,
             b.duration_min as "durationMin", b.price,
             to_char(b.starts_at at time zone 'Europe/Moscow', 'YYYY-MM-DD HH24:MI') as "startsAt",
             extract(epoch from b.created_at) * 1000 as "createdAt"
      from bookings b
      join users u on u.id = b.user_id
      where u.telegram_id = ${telegramId} and b.status = 'active'
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
    if (!user) throw new HttpError(401, 'Откройте приложение в Telegram, чтобы записаться')

    const body = (await request.json().catch(() => null)) as (BookingBody & { sourceIds?: unknown }) | null
    if (!body) throw new HttpError(400, 'Некорректное тело запроса')
    const kind = readString(body.kind, 'kind', 12)
    if (!KINDS.has(kind)) throw new HttpError(400, 'Неизвестный тип записи')
    const sourceId = readString(body.sourceId, 'sourceId', 80)
    const ids = body.sourceIds === undefined ? [sourceId] : body.sourceIds
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 8 ||
        ids.some((id) => typeof id !== 'string' || !id.trim() || id.length > 80) ||
        new Set(ids).size !== ids.length || ids[0] !== sourceId || (kind !== 'free' && ids.length !== 1)) {
      throw new HttpError(400, 'Некорректный список окон')
    }

    const sql = getDb()
    const [userRow] = await sql`
      insert into users (telegram_id, first_name, last_name, username)
      values (${user.id}, ${user.firstName}, ${user.lastName}, ${user.username})
      on conflict (telegram_id) do update set last_seen_at = now()
      returning id
    `
    const userId = (userRow as { id: string } | undefined)?.id
    if (!userId) throw new HttpError(500, 'Не удалось определить пользователя')

    // Мягкий лимит по истории, включая отмены. Нужен внешний rate limiter для
    // жёсткой защиты от параллельных запросов и распределённых атак.
    const [usage] = await sql`
      select count(*) filter (where created_at > now() - interval '1 hour')::int as recent,
             count(*) filter (where status = 'active' and starts_at > now())::int as active
      from bookings where user_id = ${userId}
    `
    const limits = usage as { recent: number; active: number }
    if (limits.recent + ids.length > 12 || limits.active + ids.length > 12) {
      throw new HttpError(429, 'Слишком много записей. Попробуйте позже или свяжитесь с клубом.')
    }

    // Блокируем все окна до проверки непрерывности, цены и доступности. Изменение
    // окон и вставки броней выполняются одним SQL-оператором и откатываются вместе.
    const rows = kind === 'free' ? await sql`
      with locked as materialized (
        select f.* from free_slots f
        join courts c on c.id = f.court_id and c.is_active
        where f.id in (select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))
          and f.is_active and f.starts_at > now()
          and f.starts_at < ((now() at time zone 'Europe/Moscow')::date + 30)::timestamp at time zone 'Europe/Moscow'
        order by f.id for update of f
      ), ordered as materialized (
        select *, lag(starts_at + duration_min * interval '1 minute') over (order by starts_at) as previous_end
        from locked
      ), valid as materialized (
        select count(*) = ${ids.length}::int
          and count(distinct court_id) = 1
          and coalesce(sum(duration_min), 0) <= 240
          and count(*) filter (where previous_end is not null and previous_end <> starts_at) = 0
          and (array_agg(id order by starts_at))[1] = ${sourceId} as ok
        from ordered
      ), reserved as (
        update free_slots f set is_active = false
        where f.id in (select id from locked) and (select ok from valid)
        returning f.*
      ), inserted as (
        insert into bookings (user_id, kind, source_id, title, subtitle, day_offset, start_time, duration_min, price, starts_at)
        select ${userId}, 'free', r.id, 'Аренда · ' || c.name, c.surface || ' · до 4 игроков',
               (r.starts_at at time zone 'Europe/Moscow')::date - (now() at time zone 'Europe/Moscow')::date,
               r.start_time, r.duration_min, r.price, r.starts_at
        from reserved r join courts c on c.id = r.court_id
        returning id
      ) select id from inserted
    ` : await sql`
      with reserved as (
        update training_sessions s set seats_taken = seats_taken + 1
        where s.id = ${sourceId} and s.is_active and s.seats_taken < s.seats_total
          and s.starts_at > now()
          and s.starts_at < ((now() at time zone 'Europe/Moscow')::date + 30)::timestamp at time zone 'Europe/Moscow'
          and not exists (select 1 from bookings b where b.user_id = ${userId} and b.kind = 'training'
                          and b.source_id = s.id and b.status = 'active')
        returning s.*
      ), inserted as (
        insert into bookings (user_id, kind, source_id, title, subtitle, day_offset, start_time, duration_min, price, starts_at)
        select ${userId}, 'training', r.id, r.title, coalesce(c.name, 'Тренер') || ' · ' || coalesce(ct.name, 'Корт'),
               (r.starts_at at time zone 'Europe/Moscow')::date - (now() at time zone 'Europe/Moscow')::date,
               r.start_time, r.duration_min, r.price, r.starts_at
        from reserved r left join coaches c on c.id = r.coach_id left join courts ct on ct.id = r.court_id
        returning id
      ) select id from inserted
    `
    if (rows.length !== ids.length) throw new HttpError(409, 'Окно или занятие недоступно. Обновите расписание.')

    console.info('[api/bookings.create] created', { userId, kind, sourceId })
    return json({ id: (rows[0] as { id: string } | undefined)?.id, ids: rows.map((row: unknown) => (row as { id: string }).id) }, 201)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      return failure(new HttpError(409, 'Вы уже записаны на это занятие'), 'bookings.create')
    }
    return failure(error, 'bookings.create')
  }
}

/** DELETE /api/bookings?id=... — отмена. */
export async function cancelBooking(request: Request): Promise<Response> {
  try {
    const user = await resolveUser(request)
    if (!user) throw new HttpError(401, 'Откройте приложение в Telegram')

    const id = new URL(request.url).searchParams.get('id')
    if (!id) throw new HttpError(400, 'Не передан id записи')

    const sql = getDb()
    const cancelled = await sql`
      with cancelled as (
        update bookings b set status = 'cancelled', cancelled_at = now()
        from users u
        where b.id = ${id} and u.id = b.user_id and u.telegram_id = ${user.id} and b.status = 'active'
        returning b.kind, b.source_id
      ), released_slot as (
        update free_slots f set is_active = true from cancelled c
        where c.kind = 'free' and f.id = c.source_id returning f.id
      ), released_seat as (
        update training_sessions s set seats_taken = greatest(s.seats_taken - 1, 0) from cancelled c
        where c.kind = 'training' and s.id = c.source_id returning s.id
      ) select kind from cancelled
    `
    if (cancelled.length === 0) throw new HttpError(404, 'Запись не найдена')

    return json({ ok: true })
  } catch (error) {
    return failure(error, 'bookings.cancel')
  }
}

/** Роутер: Vercel вызывает один файл на все методы. */
async function handler(request: Request): Promise<Response> {
  if (request.method === 'GET') return listBookings(request)
  if (request.method === 'POST') return createBooking(request)
  if (request.method === 'DELETE') return cancelBooking(request)
  return json({ error: 'Метод не поддерживается' }, 405)
}

/**
 * Vercel (Node runtime) понимает Web-сигнатуру только через объект с методом `fetch`.
 * «Голый» default-экспорт вызывается как handler(req, res) — Response терялся (500/504).
 */
export default { fetch: handler }
