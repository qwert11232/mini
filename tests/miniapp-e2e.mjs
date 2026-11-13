import { registerHooks } from 'node:module'
import { readFile, readdir } from 'node:fs/promises'
import { createHmac } from 'node:crypto'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { PGlite } from '@electric-sql/pglite'

/** Production React bundle → реальные обработчики API → отдельная PGlite. */
const db = await PGlite.create()
const schema = (await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'))
  .replace('create extension if not exists "pgcrypto";', '')
await db.exec(schema)
await db.exec(`
  insert into courts (id, name, surface) values ('c1', 'Корт 1', 'Хард');
  insert into coaches (id, name, role, initials) values ('coach', 'Тренер', 'тренер', 'Т');
  insert into free_slots (id, court_id, day_offset, start_time, duration_min, price, starts_at) values
    ('slot-09', 'c1', 1, '09:00', 60, 2000, ((now() at time zone 'Europe/Moscow')::date + 1 + time '09:00') at time zone 'Europe/Moscow'),
    ('slot-10', 'c1', 1, '10:00', 60, 2500, ((now() at time zone 'Europe/Moscow')::date + 1 + time '10:00') at time zone 'Europe/Moscow');
  insert into products (id, title, category, price) values ('p1', 'Мячи E2E', 'Мячи', 500);
`)
const query = async (strings, ...values) => {
  const text = strings.reduce((result, part, index) => result + part + (index < values.length ? `$${index + 1}` : ''), '')
  return (await db.query(text, values)).rows
}
query.query = async (text, values) => (await db.query(text, values)).rows
globalThis.__miniAppE2eDb = query
process.env.DATABASE_URL = 'postgres://user:pass@localhost/test'
process.env.TELEGRAM_BOT_TOKEN = 'miniapp-e2e-test-token'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@neondatabase/serverless') return { url: 'test:neon-miniapp', shortCircuit: true }
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.includes('/api/')) {
      return nextResolve(specifier.slice(0, -3) + '.ts', context)
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url === 'test:neon-miniapp') return { format: 'module', shortCircuit: true, source: 'export function neon() { return globalThis.__miniAppE2eDb }' }
    return nextLoad(url, context)
  },
})
const handlers = {
  '/api/me': (await import('../api/me.ts')).default,
  '/api/client': (await import('../api/client.ts')).default,
  '/api/catalog': (await import('../api/catalog.ts')).default,
  '/api/bookings': (await import('../api/bookings.ts')).default,
  '/api/orders': (await import('../api/orders.ts')).default,
}
const { appButton } = await import('../api/bot/_lib/app-url.ts')
const entryButton = appButton()
assert.ok(entryButton.web_app?.url.startsWith('https://'))
assert.equal(entryButton.url, undefined)

const userId = 654321987
const params = new URLSearchParams({
  query_id: 'test-query',
  auth_date: String(Math.floor(Date.now() / 1000)),
  user: JSON.stringify({ id: userId, first_name: 'Мария', last_name: 'Игрокова', username: 'maria_test' }),
  signature: 'ed25519-example',
})
const dataCheckString = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  .map(([key, value]) => `${key}=${value}`).join('\n')
const secret = createHmac('sha256', 'WebAppData').update(process.env.TELEGRAM_BOT_TOKEN).digest()
params.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'))
const initData = params.toString()

const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8')
const jsFile = (await readdir(new URL('../dist/assets/', import.meta.url))).find((file) => file.endsWith('.js'))
assert.ok(jsFile, 'сначала выполните npm run build')
const code = await readFile(new URL(`../dist/assets/${jsFile}`, import.meta.url), 'utf8')
const delay = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(condition, message, timeout = 5000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (condition()) return
    await delay(20)
  }
  throw new Error(`Таймаут: ${message}`)
}

function mount(rawInitData) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://mini.example.test/' })
  const { window } = dom
  window.Headers = Headers
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.scrollTo = () => {}
  window.Telegram = { WebApp: {
    initData: rawInitData,
    initDataUnsafe: { user: { id: 1, first_name: 'Чужое имя' } },
    platform: 'test', colorScheme: 'light', ready() {}, expand() {},
  } }
  const calls = []
  const errors = []
  window.addEventListener('error', (event) => errors.push(String(event.error || event.message)))
  window.fetch = async (url, init = {}) => {
    const target = new URL(String(url), window.location.href)
    const handler = handlers[target.pathname]
    assert.ok(handler, `неизвестный запрос ${target.pathname}`)
    const method = init.method ?? 'GET'
    const headers = new Headers(init.headers)
    const req = new Request(target, { method, headers, ...(init.body ? { body: init.body } : {}) })
    const res = await handler.fetch(req)
    calls.push({ path: target.pathname, method, headers, status: res.status, cacheControl: res.headers.get('cache-control') })
    return res
  }
  new window.Function('document', 'window', 'globalThis', code.replace(/^\s*export\s+/gm, ''))(
    window.document, window, window,
  )
  const root = window.document.getElementById('root')
  const click = async (element, name) => {
    assert.ok(element, `${name} найден`)
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    await delay(60)
  }
  return { dom, window, root, calls, errors, click }
}

try {
  const app = mount(initData)
  try {
    await waitFor(() => app.root.textContent.includes('уже готов'), 'реальный сервер подтвердил пользователя')
    assert.match(app.root.textContent, /Привет, Мария/)
    assert.doesNotMatch(app.root.textContent, /Чужое имя/)
    assert.ok(app.calls.some((call) => call.path === '/api/me' && call.method === 'POST' && call.status === 200))
    for (const call of app.calls) {
      if (call.path === '/api/me') assert.equal(call.headers.get('authorization'), `tma ${initData}`)
      else if (call.path === '/api/catalog') assert.equal(call.headers.get('authorization'), null)
      else assert.match(call.headers.get('authorization'), /^tma-session /)
      assert.equal(call.headers.get('x-dt-device'), null)
      assert.equal(call.cacheControl, 'no-store')
    }
    assert.equal((await db.query('select telegram_id from users where telegram_id = $1', [userId])).rows.length, 1)
    assert.equal((await db.query('select count(*)::int as n from users where telegram_id = 1')).rows[0].n, 0)

    await app.click([...app.root.querySelectorAll('.tab')].find((button) => button.textContent.includes('Игра')), 'Игра')
    await app.click(app.root.querySelectorAll('.day-chip')[1], 'завтра')
    await app.click(app.root.querySelector('.slot'), 'окно')
    await app.click([...app.root.querySelectorAll('[role="group"] button')].find((button) => button.textContent.includes('2 ч')), 'два часа')
    await app.click(app.root.querySelector('.sheet-layer.is-open .sheet-footer .btn-primary'), 'подтверждение брони')
    await waitFor(() => app.calls.some((call) => call.path === '/api/bookings' && call.method === 'POST' && call.status === 201), 'бронь через реальный API')
    await waitFor(() => app.calls.filter((call) => call.path === '/api/catalog' && call.status === 200).length >= 2 && app.root.querySelector('.tab'), 'обновлённый каталог')
    const bookings = (await db.query(`
      select u.telegram_id, b.source_id, b.price from bookings b join users u on u.id = b.user_id order by b.source_id
    `)).rows
    assert.deepEqual(bookings, [
      { telegram_id: userId, source_id: 'slot-09', price: 2000 },
      { telegram_id: userId, source_id: 'slot-10', price: 2500 },
    ])

    await app.click([...app.root.querySelectorAll('.tab')].find((button) => button.textContent.includes('Магазин')), 'Магазин')
    await app.click(app.root.querySelector('button.product-open'), 'товар')
    await app.click([...app.root.querySelectorAll('.sheet-layer.is-open .sheet-footer button')].find((button) => button.textContent.includes('Оформить')), 'оформить')
    const form = app.root.querySelector('#order-contact-form')
    assert.ok(form, 'форма заказа открыта')
    const phone = form.querySelector('input[type="tel"]')
    const valueSetter = Object.getOwnPropertyDescriptor(app.window.HTMLInputElement.prototype, 'value').set
    valueSetter.call(phone, '+7 999 123-45-67')
    phone.dispatchEvent(new app.window.Event('input', { bubbles: true }))
    await delay(50)
    form.dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }))
    await waitFor(() => app.calls.some((call) => call.path === '/api/orders' && call.method === 'POST' && call.status === 201), 'заказ через реальный API')
    const orders = (await db.query(`
      select u.telegram_id, o.product_id, o.price, o.contact_name, o.contact_phone
      from orders o join users u on u.id = o.user_id
    `)).rows
    assert.deepEqual(orders, [{ telegram_id: userId, product_id: 'p1', price: 500, contact_name: 'Мария', contact_phone: '+79991234567' }])
    assert.deepEqual(app.errors, [])
    console.log('✓ E2E: подписанные данные Telegram → React → настоящие API → бронь и заказ своего Telegram ID')
  } finally {
    app.dom.window.close()
  }

  const invalidParams = new URLSearchParams(initData)
  invalidParams.set('user', JSON.stringify({ id: 1, first_name: 'Чужое имя' }))
  const invalid = mount(invalidParams.toString())
  try {
    await waitFor(() => invalid.root.textContent.includes('Не удалось подтвердить вход'), 'поддельные данные отклонены')
    assert.ok(invalid.calls.every((call) => call.path === '/api/me' && call.status === 401))
    assert.equal((await db.query('select count(*)::int as n from users where telegram_id = 1')).rows[0].n, 0)
    assert.deepEqual(invalid.errors, [])
    console.log('✓ E2E: подмена пользователя блокируется до доступа к личным данным')
  } finally {
    invalid.dom.window.close()
  }
} finally {
  await db.close()
}
