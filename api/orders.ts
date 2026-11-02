import { HttpError, failure, getDb, json, readNumber, readString } from './_lib/db.ts'
import { resolveUser } from './_lib/telegram.ts'

/** GET /api/orders — заказы текущего пользователя. */
export async function listOrders(request: Request): Promise<Response> {
  try {
    const user = await resolveUser(request)
    if (!user) throw new HttpError(401, 'Требуется вход через Telegram')

    const sql = getDb()
    const rows = await sql`
      select o.id, o.product_id as "productId", p.title, o.price, o.quantity,
             extract(epoch from o.created_at) * 1000 as "createdAt"
      from orders o
      join users u on u.id = o.user_id
      join products p on p.id = o.product_id
      where u.telegram_id = ${user.id}
      order by o.created_at desc
      limit 50
    `
    return json({ orders: rows })
  } catch (error) {
    return failure(error, 'orders.list')
  }
}

/** POST /api/orders — оформить заказ (цена берётся из БД, не из клиента). */
export async function createOrder(request: Request): Promise<Response> {
  try {
    const user = await resolveUser(request)
    if (!user) throw new HttpError(401, 'Требуется вход через Telegram')

    const body = (await request.json().catch(() => null)) as
      | { productId?: unknown; quantity?: unknown }
      | null
    if (!body) throw new HttpError(400, 'Некорректное тело запроса')

    const productId = readString(body.productId, 'productId', 40)
    const quantity = readNumber(body.quantity ?? 1, 'quantity', 1, 9)

    const sql = getDb()
    const [product] = await sql`
      select id, price from products where id = ${productId} and is_active
    `
    if (!product) throw new HttpError(404, 'Товар недоступен')

    const price = (product as { price: number }).price * quantity

    const [userRow] = await sql`
      insert into users (telegram_id, first_name, last_name, username)
      values (${user.id}, ${user.firstName}, ${user.lastName}, ${user.username})
      on conflict (telegram_id) do update set last_seen_at = now()
      returning id
    `
    const userId = (userRow as { id: string } | undefined)?.id
    if (!userId) throw new HttpError(500, 'Не удалось определить пользователя')

    const [order] = await sql`
      insert into orders (user_id, product_id, quantity, price)
      values (${userId}, ${productId}, ${quantity}, ${price})
      returning id
    `

    console.info('[api/orders.create] created', { userId, productId, quantity })
    return json({ id: (order as { id: string } | undefined)?.id, price }, 201)
  } catch (error) {
    return failure(error, 'orders.create')
  }
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'GET') return listOrders(request)
  if (request.method === 'POST') return createOrder(request)
  return json({ error: 'Метод не поддерживается' }, 405)
}
