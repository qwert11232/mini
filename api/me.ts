import { HttpError, failure, getDb, json } from './_lib/db.js'
import { isAdmin, verifyInitData } from './_lib/telegram.js'

/**
 * GET /api/me — проверка подписи Telegram при открытии мини-аппа.
 * Регистрирует/обновляет пользователя и отдаёт его профиль.
 * Используется как health-check: если 200 — связка Vercel + Neon + бот жива.
 */
export default async function handler(request: Request): Promise<Response> {
  try {
    const auth = request.headers.get('authorization')
    if (!auth?.startsWith('tma ')) throw new HttpError(401, 'Требуется вход через Telegram')

    const user = await verifyInitData(auth.slice(4))
    const sql = getDb()

    await sql`
      insert into users (telegram_id, first_name, last_name, username)
      values (${user.id}, ${user.firstName}, ${user.lastName}, ${user.username})
      on conflict (telegram_id) do update
        set first_name = excluded.first_name,
            last_name = excluded.last_name,
            username = excluded.username,
            last_seen_at = now()
    `

    const [profile] = await sql`
      select b.id, b.kind, b.title, b.day_offset as "dayOffset", b.start_time as start
      from users u
      left join bookings b on b.user_id = u.id and b.status = 'active'
      where u.telegram_id = ${user.id}
      limit 1
    `

    return json({
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        isAdmin: isAdmin(user),
      },
      hasBookings: Boolean(profile && (profile as { id?: string }).id),
    })
  } catch (error) {
    return failure(error, 'me')
  }
}
