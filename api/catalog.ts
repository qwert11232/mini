import { failure, getDb, json } from './_lib/db'

/**
 * GET /api/catalog — всё, что нужно приложению при старте:
 * корты, тренеры, занятия на 7 дней, свободные окна, товары.
 * Кэш на 60 секунд: сетка меняется редко, но не должна залипать.
 */
export default async function handler(): Promise<Response> {
  try {
    const sql = getDb()

    const [courts, coaches, sessions, slots, products] = await Promise.all([
      sql`select id, name, surface from courts order by sort_order`,
      sql`select id, name, role, initials, rating::float as rating from coaches order by sort_order`,
      sql`
        select s.id, s.title, s.group_kind as "group", s.level, s.coach_id as "coachId",
               s.court_id as "courtId", s.day_offset as "dayOffset", s.start_time as start,
               s.duration_min as "durationMin", s.price, s.seats_total as "seatsTotal",
               s.seats_taken as "seatsTaken"
        from training_sessions s
        where s.day_offset between 0 and 6 and s.is_active
        order by s.day_offset, s.start_time
      `,
      sql`
        select id, court_id as "courtId", day_offset as "dayOffset", start_time as start,
               duration_min as "durationMin", price
        from free_slots
        where day_offset between 0 and 6 and is_active
        order by day_offset, start_time
      `,
      sql`
        select id, title, subtitle, category, price, old_price as "oldPrice",
               image, badge, colors
        from products
        where is_active
        order by sort_order
      `,
    ])

    const response = json({ courts, coaches, sessions, slots, products })
    response.headers.set('cache-control', 'public, s-maxage=60, stale-while-revalidate=300')
    return response
  } catch (error) {
    return failure(error, 'catalog')
  }
}
