import { failure, HttpError, json, normalizePhone, readString } from './_lib/db.js'
import { ensureCustomer, saveCustomerContact } from './_lib/customers.js'
import { resolveUser, type TelegramUser } from './_lib/telegram.js'

/**
 * GET  /api/client — номер и сохранённые контакты текущего клиента.
 * POST /api/client — сохранить имя и телефон (используется и при заказе).
 *
 * Клиент определяется подписью Telegram initData. Номер выдаёт база: он не меняется при
 * повторном открытии сайта и виден администратору в боте.
 */
async function session(request: Request): Promise<TelegramUser> {
  const user = await resolveUser(request)
  if (!user) throw new HttpError(401, 'Откройте приложение в Telegram')
  return user
}

function profile(customer: Awaited<ReturnType<typeof ensureCustomer>>) {
  return {
    clientNo: customer.clientNo,
    clientLabel: customer.clientLabel,
    firstName: customer.firstName,
    phone: customer.phone,
    hasPhone: Boolean(customer.phone),
  }
}

async function handler(request: Request): Promise<Response> {
  try {
    if (request.method !== 'GET' && request.method !== 'POST') {
      return json({ error: 'Метод не поддерживается' }, 405)
    }

    const user = await session(request)

    if (request.method === 'GET') {
      return json(profile(await ensureCustomer(user)))
    }

    const body = (await request.json().catch(() => null)) as { name?: unknown; phone?: unknown } | null
    if (!body) throw new HttpError(400, 'Некорректное тело запроса')

    const name = readString(body.name, 'name', 80)
    const phone = normalizePhone(readString(body.phone, 'phone', 40))
    const customer = await saveCustomerContact(user, name, phone)
    return json({ ok: true, ...profile(customer) })
  } catch (error) {
    return failure(error, 'client')
  }
}

/**
 * Vercel (Node runtime) понимает Web-сигнатуру только через объект с методом `fetch`.
 * «Голый» default-экспорт вызывается как handler(req, res) — Response терялся (500/504).
 */
export default { fetch: handler }
