import { failure, getDb, json } from './_lib/db.js'
import { resolveUser } from './_lib/telegram.js'

/**
 * Отдаём витрину: корты, тренеров, занятия (7 дней), свободные окна и товары.
 *
 * Без ?view=1 это персональный запрос: если подпись Telegram пришла и совпала,
 * игрок попадает в базу. С ?view=1 — чистая витрина без записи в базу: её читает
 * сайт в обычном браузере, где подписи Telegram нет. Выключенные тренеры,
 * занятия, окна и товары не отдаются.
 */
async function handler(request: Request): Promise<Response> {
  try {
    const viewOnly = new URL(request.url).searchParams.has('view')

    if (!viewOnly) {
      // Ошибка подписи не должна ломать витрину — просто не регистрируем игрока.
      await resolveUser(request).catch(() => null)
    }

    const sql = getDb()

    const [courts, coaches, sessions, slots, products] = await Promise.all([
      sql`select id, name, surface from courts where is_active order by sort_order`,
      sql`select id, name, role, initials, rating::float as rating from coaches where is_active order by sort_order`,
      sql`
        select s.id, s.title, s.group_kind as "group", s.level, s.coach_id as "coachId",
               s.court_id as "courtId", ((s.starts_at at time zone 'Europe/Moscow')::date - (now() at time zone 'Europe/Moscow')::date) as "dayOffset", s.start_time as start,
               s.duration_min as "durationMin", s.price, s.seats_total as "seatsTotal",
               s.seats_taken as "seatsTaken"
        from training_sessions s
        where s.starts_at > now() and s.starts_at < ((now() at time zone 'Europe/Moscow')::date + 30)::timestamp at time zone 'Europe/Moscow' and s.is_active
        order by s.starts_at
      `,
      sql`
        select f.id, f.court_id as "courtId", ((f.starts_at at time zone 'Europe/Moscow')::date - (now() at time zone 'Europe/Moscow')::date) as "dayOffset", f.start_time as start,
               f.duration_min as "durationMin", f.price
        from free_slots f
        join courts c on c.id = f.court_id and c.is_active
        where f.starts_at > now() and f.starts_at < ((now() at time zone 'Europe/Moscow')::date + 30)::timestamp at time zone 'Europe/Moscow' and f.is_active
        order by f.starts_at
      `,
      sql`
        select id, title, subtitle, category, price, old_price as "oldPrice",
               image, badge, colors
        from products
        where is_active
        order by sort_order
      `,
    ])

    // Фото из бота лежит в Telegram (tg:<file_id>) — отдаём его через свой прокси,
    // чтобы токен бота не попадал в разметку. Остальные пути (например /img/*) как есть.
    const withImages = (products as { id: string; image: string | null }[]).map((product) => ({
      ...product,
      image: product.image?.startsWith('tg:')
        ? `/api/image?product=${encodeURIComponent(product.id)}`
        : product.image,
    }))

    const response = json({ courts, coaches, sessions, slots, products: withImages })
    response.headers.set('cache-control', 'no-store')
    return response
  } catch (error) {
    return failure(error, 'catalog')
  }
}

/**
 * Vercel (Node runtime) понимает Web-сигнатуру только через объект с методом `fetch`.
 * «Голый» default-экспорт вызывается как handler(req, res) — Response терялся (500/504).
 */
export default { fetch: handler }
