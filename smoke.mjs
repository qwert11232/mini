import { JSDOM } from 'jsdom'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

/** Проверка production-бандла: вход, ошибки и ключевые экраны без живых сервисов. */
const html = fs.readFileSync('dist/index.html', 'utf8')
const bundle = fs.readdirSync('dist/assets').find((file) => file.endsWith('.js'))
assert.ok(bundle, 'сначала выполните npm run build')
const code = fs.readFileSync(path.join('dist/assets', bundle), 'utf8')
const rawInitData = 'query_id=test&user=%7B%22id%22%3A42%7D&hash=example'
const sessionToken = 'test-session-token'

const catalog = {
  courts: [
    { id: 'c1', name: 'Корт 1', surface: 'Крытый хард' },
    { id: 'c3', name: 'Корт 3', surface: 'Грунт' },
  ],
  coaches: [{ id: 'k1', name: 'Артём Соколов', role: 'Главный тренер · КМС', initials: 'АС', rating: 4.9 }],
  sessions: [{
    id: 's1', title: 'Группа · начальный уровень', group: 'Группа', level: 'Новичок',
    coachId: 'k1', courtId: 'c3', dayOffset: 1, start: '09:00', durationMin: 90, price: 1400,
    seatsTotal: 6, seatsTaken: 4,
  }],
  slots: [
    { id: 'c1-07:00', courtId: 'c1', dayOffset: 1, start: '07:00', durationMin: 60, price: 2000 },
    { id: 'c1-08:00', courtId: 'c1', dayOffset: 1, start: '08:00', durationMin: 60, price: 2500 },
  ],
  products: [{
    id: 'p1', title: 'Ракетка DT Control 300', subtitle: 'Баланс для любителя', category: 'Ракетки',
    price: 18900, image: '/img/shop-racket.jpg', colors: ['#1c6b43'],
  }],
}

const delay = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(condition, message, timeout = 3000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (condition()) return
    await delay(20)
  }
  throw new Error(`Таймаут: ${message}`)
}
function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}
function telegram(initData = rawInitData) {
  return {
    initData, initDataUnsafe: { user: { id: 999, first_name: 'Подмена' } },
    platform: 'test', colorScheme: 'light', ready() {}, expand() {},
    close() { this.closed = true },
    openTelegramLink(url) { this.openedLink = url },
  }
}
function mount({ webApp = null, state = {} } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://mini.example.test/' })
  const { window } = dom
  window.Headers = Headers
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.scrollTo = () => {}
  if (webApp) window.Telegram = { WebApp: webApp }
  const calls = []
  const errors = []
  window.localStorage.setItem('dt.bookings.v1', JSON.stringify([{ title: 'Старая демо-бронь' }]))
  window.addEventListener('error', (event) => errors.push(String(event.error || event.message)))
  window.fetch = async (url, init = {}) => {
    const target = new URL(String(url), window.location.href)
    const method = init.method ?? 'GET'
    const headers = new Headers(init.headers)
    const call = { path: target.pathname, method, headers, body: init.body ? JSON.parse(init.body) : null }
    calls.push(call)
    if (target.pathname === '/api/me' && method === 'POST') {
      if (state.sessionError) return response(state.sessionError, { error: 'Вход не выполнен' })
      return response(200, { token: sessionToken, expiresIn: state.expiresIn ?? 7200, user: { id: 42, firstName: 'Елена', lastName: 'Игрокова' } })
    }
    if (target.pathname === '/api/catalog') {
      if (state.catalogError) return response(state.catalogError, { error: 'Каталог недоступен' })
      return response(200, catalog)
    }
    if (target.pathname === '/api/client') {
      if (state.clientError) return response(state.clientError, { error: 'Профиль недоступен' })
      return response(200, { clientNo: 42, clientLabel: '№ 42', firstName: 'Елена', phone: null, hasPhone: false })
    }
    if (target.pathname === '/api/bookings') {
      if (method === 'POST') {
        if (state.bookingError) return response(state.bookingError, { error: 'Сессия устарела' })
        state.booked = true
        return response(201, { id: 'test' })
      }
      if (state.booked && state.bookingsReadErrorAfterCreate) return response(503, { error: 'Не удалось обновить записи' })
      return response(200, { bookings: [], user: { firstName: 'Елена' } })
    }
    if (target.pathname === '/api/orders') return response(200, { orders: [] })
    throw new Error(`Неожиданный запрос: ${method} ${target.pathname}`)
  }

  new window.Function('document', 'window', 'globalThis', code.replace(/^\s*export\s+/gm, ''))(
    window.document, window, window,
  )
  const root = window.document.getElementById('root')
  const click = async (element, label = 'элемент') => {
    assert.ok(element, `${label} найден`)
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    await delay(40)
  }
  return { dom, window, root, calls, errors, click }
}

// В браузере и в SDK без initData нельзя случайно открыть сайт или создать гостя.
for (const webApp of [null, telegram('')]) {
  const app = mount({ webApp })
  await waitFor(() => app.root.textContent.includes('Откройте в Telegram'), 'инструкция для браузера')
  assert.match(app.root.textContent, /@testtesttennisbot/)
  assert.match(app.root.textContent, /\/start/)
  assert.equal(app.calls.length, 0, 'до входа не отправляются запросы')
  assert.equal(app.root.querySelectorAll('a').length, 0, 'на экране нет ссылки на сайт')
  assert.equal(app.window.localStorage.getItem('dt.device.v1'), null)
  assert.deepEqual(app.errors, [])
  app.dom.window.close()
}
console.log('✓ обычный браузер и пустой initData: только инструкция, без запросов и гостя')

const rejected = mount({ webApp: telegram(), state: { sessionError: 401 } })
await waitFor(() => rejected.root.textContent.includes('Не удалось подтвердить вход'), 'ошибка подписи')
assert.ok(rejected.calls.length > 0 && rejected.calls.every((call) => call.path === '/api/me' && call.method === 'POST'))
assert.ok(rejected.calls.every((call) => call.headers.get('authorization') === `tma ${rawInitData}`))
assert.ok(!rejected.root.textContent.includes('Подмена'), 'initDataUnsafe не используется как подтверждённый пользователь')
assert.deepEqual(rejected.errors, [])
rejected.dom.window.close()
console.log('✓ невалидная подпись не открывает приложение и не запрашивает личные данные')

// Сначала сетевой сбой входа, затем успешное повторение.
const loginState = { sessionError: 503 }
const retryLogin = mount({ webApp: telegram(), state: loginState })
await waitFor(() => retryLogin.root.textContent.includes('Нет соединения с клубом'), 'ошибка входа')
loginState.sessionError = 0
await retryLogin.click([...retryLogin.root.querySelectorAll('button')].find((button) => button.textContent.includes('Повторить')), 'повтор входа')
await waitFor(() => retryLogin.root.textContent.includes('уже готов'), 'вход после повтора')
assert.deepEqual(retryLogin.errors, [])
retryLogin.dom.window.close()
console.log('✓ временную ошибку входа можно повторить')

for (const failure of ['clientError', 'catalogError']) {
  const state = { [failure]: 503 }
  const app = mount({ webApp: telegram(), state })
  await waitFor(() => app.root.textContent.includes('Нет соединения с клубом'), `ошибка ${failure}`)
  assert.ok(!app.root.textContent.includes('уже готов'), 'нет демонстрационного каталога на продакшене')
  assert.ok(!app.root.textContent.includes('Пока пусто'), 'ошибка не выдаётся за пустые записи')
  state[failure] = 0
  await app.click([...app.root.querySelectorAll('button')].find((button) => button.textContent.includes('Повторить')), 'повтор загрузки')
  await waitFor(() => app.root.textContent.includes('уже готов'), 'загрузка после повтора')
  assert.deepEqual(app.errors, [])
  app.dom.window.close()
}
console.log('✓ ошибки каталога и личных данных не маскируются демо или пустым списком')

const state = {}
const sdk = telegram()
const app = mount({ webApp: sdk, state })
await waitFor(() => app.root.textContent.includes('уже готов'), 'основной экран')
const text = app.root.textContent
assert.ok(text.length > 300)
assert.ok(['Клуб', 'Занятия', 'Игра', 'Магазин', 'О нас'].every((item) => text.includes(item)))
assert.match(text, /Привет, Елена/)
assert.doesNotMatch(text, /Подмена|Старая демо-бронь/)
assert.match(text, /Группа · начальный уровень/)
assert.match(text, /Артём Соколов/)
assert.ok(app.calls.some((call) => call.path === '/api/client'))
assert.ok(app.calls.some((call) => call.path === '/api/orders'))
assert.ok(app.calls.some((call) => call.path === '/api/bookings'))
for (const call of app.calls) {
  if (call.path === '/api/me') assert.equal(call.headers.get('authorization'), `tma ${rawInitData}`)
  else if (call.path === '/api/catalog') assert.equal(call.headers.get('authorization'), null)
  else assert.equal(call.headers.get('authorization'), `tma-session ${sessionToken}`)
  assert.equal(call.headers.get('x-dt-device'), null)
}
for (const key of Object.keys(app.window.localStorage)) {
  const value = app.window.localStorage.getItem(key) ?? ''
  assert.ok(!value.includes(rawInitData) && !value.includes(sessionToken), 'секреты не сохраняются в localStorage')
}

await app.click([...app.root.querySelectorAll('button')].find((button) => button.textContent.includes('О нас')), 'вкладка О нас')
await app.click([...app.root.querySelectorAll('a')].find((link) => link.textContent.includes('Написать в клуб')), 'контакт клуба')
assert.equal(sdk.openedLink, 'https://t.me/testtesttennisbot', 'для связи открывается чат Telegram, не сайт')
await app.click([...app.root.querySelectorAll('button')].find((button) => button.textContent.includes('Игра')), 'вкладка Игра')
assert.equal(app.root.querySelectorAll('.day-chip').length, 30)
await app.click(app.root.querySelectorAll('.day-chip')[1], 'завтра')
await app.click(app.root.querySelector('.slot'), 'первое окно')
const twoHours = [...app.root.querySelectorAll('[role="group"] button')].find((button) => button.textContent.includes('2 ч'))
assert.ok(twoHours && twoHours.textContent.replace(/\s/g, '').includes('4500'), 'два соседних окна')
await app.click(twoHours)
await app.click(app.root.querySelector('.sheet-footer .btn-primary'), 'подтверждение брони')
await waitFor(() => app.calls.some((call) => call.method === 'POST' && call.path === '/api/bookings'), 'создание брони')
const bookingCall = app.calls.find((call) => call.method === 'POST' && call.path === '/api/bookings')
assert.deepEqual(bookingCall.body.sourceIds, ['c1-07:00', 'c1-08:00'])
assert.equal(bookingCall.headers.get('authorization'), `tma-session ${sessionToken}`)
await waitFor(() => app.root.querySelector('.slot'), 'обновление каталога')

// Любой 401 из персонального API прекращает сессию, а не переключает в demo.
state.bookingError = 401
await app.click(app.root.querySelector('.slot'), 'окно после обновления')
await app.click(app.root.querySelector('.sheet-footer .btn-primary'), 'бронь с просроченной сессией')
await waitFor(() => app.root.textContent.includes('Сессия завершилась'), 'завершение сессии после 401')
assert.ok(!app.root.textContent.includes('Свободная игра'))
assert.ok(!app.root.textContent.includes('Пока пусто'))
assert.deepEqual(app.errors, [])
app.dom.window.close()
console.log('✓ Telegram: проверенный профиль, заголовки, запись и явная обработка 401')

for (const state of [{ bookingError: 503 }, { bookingsReadErrorAfterCreate: true }]) {
  const uncertain = mount({ webApp: telegram(), state })
  await waitFor(() => uncertain.root.textContent.includes('уже готов'), 'вход для проверки неизвестного результата')
  await uncertain.click([...uncertain.root.querySelectorAll('.tab')].find((button) => button.textContent.includes('Игра')), 'Игра')
  await uncertain.click(uncertain.root.querySelectorAll('.day-chip')[1], 'завтра')
  await uncertain.click(uncertain.root.querySelector('.slot'), 'окно')
  await uncertain.click(uncertain.root.querySelector('.sheet-layer.is-open .sheet-footer .btn-primary'), 'подтверждение')
  await waitFor(() => uncertain.root.textContent.includes('Нет соединения с клубом'), 'неизвестный результат операции')
  assert.match(uncertain.root.textContent, /проверьте её в списке/)
  assert.ok(!uncertain.root.textContent.includes('Записано'), 'неизвестный результат не показывается успешным')
  assert.deepEqual(uncertain.errors, [])
  uncertain.dom.window.close()
}
console.log('✓ потеря ответа или ошибка обновления брони не скрывает неопределённый результат')

const shortSdk = telegram()
const shortSession = mount({ webApp: shortSdk, state: { expiresIn: 1 } })
await waitFor(() => shortSession.root.textContent.includes('уже готов'), 'короткая сессия')
await waitFor(() => shortSession.root.textContent.includes('Сессия завершилась'), 'таймер сессии', 2500)
await shortSession.click([...shortSession.root.querySelectorAll('button')].find((button) => button.textContent.includes('Закрыть приложение')), 'закрытие Mini App')
assert.equal(shortSdk.closed, true)
assert.deepEqual(shortSession.errors, [])
shortSession.dom.window.close()
console.log('✓ по окончании сессии приложение предлагает закрыть и открыть его заново')

// Регрессия #500/#504: у функций Vercel обязана быть Web-сигнатура `{ fetch }`.
const apiDir = path.join('api')
const apiFiles = fs.readdirSync(apiDir, { recursive: true })
  .filter((file) => String(file).endsWith('.ts') && !String(file).includes('_lib') && !String(file).includes('tsconfig'))
for (const file of apiFiles) {
  const source = fs.readFileSync(path.join(apiDir, String(file)), 'utf8')
  if (/export default async function/.test(source)) {
    throw new Error(`api/${file}: голый default-экспорт ломает вызов на Vercel, нужен export default { fetch: handler }`)
  }
}
console.log(`✓ функции api: ${apiFiles.length} шт., Web-сигнатура на месте`)
