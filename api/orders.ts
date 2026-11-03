import { HttpError, failure, getDb, json, normalizePhone, readNumber, readString } from './_lib/db.js'
import { ensureCustomer, saveCustomerContact } from './_lib/customers.js'
import { resolveUser, type TelegramUser } from './_lib/telegram.js'

async function session(request: Request): Promise<TelegramUser> {
  const user = await resolveUser(request)
  if (!user) throw new HttpError(401, 'Откройте приложение в Telegram')
  return user
}

/** GET /api/orders — заказы текущего пользователя. */
export async function listOrders(request: Request): Promise<Response> {
  try {
    const user = await session(request)
    const customer = await ensureCustomer(user)
    const sql = getDb()
    const rows = await sql`
      select o.id, o.product_id as "productId", p.title, o.price, o.quantity,
             o.contact_name as "contactName", o.contact_phone as "contactPhone",
             u.client_no as "clientNo",
             extract(epoch from o.created_at) * 1000 as "createdAt"
      from orders o
      join users u on u.id = o.user_id
      join products p on p.id = o.product_id
      where o.user_id = ${customer.id}
      order by o.created_at desc
      limit 50
    `
    return json({ orders: rows, clientNo: customer.clientNo, clientLabel: customer.clientLabel })
  } catch (error) {
    return failure(error, 'orders.list')
  }
}

/** POST /api/orders — оформить заказ (цена берётся из БД, не из клиента). */
export async function createOrder(request: Request): Promise<Response> {
  try {
    const user = await session(request)
    const body = (await request.json().catch(() => null)) as
      | { productId?: unknown; quantity?: unknown; name?: unknown; phone?: unknown }
      | null
    if (!body) throw new HttpError(400, 'Некорректное тело запроса')

    const productId = readString(body.productId, 'productId', 40)
    const quantity = readNumber(body.quantity ?? 1, 'quantity', 1, 9)
    // Без этих данных администратор не сможет связаться с покупателем.
    const contactName = readString(body.name, 'name', 80)
    const contactPhone = normalizePhone(readString(body.phone, 'phone', 40))

    const sql = getDb()
    const [product] = await sql`
      select id, price from products where id = ${productId} and is_active
    `
    if (!product) throw new HttpError(404, 'Товар недоступен')

    const price = (product as { price: number }).price * quantity
    const customer = await saveCustomerContact(user, contactName, contactPhone)

    const [usage] = await sql`
      select count(*) filter (where created_at > now() - interval '1 hour')::int as recent,
             count(*) filter (where status = 'reserved')::int as active
      from orders where user_id = ${customer.id}
    `
    const limits = usage as { recent: number; active: number }
    if (limits.recent >= 5 || limits.active >= 10) {
      throw new HttpError(429, 'Слишком много заказов. Попробуйте позже или свяжитесь с клубом.')
    }

    const [order] = await sql`
      insert into orders (user_id, product_id, quantity, price, contact_name, contact_phone)
      values (${customer.id}, ${productId}, ${quantity}, ${price}, ${contactName}, ${contactPhone})
      returning id
    `

    console.info('[api/orders.create] created', { userId: customer.id, productId, quantity, clientNo: customer.clientNo })
    return json(
      {
        id: (order as { id: string } | undefined)?.id,
        price,
        clientNo: customer.clientNo,
        clientLabel: customer.clientLabel,
        contactName,
        contactPhone,
      },
      201,
    )
  } catch (error) {
    return failure(error, 'orders.create')
  }
}

async function handler(request: Request): Promise<Response> {
  if (request.method === 'GET') return listOrders(request)
  if (request.method === 'POST') return createOrder(request)
  return json({ error: 'Метод не поддерживается' }, 405)
}

/**
 * Vercel (Node runtime) понимает Web-сигнатуру только через объект с методом `fetch`.
 * «Голый» default-экспорт вызывается как handler(req, res) — Response терялся (500/504).
 */
export default { fetch: handler }
