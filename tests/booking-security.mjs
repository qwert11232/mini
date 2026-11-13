import { registerHooks } from 'node:module'
import { readFile } from 'node:fs/promises'
import { createHmac } from 'node:crypto'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'

const db = await PGlite.create()
const schema = (await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'))
  .replace('create extension if not exists "pgcrypto";', '')
await db.exec(schema)
// Состояние бота — отдельная миграция: db/schema.sql не меняем, чтобы merge
// не запустил автоматический workflow применения всей схемы к рабочей базе.
const { BOT_STATE_SCHEMA } = await import('../api/_lib/schema.ts')
const standaloneMigration = await readFile(new URL('../migrations/001_bot_dialog_state.sql', import.meta.url), 'utf8')
const normalizeSql = (text) => text.replace(/--[^\n]*/g, '').replace(/;\s*$/, '').replace(/\s+/g, ' ').trim()
assert.equal(normalizeSql(standaloneMigration), normalizeSql(BOT_STATE_SCHEMA[0]), 'ручная и API-миграции должны совпадать')
for (const statement of BOT_STATE_SCHEMA) await db.exec(statement)
let failDbQuery = null
const query = async (strings, ...values) => {
  const text = strings.reduce((result, part, index) => result + part + (index < values.length ? `$${index + 1}` : ''), '')
  if (failDbQuery?.test(text)) throw new Error('private database diagnostics must not reach player')
  return (await db.query(text, values)).rows
}
query.query = async (text, values) => (await db.query(text, values)).rows
globalThis.__bookingTestDb = query
process.env.DATABASE_URL = 'postgres://user:pass@localhost/test'
process.env.TELEGRAM_BOT_TOKEN = 'booking-test-token'
process.env.ADMIN_TELEGRAM_IDS = '793536041'
process.env.ADMIN_TELEGRAM_USERNAMES = 'legacy_admin'
delete process.env.ADMIN_SETUP_TOKEN

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
        export function json(data, status = 200) { return Response.json(data, { status, headers: { 'cache-control': 'no-store' } }) }
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
const { createOrder, listOrders } = await import('../api/orders.ts')
const { default: client } = await import('../api/client.ts')
const { default: catalog } = await import('../api/catalog.ts')
const { createSlots, createSession, updateSession, deleteSession, deleteSlot } = await import('../api/bot/_lib/catalog-admin.ts')
const { reserveSeat, closeSlot, openSlot, restoreBooking, markVisited, courtLoad } = await import('../api/bot/_lib/admin.ts')
const { cancelBooking: cancelAsAdmin, cancelManualSeat } = await import('../api/bot/_lib/bookings.ts')
const { default: webhook } = await import('../api/bot/webhook.ts')
const { default: migrateBotState } = await import('../api/admin/migrate-bot-state.ts')
const { default: setup } = await import('../api/bot/setup.ts')
const { appUrl } = await import('../api/bot/_lib/app-url.ts')
const { cancelOwnBooking } = await import('../api/bot/_lib/user-screens.ts')
const { clubDate } = await import('../api/bot/_lib/db.ts')
const { isAdmin: isMiniAppAdmin, verifyInitData } = await import('../api/_lib/telegram.ts')
const { default: me } = await import('../api/me.ts')
// Если allowlist задан явно, даже пустой, он полностью заменяет ID по умолчанию.
const configuredAdmins = process.env.ADMIN_TELEGRAM_IDS
const adminUser = { id: 793536041, firstName: 'Admin', username: null, lastName: null }
delete process.env.ADMIN_TELEGRAM_IDS
assert.equal(isMiniAppAdmin(adminUser), true)
process.env.ADMIN_TELEGRAM_IDS = ''
assert.equal(isMiniAppAdmin(adminUser), false)
process.env.ADMIN_TELEGRAM_IDS = ' , 123456789, nope, 99999999999999999999, 123456789 '
assert.equal(isMiniAppAdmin(adminUser), false)
assert.equal(isMiniAppAdmin({ ...adminUser, id: 123456789 }), true)
process.env.ADMIN_TELEGRAM_IDS = configuredAdmins

const secret = createHmac('sha256', 'WebAppData').update(process.env.TELEGRAM_BOT_TOKEN).digest()
function signedFields(fields) {
  const params = new URLSearchParams(fields)
  const data = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join('\n')
  params.set('hash', createHmac('sha256', secret).update(data).digest('hex'))
  return `tma ${params}`
}
function signed(id = 123456789) {
  return signedFields({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'Игрок' }) })
}
function request(path, body, auth = signed(), method = 'POST') {
  return new Request(`https://example.test/api/${path}`, { method, headers: auth ? { authorization: auth } : { 'x-dt-device': 'testdevice123' }, ...(body ? { body: JSON.stringify(body) } : {}) })
}

// Фиксированный вектор рассчитан отдельно Python hmac/hashlib: проверяем
// порядок полей, URL-декодирование и включение Telegram signature в HMAC.
const vector = new URLSearchParams({
  query_id: 'AA+/= тест',
  user: '{"id":444444444,"first_name":"Ёж & Co","last_name":"Тест","username":"test_user"}',
  signature: 'new-ed25519-signature',
  ab: 'second',
  a_B: 'first',
  auth_date: '1700000000',
  hash: 'f8f17774f2598fe9f4cfd735cdb320004c4f172a45beaa8a1cd8ad8691c71313',
})
assert.deepEqual(await verifyInitData(vector.toString(), 4_000_000_000), {
  id: 444444444, firstName: 'Ёж & Co', lastName: 'Тест', username: 'test_user',
})
const alteredVector = new URLSearchParams(vector)
alteredVector.set('signature', 'changed')
await assert.rejects(verifyInitData(alteredVector.toString(), 4_000_000_000), (error) => error.status === 401)
await assert.rejects(verifyInitData(`${vector}&user=%7B%22id%22%3A1%7D`, 4_000_000_000), (error) => error.status === 401)
await assert.rejects(verifyInitData(`${vector}&hash=${vector.get('hash')}`, 4_000_000_000), (error) => error.status === 401)
const nowSeconds = Math.floor(Date.now() / 1000)
const minimalUser = JSON.stringify({ id: 444444444, first_name: 'Игрок' })
for (const fields of [
  { auth_date: String(nowSeconds - 601), user: minimalUser },
  { auth_date: String(nowSeconds + 60), user: minimalUser },
  { auth_date: `${nowSeconds}.1`, user: minimalUser },
  { auth_date: String(nowSeconds), user: 'null' },
  { auth_date: String(nowSeconds), user: JSON.stringify({ id: -1, first_name: 'Игрок' }) },
  { auth_date: String(nowSeconds), user: JSON.stringify({ id: '444444444', first_name: 'Игрок' }) },
  { auth_date: String(nowSeconds) },
]) {
  await assert.rejects(verifyInitData(signedFields(fields).slice(4)), (error) => error.status === 401)
}
assert.equal((await verifyInitData(signedFields({ auth_date: String(nowSeconds - 599), user: minimalUser }).slice(4))).id, 444444444)

await db.exec(`
  insert into courts (id, name, surface) values ('c', 'Корт 1', 'Хард'), ('other', 'Корт 2', 'Хард');
  insert into coaches (id, name, role, initials) values ('coach', 'Тренер', 'тренер', 'Т');
  insert into free_slots (id,court_id,day_offset,start_time,duration_min,price,starts_at) values
   ('a','c',1,'10:00',60,1000,((now() at time zone 'Europe/Moscow')::date + 1 + time '10:00') at time zone 'Europe/Moscow'),
   ('b','c',1,'11:00',60,2000,((now() at time zone 'Europe/Moscow')::date + 1 + time '11:00') at time zone 'Europe/Moscow'),
   ('gap','c',1,'14:00',60,3000,((now() at time zone 'Europe/Moscow')::date + 1 + time '14:00') at time zone 'Europe/Moscow'),
   ('other','other',1,'11:00',60,500,((now() at time zone 'Europe/Moscow')::date + 1 + time '11:00') at time zone 'Europe/Moscow');
  insert into training_sessions (id,title,group_kind,level,coach_id,court_id,day_offset,start_time,duration_min,price,seats_total,starts_at)
   values ('lesson','Настоящее занятие','Группа','Новичок','coach','c',1,'13:00',60,1500,2,now() + interval '1 day'),
          ('editable','Для изменения времени','Группа','Новичок','coach','c',1,'13:00',60,1500,2,now() + interval '1 day');
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
const edited = await updateSession('editable', { start: '20:00' }, 123)
assert.equal(edited.ok, true)
assert.deepEqual((await db.query("select start_time, to_char(starts_at at time zone 'Europe/Moscow', 'HH24:MI') as local_time from training_sessions where id='editable'")).rows[0], { start_time: '20:00', local_time: '20:00' })
assert.equal((await updateSession('editable', { start: '25:00' }, 123)).ok, false)
assert.equal((await updateSession('lesson', { start: '21:00' }, 123)).ok, false, 'нельзя менять время у занятого урока')
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
const telegramCalls = []
const originalFetch = globalThis.fetch
let failTelegramMethod = null
globalThis.fetch = async (url, init) => {
  telegramCalls.push({ url: String(url), payload: JSON.parse(init.body) })
  if (failTelegramMethod && String(url).endsWith(`/${failTelegramMethod}`)) {
    return Response.json({ ok: false, error_code: 400, description: 'test Telegram failure' }, { status: 400 })
  }
  if (String(url).endsWith('/getFile')) return Response.json({ ok: true, result: { file_path: 'photos/test.jpg' } })
  return Response.json({ ok: true, result: true })
}
const adminId = 793536041
let updateSeq = 100
function botUpdate(payload) {
  return new Request('https://example.test/api/bot/webhook', {
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': 'test_secret' },
    body: JSON.stringify({ update_id: updateSeq++, ...payload }),
  })
}
function adminCallback(data) {
  return {
    callback_query: {
      id: `callback-${updateSeq}`,
      from: { id: adminId, first_name: 'Admin' },
      data,
      message: { message_id: 1, chat: { id: adminId, type: 'private' } },
    },
  }
}
function adminMessage(text) {
  return {
    message: {
      message_id: 2,
      from: { id: adminId, first_name: 'Admin' },
      chat: { id: adminId, type: 'private' },
      text,
    },
  }
}
async function botStep(payload) {
  const response = await webhook.fetch(botUpdate(payload))
  assert.equal(response.status, 200)
}

const beforeRepair = await db.query('select count(*)::int as count from training_sessions')
await botStep(adminCallback('repair'))
assert.ok(telegramCalls.some(({ payload }) => payload.text?.includes('отключено')))
assert.deepEqual(await db.query('select count(*)::int as count from training_sessions'), beforeRepair)

// Каждый вызов webhook загружает состояние из БД: эмуляция разных Vercel-инстансов.
// Продолжаем один черновик без повторного sesnue: шаги не должны теряться.
await botStep(adminCallback('sesnue'))
for (const [callback, text] of [
  ['sesname', 'Тренировка'],
  ['sesprice', '2500'],
  ['sesseats', '4'],
  ['sesdur', '65'],
  ['sesdays', '7'],
]) {
  await botStep(adminCallback(callback))
  await botStep(adminMessage(text))
}
const [stateRow] = (await db.query('select session_draft as draft, pending from bot_dialog_state where chat_id = $1', [adminId])).rows
assert.deepEqual(stateRow.draft, { days: 7, durationMin: 65, price: 2500, seats: 4, title: 'Тренировка' })
assert.equal(stateRow.pending, null)

await updateSession('editable', { start: '18:00' }, 123)
await botStep(adminCallback('sestime2:editable'))
await botStep(adminMessage('20:00'))
assert.deepEqual(
  (await db.query("select start_time, to_char(starts_at at time zone 'Europe/Moscow', 'HH24:MI') as local_time from training_sessions where id='editable'")).rows[0],
  { start_time: '20:00', local_time: '20:00' },
)
assert.equal((await db.query('select pending from bot_dialog_state where chat_id = $1', [adminId])).rows[0].pending, null)

// Некорректное значение не теряет шаг, а «Отмена» возвращает к сохранённому черновику.
await botStep(adminCallback('sestime'))
telegramCalls.length = 0
await botStep(adminMessage('25:00'))
assert.match(telegramCalls.at(-1).payload.text, /ЧЧ:ММ/)
assert.equal((await db.query('select pending from bot_dialog_state where chat_id = $1', [adminId])).rows[0].pending.field, 'time')
await botStep(adminMessage('09:00'))
assert.equal((await db.query('select session_draft as draft from bot_dialog_state where chat_id = $1', [adminId])).rows[0].draft.time, '09:00')
await botStep(adminCallback('sesprice'))
await botStep(adminMessage('-5'))
assert.equal((await db.query('select pending from bot_dialog_state where chat_id = $1', [adminId])).rows[0].pending.field, 'price')
await botStep(adminMessage('2 500'))
await botStep(adminCallback('sesname'))
await botStep(adminCallback('sesresume'))
const resumed = (await db.query('select session_draft as draft, pending from bot_dialog_state where chat_id = $1', [adminId])).rows[0]
assert.equal(resumed.pending, null)
assert.equal(resumed.draft.title, 'Тренировка')
assert.equal(resumed.draft.price, 2500)

// Фото нового товара переживает несколько update и сохраняется без токена бота.
await botStep(adminCallback('prodnue'))
await botStep(adminCallback('newname'))
await botStep(adminMessage('Тестовый товар'))
await botStep(adminCallback('newprice'))
await botStep(adminCallback('prodresume'))
assert.equal((await db.query('select product_draft as draft from bot_dialog_state where chat_id = $1', [adminId])).rows[0].draft.title, 'Тестовый товар')
await botStep(adminCallback('newprice'))
await botStep(adminMessage('1200'))
await botStep(adminCallback('newcatset:1'))
await botStep(adminCallback('newphoto'))
function adminPhoto(size) {
  return {
    message: {
      message_id: 5,
      from: { id: adminId, first_name: 'Admin' },
      chat: { id: adminId, type: 'private' },
      photo: [{ file_id: 'photo_file_id', file_unique_id: 'unique', width: 300, height: 300, file_size: size }],
    },
  }
}
await botStep(adminPhoto(6 * 1024 * 1024))
assert.equal((await db.query('select pending from bot_dialog_state where chat_id = $1', [adminId])).rows[0].pending.kind, 'productPhoto')
await botStep(adminPhoto(1024))
assert.equal((await db.query('select product_draft as draft, pending from bot_dialog_state where chat_id = $1', [adminId])).rows[0].draft.image, 'tg:photo_file_id')
assert.equal((await db.query('select pending from bot_dialog_state where chat_id = $1', [adminId])).rows[0].pending, null)
await botStep(adminCallback('newsave'))
const [createdProduct] = (await db.query("select id, image from products where title = 'Тестовый товар'")).rows
assert.ok(createdProduct)
assert.equal(createdProduct.image, 'tg:photo_file_id')
const catalogWithPhoto = await (await catalog.fetch(request('catalog', null, null, 'GET'))).json()
assert.ok(catalogWithPhoto.products.find((item) => item.id === createdProduct.id)?.image.startsWith('/api/image?product='))
assert.ok(!JSON.stringify(catalogWithPhoto).includes(process.env.TELEGRAM_BOT_TOKEN))

process.env.SETUP_TOKEN = 'migration-token'
const deniedMigration = await migrateBotState.fetch(new Request('https://example.test/api/admin/migrate-bot-state', { method: 'GET' }))
assert.equal(deniedMigration.status, 401)
const migration = await migrateBotState.fetch(new Request('https://example.test/api/admin/migrate-bot-state?token=migration-token', { method: 'GET' }))
assert.equal(migration.status, 200)
const migrationResult = await migration.json()
assert.equal(migrationResult.ok, true)
assert.equal(migrationResult.applied, 1)
assert.ok(String(migrationResult.table).includes('bot_dialog_state'))
// ADMIN_SETUP_TOKEN имеет приоритет, если заданы оба токена.
process.env.ADMIN_SETUP_TOKEN = 'admin-migration-token'
assert.equal((await migrateBotState.fetch(new Request('https://example.test/api/admin/migrate-bot-state?token=migration-token'))).status, 401)
assert.equal((await migrateBotState.fetch(new Request('https://example.test/api/admin/migrate-bot-state?token=admin-migration-token'))).status, 200)
delete process.env.ADMIN_SETUP_TOKEN

await db.exec('drop table bot_dialog_state')
telegramCalls.length = 0
await botStep(adminCallback('menu'))
assert.ok(telegramCalls.some(({ payload }) => payload.text?.includes('migrate-bot-state')))
const restored = await migrateBotState.fetch(new Request('https://example.test/api/admin/migrate-bot-state?token=migration-token', { method: 'GET' }))
assert.equal(restored.status, 200)

process.env.VITE_APP_URL = '[https://broken'
assert.throws(() => appUrl(), /VITE_APP_URL/)
telegramCalls.length = 0
const badAppSetup = await setup.fetch(new Request('https://example.test/api/bot/setup?mode=menu&token=migration-token'))
assert.equal(badAppSetup.status, 500)
assert.equal(telegramCalls.length, 0, 'неверный URL не должен приводить к перенастройке Telegram')
process.env.VITE_APP_URL = 'https://mini-seven-xi.vercel.app/'
assert.equal(appUrl(), 'https://mini-seven-xi.vercel.app')

const playerId = 123456789
function playerCallback(data) {
  return {
    callback_query: {
      id: `player-callback-${updateSeq}`,
      from: { id: playerId, first_name: 'Игрок' },
      data,
      message: { message_id: 3, chat: { id: playerId, type: 'private' } },
    },
  }
}
function playerMessage(text) {
  return {
    message: {
      message_id: 4,
      from: { id: playerId, first_name: 'Игрок' },
      chat: { id: playerId, type: 'private' },
      text,
    },
  }
}
function lastKeyboard(payload) {
  return payload.reply_markup?.inline_keyboard?.flat() ?? []
}
function assertMiniAppButton(payload) {
  const buttons = lastKeyboard(payload)
  assert.ok(buttons.some((button) => button.web_app?.url === 'https://mini-seven-xi.vercel.app' && !button.url))
  assert.ok(!buttons.some((button) => button.url === 'https://mini-seven-xi.vercel.app'), 'кнопка Mini App не должна быть обычной ссылкой')
}

// Роли: /start и команды дают разные экраны, а web_app открывает Mini App в Telegram.
telegramCalls.length = 0
await botStep(playerMessage('/start'))
const playerStart = telegramCalls.at(-1).payload
assert.match(playerStart.text, /ДТ · Теннисный клуб/)
assert.ok(!playerStart.text.includes('Панель клуба'))
assertMiniAppButton(playerStart)
assert.ok(lastKeyboard(playerStart).some((button) => button.callback_data === 'u:me'))

// Совпадение username не даёт прав: важен только неизменяемый числовой ID.
const legacyUsername = playerMessage('/start')
legacyUsername.message.from.username = 'legacy_admin'
telegramCalls.length = 0
await botStep(legacyUsername)
assert.match(telegramCalls.at(-1).payload.text, /Теннисный клуб/)
assert.doesNotMatch(telegramCalls.at(-1).payload.text, /Панель клуба/)
assert.equal(isMiniAppAdmin({ id: playerId, firstName: 'Игрок', username: 'legacy_admin', lastName: null }), false)
assert.equal(isMiniAppAdmin({ id: adminId, firstName: 'Admin', username: null, lastName: null }), true)

// В группах и чужих личных чатах персональные данные и панель не отправляются.
const groupAdmin = adminMessage('/start')
groupAdmin.message.chat = { id: -100123, type: 'supergroup' }
telegramCalls.length = 0
await botStep(groupAdmin)
assert.equal(telegramCalls.length, 1)
assert.match(telegramCalls[0].payload.text, /личном чате/)
assert.ok(!telegramCalls[0].payload.reply_markup)
const groupPlayer = playerMessage('/me')
groupPlayer.message.chat = { id: -100123, type: 'supergroup' }
telegramCalls.length = 0
await botStep(groupPlayer)
assert.match(telegramCalls[0].payload.text, /личном чате/)
assert.doesNotMatch(telegramCalls[0].payload.text, /Ваши записи/)
const foreignChat = playerCallback('u:me')
foreignChat.callback_query.message.chat = { id: adminId, type: 'private' }
telegramCalls.length = 0
await botStep(foreignChat)
assert.equal(telegramCalls.length, 1)
assert.ok(telegramCalls[0].url.endsWith('/answerCallbackQuery'))
assert.match(telegramCalls[0].payload.text, /личном чате/)

telegramCalls.length = 0
await botStep(adminMessage('/start'))
const adminStart = telegramCalls.at(-1).payload
assert.match(adminStart.text, /Панель клуба/)
assertMiniAppButton(adminStart)
assert.ok(lastKeyboard(adminStart).some((button) => button.callback_data === 'u:home'))

// Подделка admin-callback от обычного ID не открывает админский экран.
telegramCalls.length = 0
await botStep(playerCallback('day:0'))
assert.ok(telegramCalls.some(({ url, payload }) => url.includes('/answerCallbackQuery') && payload.text?.includes('администратору')))
assert.ok(!telegramCalls.some(({ url }) => url.includes('/editMessageText')))
for (const data of ['menu', 'orders', 'cancel:00000000-0000-0000-0000-000000000000', 'seatplus:lesson', 'sessave', 'slotsave', 'u:admin']) {
  const attempt = playerCallback(data)
  attempt.callback_query.from.username = 'legacy_admin'
  telegramCalls.length = 0
  await botStep(attempt)
  assert.ok(telegramCalls.some(({ url, payload }) => url.endsWith('/answerCallbackQuery') && payload.text?.includes('администратор')), data)
  assert.ok(!telegramCalls.some(({ url }) => url.endsWith('/editMessageText')), data)
}
const groupCancel = adminCallback(`cancel:${data.ids[1]}`)
groupCancel.callback_query.message.chat = { id: -100123, type: 'supergroup' }
const beforeGroupCancel = (await db.query('select status from bookings where id = $1', [data.ids[1]])).rows[0].status
telegramCalls.length = 0
await botStep(groupCancel)
assert.equal((await db.query('select status from bookings where id = $1', [data.ids[1]])).rows[0].status, beforeGroupCancel)
assert.match(telegramCalls[0].payload.text, /личном чате/)

telegramCalls.length = 0
await botStep(playerMessage('/today'))
const deniedCommand = telegramCalls.at(-1).payload
assert.match(deniedCommand.text, /только администратору/i)
assert.ok(!lastKeyboard(deniedCommand).some((button) => String(button.callback_data ?? '').startsWith('visited:')))

telegramCalls.length = 0
await botStep(playerMessage('/schedule'))
const playerSchedule = telegramCalls.at(-1).payload
assertMiniAppButton(playerSchedule)
assert.match(playerSchedule.text, /Расписание/)
assert.ok(lastKeyboard(playerSchedule).some((button) => button.callback_data === 'u:schedule:1'))
assert.ok(!lastKeyboard(playerSchedule).some((button) => button.callback_data === 'sesnue'))
telegramCalls.length = 0
await botStep(playerCallback('u:schedule:1'))
const tomorrowSchedule = telegramCalls.at(-1).payload
assert.match(tomorrowSchedule.text, /На месяц/)
assert.ok(lastKeyboard(tomorrowSchedule).some((button) => button.callback_data === 'u:schedule:2'))
telegramCalls.length = 0
await botStep(playerCallback('u:schedule:29'))
assert.ok(lastKeyboard(telegramCalls.at(-1).payload).some((button) => button.callback_data === 'u:schedule:29'))
assert.ok(lastKeyboard(telegramCalls.at(-1).payload).some((button) => button.callback_data === 'u:schedule:28'))

// При ошибке БД игрок получает только общее сообщение, не SQL и не ссылку миграции.
failDbQuery = /from bookings b\s+join users u/i
telegramCalls.length = 0
await botStep(playerCallback('u:me'))
failDbQuery = null
assert.ok(telegramCalls.some(({ url, payload }) => url.endsWith('/answerCallbackQuery') && payload.text?.includes('Попробуйте')))
const playerError = telegramCalls.at(-1).payload
assert.match(playerError.text, /Временно недоступно/)
assert.doesNotMatch(playerError.text, /database diagnostics|migrate-bot-state|health/i)

telegramCalls.length = 0
await botStep(playerMessage('/me'))
const playerBookings = telegramCalls.at(-1).payload
assertMiniAppButton(playerBookings)
assert.match(playerBookings.text, /Ваши записи/)
assert.ok(lastKeyboard(playerBookings).some((button) => String(button.callback_data ?? '').startsWith('u:cancelask:')))

// Игрок отменяет только свою будущую запись, с подтверждением.
const [ownBooking] = (await db.query(`
  select b.id, b.kind, b.source_id as "sourceId"
  from bookings b join users u on u.id = b.user_id
  where u.telegram_id = $1 and b.status = 'active' and b.starts_at > now()
  order by b.starts_at limit 1
`, [playerId])).rows
assert.ok(ownBooking, 'у игрока должна быть активная будущая запись')
telegramCalls.length = 0
await botStep(playerCallback(`u:cancelask:${ownBooking.id}`))
const cancelConfirm = telegramCalls.at(-1).payload
assert.match(cancelConfirm.text, /Отменить запись/)
assert.ok(lastKeyboard(cancelConfirm).some((button) => button.callback_data === `u:cancel:${ownBooking.id}`))
assert.equal((await db.query('select status from bookings where id = $1', [ownBooking.id])).rows[0].status, 'active')

telegramCalls.length = 0
await botStep(playerCallback(`u:cancel:${ownBooking.id}`))
assert.equal((await db.query('select status from bookings where id = $1', [ownBooking.id])).rows[0].status, 'cancelled')
assert.ok(telegramCalls.some(({ url, payload }) => url.includes('/answerCallbackQuery') && payload.text === 'Запись отменена'))
if (ownBooking.kind === 'free') {
  assert.equal((await db.query('select is_active from free_slots where id = $1', [ownBooking.sourceId])).rows[0].is_active, true)
} else {
  assert.ok(Number((await db.query('select seats_taken from training_sessions where id = $1', [ownBooking.sourceId])).rows[0].seats_taken) >= 0)
}

const [otherBooking] = (await db.query(`
  select b.id from bookings b join users u on u.id = b.user_id
  where u.telegram_id <> $1 and b.status = 'active' and b.starts_at > now() limit 1
`, [playerId])).rows
assert.ok(otherBooking, 'должна быть запись другого игрока')
await db.query('update bookings set title = $1 where id = $2', ['ЧУЖАЯ ПРИВАТНАЯ ЗАПИСЬ', otherBooking.id])
await db.query(`
  insert into orders (user_id, product_id, quantity, price)
  select user_id, $1, 1, 1200 from bookings where id = $2
`, [createdProduct.id, otherBooking.id])
telegramCalls.length = 0
await botStep(playerMessage('/orders'))
assert.match(telegramCalls.at(-1).payload.text, /Ваши заказы/)
assert.match(telegramCalls.at(-1).payload.text, /Мячи/)
assert.doesNotMatch(telegramCalls.at(-1).payload.text, /Тестовый товар/)
telegramCalls.length = 0
await botStep(playerCallback('u:orders'))
assert.match(telegramCalls.at(-1).payload.text, /Ваши заказы/)
assert.doesNotMatch(telegramCalls.at(-1).payload.text, /Тестовый товар/)
telegramCalls.length = 0
await botStep(playerMessage('/me'))
assert.doesNotMatch(telegramCalls.at(-1).payload.text, /ЧУЖАЯ ПРИВАТНАЯ ЗАПИСЬ/)
telegramCalls.length = 0
await botStep(playerCallback(`u:cancel:${otherBooking.id}`))
assert.ok(telegramCalls.some(({ url, payload }) => url.includes('/answerCallbackQuery') && payload.text?.includes('не найдена')))
assert.equal((await db.query('select status from bookings where id = $1', [otherBooking.id])).rows[0].status, 'active')
telegramCalls.length = 0
await botStep(playerCallback(`u:cancelask:${otherBooking.id}`))
assert.match(telegramCalls.at(-1).payload.text, /недоступна для отмены/)
assert.ok(!lastKeyboard(telegramCalls.at(-1).payload).some((button) => button.callback_data === `u:cancel:${otherBooking.id}`))
telegramCalls.length = 0
await botStep(playerCallback('u:cancel:not-a-uuid'))
assert.ok(telegramCalls.some(({ url, payload }) => url.endsWith('/answerCallbackQuery') && payload.text?.includes('не найдена')))

// Отмена и освобождение окна атомарны: при ошибке освобождения запись остаётся активной.
const gapBookingResponse = await createBooking(request('bookings', { kind: 'free', sourceId: 'gap' }, signed(playerId)))
assert.equal(gapBookingResponse.status, 201, await gapBookingResponse.clone().text())
const gapBookingId = (await gapBookingResponse.json()).id
await db.exec("alter table free_slots add constraint test_prevent_release check (id <> 'gap' or not is_active)")
await assert.rejects(cancelOwnBooking(gapBookingId, playerId))
assert.equal((await db.query('select status from bookings where id = $1', [gapBookingId])).rows[0].status, 'active')
assert.equal((await db.query("select is_active from free_slots where id = 'gap'")).rows[0].is_active, false)
await db.exec('alter table free_slots drop constraint test_prevent_release')
const doubleCancel = await Promise.all([cancelOwnBooking(gapBookingId, playerId), cancelOwnBooking(gapBookingId, playerId)])
assert.deepEqual(doubleCancel.map((result) => result.ok).sort(), [false, true])
assert.equal((await db.query('select status from bookings where id = $1', [gapBookingId])).rows[0].status, 'cancelled')
assert.equal((await db.query("select is_active from free_slots where id = 'gap'")).rows[0].is_active, true)
assert.equal((await db.query("select count(*)::int as n from admin_audit where action = 'booking.self_cancel' and payload->>'bookingId' = $1", [gapBookingId])).rows[0].n, 1)

// Отмена занятия возвращает ровно одно место и повтор не уменьшает счётчик.
const [ownLesson] = (await db.query(`
  select b.id from bookings b join users u on u.id = b.user_id
  where u.telegram_id = $1 and b.kind = 'training' and b.source_id = 'lesson' and b.status = 'active'
`, [playerId])).rows
assert.ok(ownLesson)
const seatsBeforeCancel = (await db.query("select seats_taken from training_sessions where id = 'lesson'")).rows[0].seats_taken
assert.equal((await cancelOwnBooking(ownLesson.id, playerId)).ok, true)
assert.equal((await cancelOwnBooking(ownLesson.id, playerId)).ok, false)
assert.equal((await db.query("select seats_taken from training_sessions where id = 'lesson'")).rows[0].seats_taken, seatsBeforeCancel - 1)

// Старые версии могли ошибочно открыть окно с двумя активными бронями.
// Отмена одной из них не должна продавать окно, занятое вторым игроком.
await db.exec(`
  insert into free_slots (id,court_id,day_offset,start_time,duration_min,price,is_active,starts_at)
    values ('legacy-duplicate','c',1,'08:00',60,1000,false,now() + interval '1 day');
  insert into bookings (user_id,kind,source_id,title,day_offset,start_time,duration_min,price,starts_at)
    select u.id,'free',f.id,'legacy',1,f.start_time,f.duration_min,f.price,f.starts_at
    from users u cross join free_slots f where u.telegram_id in (123456789,300000001) and f.id='legacy-duplicate';
`)
const legacy = (await db.query(`
  select b.id, u.telegram_id as "telegramId" from bookings b join users u on u.id=b.user_id
  where b.source_id='legacy-duplicate' order by u.telegram_id
`)).rows
assert.equal(legacy.length, 2)
assert.equal((await cancelOwnBooking(legacy[0].id, Number(legacy[0].telegramId))).ok, true)
assert.equal((await db.query("select is_active from free_slots where id='legacy-duplicate'")).rows[0].is_active, false)
// Защитная проверка остаётся даже при испорченном старом флаге доступности.
await db.exec("update free_slots set is_active=true where id='legacy-duplicate'")
const legacyRace = await createBooking(request('bookings', { kind: 'free', sourceId: 'legacy-duplicate' }, signed(600000003)))
assert.equal(legacyRace.status, 409)
assert.equal((await closeSlot('legacy-duplicate', adminId)).ok, false)
await db.exec("update free_slots set is_active=false where id='legacy-duplicate'")
assert.equal((await cancelAsAdmin(legacy[1].id, adminId)).ok, true)
assert.equal((await db.query("select is_active from free_slots where id='legacy-duplicate'")).rows[0].is_active, true)

// Действия администратора с ресурсами и бронями выполняются согласованно.
await db.exec(`
  insert into courts (id, name, surface) values ('admin-court', 'Тестовый корт', 'Хард'), ('admin-other', 'Другой тестовый', 'Хард');
  insert into free_slots (id, court_id, day_offset, start_time, duration_min, price, starts_at) values
    ('admin-slot', 'admin-court', 29, '09:00', 60, 1000, now() + interval '2 days'),
    ('fail-slot', 'admin-court', 0, '10:00', 60, 1000, now() + interval '2 days'),
    ('load-expired', 'admin-court', 0, '11:00', 60, 1000, now() - interval '1 day'),
    ('load-late', 'admin-court', 0, '12:00', 60, 1000, now() + interval '12 days');
  insert into training_sessions (id,title,group_kind,level,coach_id,court_id,day_offset,start_time,duration_min,price,seats_total,starts_at) values
    ('admin-lesson','Админ-занятие','Группа','Новичок','coach','admin-court',1,'15:00',60,1000,2,now() + interval '2 days'),
    ('fail-session','Ошибка вставки','Группа','Новичок','coach','admin-court',1,'16:00',60,1000,1,now() + interval '2 days');
`)
await db.exec("alter table bookings add constraint test_no_manual_insert check (source_id not in ('fail-slot', 'fail-session'))")
await assert.rejects(closeSlot('fail-slot', adminId))
assert.equal((await db.query("select is_active from free_slots where id = 'fail-slot'")).rows[0].is_active, true)
await assert.rejects(reserveSeat('fail-session', adminId))
assert.equal((await db.query("select seats_taken from training_sessions where id = 'fail-session'")).rows[0].seats_taken, 0)
await db.exec('alter table bookings drop constraint test_no_manual_insert')
// Если не записался журнал, операция и захват места/окна откатываются вместе.
await db.exec('alter table admin_audit add constraint test_no_audit check (telegram_id <> 444444444)')
await assert.rejects(closeSlot('fail-slot', 444444444))
await assert.rejects(reserveSeat('fail-session', 444444444))
assert.equal((await db.query("select is_active from free_slots where id = 'fail-slot'")).rows[0].is_active, true)
assert.equal((await db.query("select seats_taken from training_sessions where id = 'fail-session'")).rows[0].seats_taken, 0)
assert.equal((await db.query("select count(*)::int as n from bookings where source_id in ('fail-slot', 'fail-session')")).rows[0].n, 0)
await db.exec('alter table admin_audit drop constraint test_no_audit')

assert.equal((await closeSlot('admin-slot', adminId)).ok, true)
assert.equal((await closeSlot('admin-slot', adminId)).ok, false)
const manualSlotBooking = (await db.query("select id from bookings where source_id = 'admin-slot' and user_id is null and status = 'active'")).rows[0]
assert.ok(manualSlotBooking)
assert.equal((await openSlot('admin-slot', adminId)).ok, true)
assert.equal((await db.query('select status from bookings where id = $1', [manualSlotBooking.id])).rows[0].status, 'cancelled')
assert.equal((await openSlot('admin-slot', adminId)).ok, false)
assert.equal((await restoreBooking(manualSlotBooking.id, adminId)).ok, true)
assert.equal((await restoreBooking(manualSlotBooking.id, adminId)).ok, false)
assert.equal((await db.query("select is_active from free_slots where id = 'admin-slot'")).rows[0].is_active, false)
assert.equal((await openSlot('admin-slot', adminId)).ok, true)

const occupiedResponse = await createBooking(request('bookings', { kind: 'free', sourceId: 'admin-slot' }, signed(600000000)))
assert.equal(occupiedResponse.status, 201, await occupiedResponse.clone().text())
const occupiedId = (await occupiedResponse.json()).id
assert.equal((await openSlot('admin-slot', adminId)).ok, false, 'нельзя открыть окно занятого игрока')
assert.equal((await deleteSlot('admin-slot', adminId)).ok, false, 'нельзя удалить занятое окно')
assert.equal((await restoreBooking(manualSlotBooking.id, adminId)).ok, false, 'нельзя восстановить бронь на занятое окно')
await db.exec("alter table free_slots add constraint test_admin_prevent_release check (id <> 'admin-slot' or not is_active)")
await assert.rejects(cancelAsAdmin(occupiedId, adminId))
assert.equal((await db.query('select status from bookings where id = $1', [occupiedId])).rows[0].status, 'active')
assert.equal((await db.query("select is_active from free_slots where id = 'admin-slot'")).rows[0].is_active, false)
await db.exec('alter table free_slots drop constraint test_admin_prevent_release')
assert.equal((await cancelAsAdmin(occupiedId, adminId)).ok, true)
assert.equal((await cancelAsAdmin(occupiedId, adminId)).ok, false)
assert.equal((await db.query("select is_active from free_slots where id = 'admin-slot'")).rows[0].is_active, true)

// Восстановление и повторный захват окна также откатываются вместе.
await db.exec(`alter table bookings add constraint test_no_restore check (id <> '${manualSlotBooking.id}'::uuid or status <> 'active')`)
await assert.rejects(restoreBooking(manualSlotBooking.id, adminId))
assert.equal((await db.query('select status from bookings where id = $1', [manualSlotBooking.id])).rows[0].status, 'cancelled')
assert.equal((await db.query("select is_active from free_slots where id = 'admin-slot'")).rows[0].is_active, true)
await db.exec('alter table bookings drop constraint test_no_restore')
const competingRestores = await Promise.all([
  restoreBooking(manualSlotBooking.id, adminId),
  restoreBooking(occupiedId, adminId),
])
assert.deepEqual(competingRestores.map((result) => result.ok).sort(), [false, true])
assert.equal((await db.query("select count(*)::int as n from bookings where source_id = 'admin-slot' and status = 'active'")).rows[0].n, 1)
assert.equal((await db.query("select is_active from free_slots where id = 'admin-slot'")).rows[0].is_active, false)
const load = await courtLoad()
assert.deepEqual(load.find((row) => row.court === 'Тестовый корт'), { court: 'Тестовый корт', surface: 'Хард', booked: 1, open: 1 })
assert.deepEqual(load.find((row) => row.court === 'Другой тестовый'), { court: 'Другой тестовый', surface: 'Хард', booked: 0, open: 0 })

assert.equal((await reserveSeat('admin-lesson', adminId)).ok, true)
assert.equal((await reserveSeat('admin-lesson', adminId)).ok, true)
assert.equal((await reserveSeat('admin-lesson', adminId)).ok, false)
const manualSeats = (await db.query("select id from bookings where source_id = 'admin-lesson' and status = 'active' order by id")).rows
assert.equal(manualSeats.length, 2)
assert.equal((await cancelAsAdmin(manualSeats[0].id, adminId)).ok, true)
assert.equal((await restoreBooking(manualSeats[0].id, adminId)).ok, true)
assert.equal((await db.query("select seats_taken from training_sessions where id = 'admin-lesson'")).rows[0].seats_taken, 2)
assert.equal((await cancelAsAdmin(manualSeats[0].id, adminId)).ok, true)
const filledSeatResponse = await createBooking(request('bookings', { kind: 'training', sourceId: 'admin-lesson' }, signed(600000001)))
assert.equal(filledSeatResponse.status, 201, await filledSeatResponse.clone().text())
const filledSeatId = (await filledSeatResponse.json()).id
assert.equal((await restoreBooking(manualSeats[0].id, adminId)).ok, false, 'занятие уже заполнено')
assert.equal((await db.query("select seats_taken from training_sessions where id = 'admin-lesson'")).rows[0].seats_taken, 2)
assert.equal((await cancelAsAdmin(filledSeatId, adminId)).ok, true)
assert.equal((await restoreBooking(manualSeats[0].id, adminId)).ok, true)
assert.equal((await cancelAsAdmin(manualSeats[0].id, adminId)).ok, true)
assert.equal((await cancelAsAdmin(manualSeats[1].id, adminId)).ok, true)

// Нельзя восстановить старую запись, когда тот же игрок уже записался повторно.
const newLessonResponse = await createBooking(request('bookings', { kind: 'training', sourceId: 'admin-lesson' }, signed(600000001)))
assert.equal(newLessonResponse.status, 201, await newLessonResponse.clone().text())
assert.equal((await restoreBooking(filledSeatId, adminId)).ok, false)
assert.equal((await db.query("select seats_taken from training_sessions where id = 'admin-lesson'")).rows[0].seats_taken, 1)
assert.equal((await cancelAsAdmin((await newLessonResponse.json()).id, adminId)).ok, true)
assert.equal((await restoreBooking(filledSeatId, adminId)).ok, true)
assert.equal((await db.query("select seats_taken from training_sessions where id = 'admin-lesson'")).rows[0].seats_taken, 1)

// Ручной минус не отменяет/не освобождает места реальных игроков.
assert.equal((await cancelManualSeat('admin-lesson', adminId)).ok, false)
assert.equal((await markVisited(filledSeatId, adminId)).ok, false, 'будущую запись нельзя отметить посещённой')
telegramCalls.length = 0
await botStep(adminCallback('seatplus:admin-lesson'))
assert.ok(telegramCalls.at(-1).payload.text.includes(clubDate(2)), 'дата занятия сохраняется после кнопки')
assert.equal((await db.query("select seats_taken from training_sessions where id = 'admin-lesson'")).rows[0].seats_taken, 2)
assert.equal((await db.query("select count(*)::int as n from bookings where source_id = 'admin-lesson' and user_id is null and status = 'active'")).rows[0].n, 1)
assert.equal((await updateSession('admin-lesson', { seatsTotal: 1 }, adminId)).ok, false, 'число мест не меньше занятых')
assert.equal((await updateSession('admin-lesson', { start: '20:00' }, adminId)).ok, false, 'нельзя менять время у записанных игроков')
telegramCalls.length = 0
await botStep(adminCallback('seats:admin-lesson'))
assert.ok(telegramCalls.at(-1).payload.text.includes(clubDate(2)), 'дата сохраняется после отмены записи ресепшена')
assert.equal((await db.query("select seats_taken from training_sessions where id = 'admin-lesson'")).rows[0].seats_taken, 1)
assert.equal((await db.query('select status from bookings where id = $1', [filledSeatId])).rows[0].status, 'active')
assert.equal((await cancelManualSeat('admin-lesson', adminId)).ok, false)
assert.equal((await updateSession('admin-lesson', { seatsTotal: 1 }, adminId)).ok, true)
assert.equal((await db.query("select seats_total from training_sessions where id = 'admin-lesson'")).rows[0].seats_total, 1)

// Занятие с записью не удаляется: вместо этого снимается с продажи.
assert.equal((await deleteSession('admin-lesson', adminId)).ok, true)
assert.deepEqual((await db.query("select is_active, seats_taken from training_sessions where id = 'admin-lesson'")).rows[0], { is_active: false, seats_taken: 1 })
assert.equal((await db.query('select status from bookings where id = $1', [filledSeatId])).rows[0].status, 'active')
await db.query("update bookings set starts_at = now() - interval '1 minute' where id = $1", [filledSeatId])
assert.equal((await markVisited(filledSeatId, adminId)).ok, true)
assert.equal((await markVisited(filledSeatId, adminId)).ok, false)
assert.equal((await db.query('select status from bookings where id = $1', [filledSeatId])).rows[0].status, 'visited')
// Старую бронь нельзя восстановить после изменения времени занятия.
const changingResponse = await createBooking(request('bookings', { kind: 'training', sourceId: 'editable' }, signed(600000002)))
assert.equal(changingResponse.status, 201, await changingResponse.clone().text())
const changingId = (await changingResponse.json()).id
assert.equal((await cancelAsAdmin(changingId, adminId)).ok, true)
assert.equal((await updateSession('editable', { start: '19:30' }, adminId)).ok, true)
assert.equal((await restoreBooking(changingId, adminId)).ok, false)
assert.equal((await db.query('select status from bookings where id = $1', [changingId])).rows[0].status, 'cancelled')
assert.equal((await db.query("select seats_taken from training_sessions where id = 'editable'")).rows[0].seats_taken, 0)

assert.equal((await restoreBooking('not-a-uuid', adminId)).ok, false)
assert.equal((await cancelAsAdmin('not-a-uuid', adminId)).ok, false)

// Метка в карточке не даёт прав и явно отличается от доступа по ID.
await db.query("update users set role = 'admin' where telegram_id = $1", [playerId])
telegramCalls.length = 0
await botStep(adminCallback('users'))
assert.match(telegramCalls.at(-1).payload.text, /метка: админ/)
assert.doesNotMatch(telegramCalls.at(-1).payload.text, /доступ: администратор/)
telegramCalls.length = 0
await botStep(playerMessage('/start'))
assert.match(telegramCalls.at(-1).payload.text, /Теннисный клуб/)
await db.query("update users set role = 'player' where telegram_id = $1", [playerId])

// Админ может проверить вид игрока и вернуться в панель.
telegramCalls.length = 0
await botStep(adminCallback('u:home'))
const adminPreview = telegramCalls.at(-1).payload
assert.match(adminPreview.text, /Теннисный клуб/)
assert.ok(lastKeyboard(adminPreview).some((button) => button.callback_data === 'u:admin'))
telegramCalls.length = 0
await botStep(adminCallback('u:admin'))
assert.match(telegramCalls.at(-1).payload.text, /Панель клуба/)

// Mini App использует тот же список числовых ID, что и бот.
const adminMe = await me.fetch(request('me', null, signed(adminId), 'GET'))
assert.equal(adminMe.status, 200)
assert.equal((await adminMe.json()).user.isAdmin, true)
const playerMe = await me.fetch(request('me', null, signed(playerId), 'GET'))
assert.equal(playerMe.status, 200)
assert.equal((await playerMe.json()).user.isAdmin, false)
assert.equal((await me.fetch(request('me', null, null, 'GET'))).status, 401)

// Setup: web_app-кнопка меню и раздельные command scopes.
telegramCalls.length = 0
const setupResponse = await setup.fetch(new Request('https://example.test/api/bot/setup?token=migration-token', { method: 'GET' }))
assert.equal(setupResponse.status, 200)
const setupResult = await setupResponse.json()
assert.equal(setupResult.ok, true)
assert.equal(setupResult.appUrl, 'https://mini-seven-xi.vercel.app')
assert.equal(setupResult.menuButtonConfigured, true)
assert.ok(setupResult.steps.some((item) => item.step === 'setChatMenuButton' && item.ok))
assert.ok(setupResult.steps.some((item) => item.step === 'setMyCommands:players' && item.ok))
assert.ok(setupResult.steps.some((item) => item.step === 'setMyCommands:admin' && item.ok))
const menuCall = telegramCalls.find(({ url }) => url.endsWith('/setChatMenuButton'))
assert.equal(menuCall.payload.menu_button.type, 'web_app')
assert.equal(menuCall.payload.menu_button.web_app.url, 'https://mini-seven-xi.vercel.app')
assert.equal(menuCall.payload.menu_button.url, undefined)
const commandCalls = telegramCalls.filter(({ url }) => url.endsWith('/setMyCommands'))
assert.ok(commandCalls.some(({ payload }) => payload.scope?.type === 'default' && payload.commands.some((c) => c.command === 'orders' && c.description === 'Мои заказы') && !payload.commands.some((c) => c.command === 'today')))
assert.ok(commandCalls.some(({ payload }) => payload.scope?.type === 'all_private_chats' && payload.commands.some((c) => c.command === 'start')))
assert.ok(commandCalls.some(({ payload }) => payload.scope?.type === 'chat' && payload.scope.chat_id === adminId && payload.commands.some((c) => c.command === 'orders')))
const webhookCall = telegramCalls.find(({ url }) => url.endsWith('/setWebhook'))
assert.equal(webhookCall.payload.secret_token, 'test_secret')
assert.equal(webhookCall.payload.drop_pending_updates, true)

// Обновить меню можно отдельно: webhook и ожидающие апдейты не затрагиваются.
telegramCalls.length = 0
const menuOnly = await setup.fetch(new Request('https://example.test/api/bot/setup?mode=menu&token=migration-token'))
assert.equal(menuOnly.status, 200)
assert.equal((await menuOnly.json()).webhookConfigured, null)
assert.ok(!telegramCalls.some(({ url }) => url.endsWith('/setWebhook')))
telegramCalls.length = 0
const wrongMode = await setup.fetch(new Request('https://example.test/api/bot/setup?mode=typo&token=migration-token'))
assert.equal(wrongMode.status, 400)
assert.equal(telegramCalls.length, 0)
failTelegramMethod = 'setChatMenuButton'
const failedMenu = await setup.fetch(new Request('https://example.test/api/bot/setup?mode=menu&token=migration-token'))
assert.equal(failedMenu.status, 502)
const failedMenuResult = await failedMenu.json()
assert.equal(failedMenuResult.ok, false)
assert.ok(failedMenuResult.steps.some((step) => step.step === 'setChatMenuButton' && !step.ok))
failTelegramMethod = null

// Таблица состояний нужна только администратору, пользовательское меню работает и без неё.
await db.exec('drop table bot_dialog_state')
telegramCalls.length = 0
await botStep(playerMessage('/start'))
assert.match(telegramCalls.at(-1).payload.text, /Теннисный клуб/)
telegramCalls.length = 0
await botStep(playerMessage('/me'))
assert.match(telegramCalls.at(-1).payload.text, /Ваши записи/)

// Telegram-имя экранируется в HTML-сообщениях.
const htmlName = playerMessage('/start')
htmlName.message.from.first_name = '<Игрок & друг>'
telegramCalls.length = 0
await botStep(htmlName)
assert.ok(telegramCalls.at(-1).payload.text.includes('&lt;Игрок &amp; друг&gt;'))

// Полная цепочка: web_app → подписанный initData → короткая сессия → свой ID.
// Ни произвольный device key, ни initDataUnsafe без подписи не создают сессию.
const sessionId = 444444444
const telegramAuth = signedFields({
  auth_date: String(Math.floor(Date.now() / 1000)),
  query_id: 'test-query',
  signature: 'new-ed25519-signature',
  user: JSON.stringify({ id: sessionId, first_name: 'Елена', last_name: 'Игрокова', username: 'elena_test' }),
})
assert.equal((await me.fetch(request('me', null, null, 'POST'))).status, 401)
assert.equal((await me.fetch(new Request('https://example.test/api/me', { method: 'POST' }))).status, 401)
assert.equal((await me.fetch(request('me', null, 'tma user=%7B%22id%22%3A444444444%7D', 'POST'))).status, 401)
assert.equal((await me.fetch(request('me', null, `${telegramAuth}&auth_date=1`, 'POST'))).status, 401)
const invalidHash = new URLSearchParams(telegramAuth.slice(4))
invalidHash.set('user', JSON.stringify({ id: adminId, first_name: 'Подмена' }))
assert.equal((await me.fetch(request('me', null, `tma ${invalidHash}`, 'POST'))).status, 401)
assert.equal((await me.fetch(request('me', null, signedFields({ auth_date: String(nowSeconds - 601), user: minimalUser }), 'POST'))).status, 401)
assert.equal((await db.query('select count(*)::int as n from users where telegram_id = $1', [sessionId])).rows[0].n, 0)

const sessionStartedAt = Date.now()
const sessionResponse = await me.fetch(request('me', null, telegramAuth, 'POST'))
assert.equal(sessionResponse.status, 200)
assert.equal(sessionResponse.headers.get('cache-control'), 'no-store')
const issued = await sessionResponse.json()
assert.equal(issued.expiresIn, 7200)
assert.deepEqual(issued.user, { id: sessionId, firstName: 'Елена', lastName: 'Игрокова' })
assert.ok(issued.token && !issued.token.includes(process.env.TELEGRAM_BOT_TOKEN))
const sessionAuth = `tma-session ${issued.token}`
assert.equal((await me.fetch(request('me', null, sessionAuth, 'POST'))).status, 401, 'сессию нельзя продлевать самой сессией')
const sessionMe = await me.fetch(request('me', null, sessionAuth, 'GET'))
assert.equal(sessionMe.status, 200)
assert.equal((await sessionMe.json()).user.id, sessionId)
assert.equal((await client.fetch(request('client', null, sessionAuth, 'GET'))).status, 200)

const [encodedPayload, signature] = issued.token.split('.')
const modifiedPayload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
modifiedPayload.user.id = adminId
const forgedToken = `${Buffer.from(JSON.stringify(modifiedPayload)).toString('base64url')}.${signature}`
assert.equal((await me.fetch(request('me', null, `tma-session ${forgedToken}`, 'GET'))).status, 401)
const changedSignature = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1)
assert.equal((await me.fetch(request('me', null, `tma-session ${encodedPayload}.${changedSignature}`, 'GET'))).status, 401)
assert.equal((await me.fetch(request('me', null, 'tma-session nonsense', 'GET'))).status, 401)
assert.equal((await me.fetch(new Request('https://other.example.test/api/me', { headers: { authorization: sessionAuth } }))).status, 401, 'сессия привязана к origin')
const originalToken = process.env.TELEGRAM_BOT_TOKEN
process.env.TELEGRAM_BOT_TOKEN = 'rotated-test-token'
assert.equal((await me.fetch(request('me', null, sessionAuth, 'GET'))).status, 401)
process.env.TELEGRAM_BOT_TOKEN = originalToken

await db.exec(`
  insert into free_slots (id,court_id,day_offset,start_time,duration_min,price,starts_at)
  values ('session-slot','c',1,'15:00',60,1900,now() + interval '1 day');
  insert into products (id,title,category,price) values ('session-product','Мячи для сессии','Мячи',500);
`)
const sessionBooking = await createBooking(request('bookings', { kind: 'free', sourceId: 'session-slot' }, sessionAuth))
assert.equal(sessionBooking.status, 201, await sessionBooking.clone().text())
const sessionBookingId = (await sessionBooking.json()).id
const sessionOrder = await createOrder(request('orders', { productId: 'session-product', name: 'Елена', phone: '+79991234567' }, sessionAuth))
assert.equal(sessionOrder.status, 201, await sessionOrder.clone().text())
const sessionOrderId = (await sessionOrder.json()).id
assert.equal((await db.query('select u.telegram_id from bookings b join users u on u.id = b.user_id where b.id = $1', [sessionBookingId])).rows[0].telegram_id, sessionId)
assert.equal((await db.query('select u.telegram_id from orders o join users u on u.id = o.user_id where o.id = $1', [sessionOrderId])).rows[0].telegram_id, sessionId)
assert.ok((await (await listBookings(request('bookings?mine=1', null, sessionAuth, 'GET'))).json()).bookings.some((item) => item.id === sessionBookingId))
assert.ok((await (await listOrders(request('orders', null, sessionAuth, 'GET'))).json()).orders.some((item) => item.id === sessionOrderId))

const otherSessionResponse = await me.fetch(request('me', null, signed(555555555), 'POST'))
const otherAuth = `tma-session ${(await otherSessionResponse.json()).token}`
assert.equal((await (await listBookings(request('bookings?mine=1', null, otherAuth, 'GET'))).json()).bookings.length, 0)
assert.equal((await (await listOrders(request('orders', null, otherAuth, 'GET'))).json()).orders.length, 0)
assert.equal((await cancelBooking(request(`bookings?id=${sessionBookingId}`, null, otherAuth, 'DELETE'))).status, 404)
assert.equal((await listOrders(request('orders', null, null, 'GET'))).status, 401)
assert.equal((await cancelBooking(request(`bookings?id=${sessionBookingId}`, null, null, 'DELETE'))).status, 401)

// Через 11 минут исходная подпись уже не годится для нового входа, но
// текущая сессия работает; через 2 часа она также отклоняется сервером.
const realNow = Date.now
try {
  Date.now = () => sessionStartedAt + 11 * 60 * 1000
  assert.equal((await me.fetch(request('me', null, telegramAuth, 'POST'))).status, 401)
  assert.equal((await listBookings(request('bookings?mine=1', null, sessionAuth, 'GET'))).status, 200)
  Date.now = () => sessionStartedAt + (2 * 60 * 60 + 2) * 1000
  assert.equal((await listBookings(request('bookings?mine=1', null, sessionAuth, 'GET'))).status, 401)
  assert.equal((await createOrder(request('orders', { productId: 'session-product', name: 'Елена', phone: '+79991234567' }, sessionAuth))).status, 401)
} finally {
  Date.now = realNow
}

globalThis.fetch = originalFetch
console.log('✓ PostgreSQL: Telegram, сессии, атомарная аренда, соседние окна, цена, отмена, роли и состояние бота')
await db.close()
