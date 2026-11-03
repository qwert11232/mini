import { getDb } from './db.js'
import { CUSTOMER_SCHEMA } from './schema.js'
import type { TelegramUser } from './telegram.js'

/** Карточка, которую видит только сам клиент и администратор клуба. */
export type Customer = {
  id: string
  clientNo: number
  clientLabel: string
  firstName: string
  username: string | null
  phone: string | null
}

export function formatClientNo(value: number | null | undefined): string {
  return value ? `№ ${value}` : '№ —'
}

/**
 * Существующая база могла быть создана до появления телефонов и номеров.
 * Миграция идемпотентна и выполняется один раз на инстанс функции. Это избавляет
 * владельца от ручного SQL после каждого деплоя.
 */
let customerSchema: Promise<void> | null = null

export function ensureCustomerSchema(): Promise<void> {
  if (!customerSchema) {
    customerSchema = (async () => {
      const sql = getDb()
      for (const statement of CUSTOMER_SCHEMA) await sql.query(statement, [])
    })().catch((error: unknown) => {
      customerSchema = null
      throw error
    })
  }
  return customerSchema
}

function mapCustomer(row: {
  id: string
  clientNo: number | null
  firstName: string
  username: string | null
  phone: string | null
}): Customer {
  return {
    id: row.id,
    clientNo: Number(row.clientNo ?? 0),
    clientLabel: formatClientNo(row.clientNo),
    firstName: row.firstName,
    username: row.username,
    phone: row.phone,
  }
}

/**
 * Создаёт клиента при первом заходе и выдаёт постоянный номер. При повторном
 * заходе имя/телефон не затираются: их может уже заполнить клиент при заказе.
 */
export async function ensureCustomer(user: TelegramUser): Promise<Customer> {
  await ensureCustomerSchema()
  const sql = getDb()
  const rows = (await sql`
    insert into users (telegram_id, first_name, last_name, username, client_no)
    values (${user.id}, ${user.firstName}, ${user.lastName}, ${user.username}, nextval('users_client_no_seq'))
    on conflict (telegram_id) do update
      set last_seen_at = now(),
          client_no = coalesce(users.client_no, excluded.client_no)
    returning id, client_no as "clientNo", first_name as "firstName", username, phone
  `) as unknown as {
    id: string
    clientNo: number | null
    firstName: string
    username: string | null
    phone: string | null
  }[]

  const row = rows[0]
  if (!row) throw new Error('Не удалось создать карточку клиента')
  return mapCustomer(row)
}

/** Сохраняет имя и телефон, оставленные при заказе, в карточке клиента. */
export async function saveCustomerContact(
  user: TelegramUser,
  name: string,
  phone: string,
): Promise<Customer> {
  const customer = await ensureCustomer(user)
  const sql = getDb()
  const rows = (await sql`
    update users
    set first_name = ${name}, phone = ${phone}, last_seen_at = now()
    where id = ${customer.id}
    returning id, client_no as "clientNo", first_name as "firstName", username, phone
  `) as unknown as {
    id: string
    clientNo: number | null
    firstName: string
    username: string | null
    phone: string | null
  }[]
  const row = rows[0]
  if (!row) throw new Error('Не удалось сохранить контакты клиента')
  return mapCustomer(row)
}
