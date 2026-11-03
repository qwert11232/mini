import { registerHooks } from 'node:module'
import { readFile } from 'node:fs/promises'
import { createHmac } from 'node:crypto'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'

const db = await PGlite.create()
const schema = (await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'))
  .replace('create extension if not exists "pgcrypto";', '')
await db.exec(schema)
const query = async (strings, ...values) => {
  const text = strings.reduce((result, part, index) => result + part + (index < values.length ? `$${index + 1}` : ''), '')
  return (await db.query(text, values)).rows
}
query.query = async (text, values) => (await db.query(text, values)).rows
globalThis.__bookingTestDb = query
process.env.DATABASE_URL = 'postgres://user:pass@localhost/test'
process.env.TELEGRAM_BOT_TOKEN = 'booking-test-token'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@neondatabase/serverless') return { url: 'test:neon', shortCircuit: true }
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.includes('/api/')) {
      return nextResolve(specifier.slice(0, -3) + '.ts', context)
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url === 'test:neon') return { format: 'module', shortCircuit: true, source: 'export function neon() { return globalThis.__bookingTestDb }' }
    if (url.endsWith('/api/_lib/db.ts')) {
      return { format: 'module', shortCircuit: true, source: `
        export function getDb() { return globalThis.__bookingTestDb }
        export function dbUrl() { return { url: 'postgres://localhost/test', from: 'test' } }
        export class HttpError extends Error { constructor(status, message) { super(message); this.status = status } }
        export function json(data, status = 200) { return Response.json(data, { status }) }
        export function failure(error) { return json({ error: error.message }, error.status || 500) }
        export function readString(value, field, max = 200) {
          if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new HttpError(400, field)
          return value.trim()
        }
        export function readNumber(value, field, min, max) {
          const n = Number(value); if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, field); return Math.round(n)
        }
        export function normalizePhone(value) { return value }
      ` }
    }
    return nextLoad(url, context)
  },
})

const { createBooking, cancelBooking, listBookings } = await import('../api/bookings.ts')
const { createOrder } = await import('../api/orders.ts')
const { default: client } = await import('../api/client.ts')
const { default: catalog } = await import('../api/catalog.ts')
const { createSlots, createSession } = await import('../api/bot/_lib/catalog-admin.ts')
const { default: webhook } = await import('../api/bot/webhook.ts')
const { default: setup } = await import('../api/bot/setup.ts')
const secret = createHmac('sha256', 'WebAppData').update(process.env.TELEGRAM_BOT_TOKEN).digest()
function signed(id = 123456789) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'Игрок' }) })
  const data = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n')
  params.set('hash', createHmac('sha256', secret).update(data).digest('hex'))
  return `tma ${params}`
}
function request(path, body, auth = signed(), method = 'POST') {
  return new Request(`https://example.test/api/${path}`, { method, headers: auth ? { authorization: auth } : { 'x-dt-device': 'testdevice123' }, ...(body ? { body: JSON.stringify(body) } : {}) })
}
await db.exec(`
  insert into courts (id, name, surface) values ('c', 'Корт 1', 'Хард'), ('other', 'Корт 2', 'Хард');
  insert into coaches (id, name, role, initials) values ('coach', 'Тренер', 'тренер', 'Т');
  insert into free_slots (id,court_id,day_offset,start_time,duration_min,price,starts_at) values
   ('a','c',1,'10:00',60,1000,((now() at time zone 'Europe/Moscow')::date + 1 + time '10:00') at time zone 'Europe/Moscow'),
   ('b','c',1,'11:00',60,2000,((now() at time zone 'Europe/Moscow')::date + 1 + time '11:00') at time zone 'Europe/Moscow'),
   ('gap','c',1,'14:00',60,3000,((now() at time zone 'Europe/Moscow')::date + 1 + time '14:00') at time zone 'Europe/Moscow'),
   ('other','other',1,'11:00',60,500,((now() at time zone 'Europe/Moscow')::date + 1 + time '11:00') at time zone 'Europe/Moscow');
  insert into training_sessions (id,title,group_kind,level,coach_id,court_id,day_offset,start_time,duration_min,price,seats_total,starts_at)
   values ('lesson','Настоящее занятие','Группа','Новичок','coach','c',1,'13:00',60,1500,2,now() + interval '1 day');
  insert into products(id,title,category,price) values ('p','Мячи','Мячи',300);
`)
const draft = { kind: 'free', sourceId: 'a', sourceIds: ['a', 'b'], title: 'Подмена', price: 1, durationMin: 1, start: '00:00', dayOffset: 1 }
assert.equal((await createBooking(request('bookings', draft, null))).status, 401)
assert.equal((await createOrder(request('orders', { productId: 'p', name: 'Иван', phone: '1234567890' }, null))).status, 401)
assert.equal((await listBookings(request('bookings?mine=1', null, null, 'GET'))).status, 401)
assert.equal((await client.fetch(request('client', null, null, 'GET'))).status, 401)
assert.equal((await createBooking(request('bookings', { ...draft, sourceIds: ['a', 'gap'] }))).status, 409)
assert.equal((await createBooking(request('bookings', { ...draft, sourceIds: ['a', 'other'] }))).status, 409)
assert.equal((await db.query('select count(*)::int as n from free_slots where is_active')).rows[0].n, 4)
const created = await createBooking(request('bookings', draft))
assert.equal(created.status, 201, await created.clone().text())
const data = await created.json()
assert.equal(data.ids.length, 2)
const rows = (await db.query('select source_id, price, duration_min, title from bookings order by source_id')).rows
assert.deepEqual(rows.map((r) => [r.source_id, r.price, r.duration_min]), [['a', 1000, 60], ['b', 2000, 60]])
assert.ok(rows.every((r) => r.title !== 'Подмена'))
assert.equal((await createBooking(request('bookings', draft, signed(222222222)))).status, 409)
assert.equal((await cancelBooking(request(`bookings?id=${data.ids[0]}`, null, signed(), 'DELETE'))).status, 200)
assert.equal((await db.query('select count(*)::int as n from free_slots where is_active')).rows[0].n, 3)
const lesson = await createBooking(request('bookings', { ...draft, kind: 'training', sourceId: 'lesson', sourceIds: ['lesson'] }))
assert.equal(lesson.status, 201, await lesson.clone().text())
assert.equal((await createBooking(request('bookings', { ...draft, kind: 'training', sourceId: 'lesson', sourceIds: ['lesson'] }))).status, 409)
assert.equal((await db.query("select seats_taken from training_sessions where id='lesson'")).rows[0].seats_taken, 1)
await db.exec(`insert into free_slots (id,court_id,day_offset,start_time,duration_min,price,starts_at) values
  ('race1','c',1,'17:00',60,1000,((now() at time zone 'Europe/Moscow')::date + 1 + time '17:00') at time zone 'Europe/Moscow'),
  ('race2','c',1,'18:00',60,1000,((now() at time zone 'Europe/Moscow')::date + 1 + time '18:00') at time zone 'Europe/Moscow')`)
const competing = { kind: 'free', sourceId: 'race1', sourceIds: ['race1', 'race2'] }
const concurrent = await Promise.all([createBooking(request('bookings', competing, signed(300000001))), createBooking(request('bookings', competing, signed(300000002)))])
assert.deepEqual(concurrent.map((response) => response.status).sort(), [201, 409])
assert.equal((await db.query("select count(*)::int as n from bookings where source_id in ('race1', 'race2')")).rows[0].n, 2)
const made = await createSlots({ courtId: 'c', start: '15:00', durationMin: 60, price: 1000, days: 30 }, 123)
assert.equal(made.created, 30)
const second = await createSlots({ courtId: 'c', start: '15:00', durationMin: 60, price: 1000, days: 30 }, 123)
assert.equal(second.ok, false)
const session = await createSession({ title: 'На месяц', groupKind: 'Группа', level: 'Новичок', coachId: 'coach', courtId: 'c', start: '12:00', durationMin: 60, price: 1000, seatsTotal: 5, days: 30 }, 123)
assert.equal(session.created, 30)
const cat = await (await catalog.fetch(request('catalog', null, null, 'GET'))).json()
assert.ok(cat.sessions.some((item) => item.dayOffset === 29), 'каталог показывает занятия через 29 дней')
assert.ok(cat.slots.some((slot) => slot.dayOffset === 29), 'каталог показывает окна через 29 дней')
for (let i = 0; i < 5; i++) {
  const order = await createOrder(request('orders', { productId: 'p', name: 'Иван', phone: '89990000000' }))
  assert.equal(order.status, 201, await order.clone().text())
}
assert.equal((await createOrder(request('orders', { productId: 'p', name: 'Иван', phone: '89990000000' }))).status, 429)
delete process.env.TELEGRAM_WEBHOOK_SECRET
assert.equal((await webhook.fetch(request('bot/webhook', {}, null))).status, 403)
assert.equal((await setup.fetch(request('bot/setup', null, null, 'GET'))).status, 401)
process.env.TELEGRAM_WEBHOOK_SECRET = 'test_secret'
assert.equal((await webhook.fetch(request('bot/webhook', {}, null))).status, 403)
console.log('✓ PostgreSQL: Telegram, атомарная аренда, соседние окна, цена, отмена и защита от дублей')
await db.close()
