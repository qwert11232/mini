import { HttpError, failure, getDb, json } from './_lib/db.js'
import { createSession, isAdmin, resolveUser, verifyInitData } from './_lib/telegram.js'

/**
 * POST /api/me — обмен свежей подписи Telegram на короткую сессию в памяти.
 * GET /api/me — проверенный профиль (принимает и прежний заголовок tma).
 */
async function handler(request: Request): Promise<Response> {
  try {
    if (request.method === 'POST') {
      const auth = request.headers.get('authorization')
      if (!auth?.startsWith('tma ')) throw new HttpError(401, 'Откройте приложение в Telegram')
      const user = await verifyInitData(auth.slice(4))
      const session = await createSession(user, new URL(request.url).origin)
      return json({
        ...session,
        user: { id: user.id, firstName: user.firstName, lastName: user.lastName },
      })
    }

    if (request.method !== 'GET') return json({ error: 'Метод не поддерживается' }, 405)
    const user = await resolveUser(request)
    if (!user) throw new HttpError(401, 'Требуется вход через Telegram')
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

/** Vercel (Node runtime) использует Web-сигнатуру через объект с методом fetch. */
export default { fetch: handler }
