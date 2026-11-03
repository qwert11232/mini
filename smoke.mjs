import { JSDOM } from 'jsdom'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Smoke-проверка собранного бандла без браузера:
 * рендерим приложение в jsdom, подставляем ответы /api и проверяем ключевые экраны.
 */

const html = fs.readFileSync('dist/index.html', 'utf8')
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' })
const { window } = dom
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
window.scrollTo = () => {}

const catalog = {
  courts: [
    { id: 'c1', name: 'Корт 1', surface: 'Крытый хард' },
    { id: 'c3', name: 'Корт 3', surface: 'Грунт' },
  ],
  coaches: [{ id: 'k1', name: 'Артём Соколов', role: 'Главный тренер · КМС', initials: 'АС', rating: 4.9 }],
  sessions: [
    {
      id: 's1', title: 'Группа · начальный уровень', group: 'Группа', level: 'Новичок',
      coachId: 'k1', courtId: 'c3', dayOffset: 1, start: '09:00', durationMin: 90, price: 1400,
      seatsTotal: 6, seatsTaken: 4,
    },
  ],
  slots: [{ id: 'c1-07:00', courtId: 'c1', dayOffset: 0, start: '07:00', durationMin: 60, price: 2000 }],
  products: [
    {
      id: 'p1', title: 'Ракетка DT Control 300', subtitle: 'Баланс для любителя', category: 'Ракетки',
      price: 18900, image: '/img/shop-racket.jpg', colors: ['#1c6b43'],
    },
  ],
}

const calls = []
// Фикстура занятия — на завтра: проверка не должна зависеть от текущего времени.
window.fetch = async (url) => {
  calls.push(String(url))
  const body = String(url).includes('/api/client')
    ? { clientNo: 42, clientLabel: '№ 42', firstName: 'Демо', phone: null, hasPhone: false }
    : String(url).includes('/api/bookings')
      ? { bookings: [], user: { firstName: 'Демо' } }
      : String(url).includes('/api/catalog')
        ? catalog
        : { orders: [] }
  return { ok: true, status: 200, json: async () => body }
}

const errors = []
window.addEventListener('error', (event) => errors.push(String(event.error || event.message)))

const bundle = fs.readdirSync('dist/assets').find((file) => file.endsWith('.js'))
const code = fs.readFileSync(path.join('dist/assets', bundle), 'utf8')

try {
  new window.Function('document', 'window', 'globalThis', code.replace(/^\s*export\s+/gm, ''))(
    window.document,
    window,
    window,
  )
} catch (error) {
  errors.push('EVAL: ' + error.message)
}

await new Promise((resolve) => setTimeout(resolve, 600))

const root = window.document.getElementById('root')
const text = root.textContent ?? ''
const checks = {
  'приложение отрендерено': text.length > 300,
  'герой на месте': text.includes('уже готов'),
  'таб-бар: 5 разделов': ['Клуб', 'Занятия', 'Игра', 'Магазин', 'О нас'].every((t) => text.includes(t)),
  'каталог пришёл из /api': calls.some((url) => url.includes('/api/catalog')),
  'профиль клиента запрошен': calls.some((url) => url.includes('/api/client')),
  'занятие из API на экране': text.includes('Группа · начальный уровень'),
  'тренер из API': text.includes('Артём Соколов'),
  'ошибок в консоли нет': errors.length === 0,
}

for (const [name, ok] of Object.entries(checks)) console.log(ok ? '✓' : '✗', name)
if (errors.length) console.log(errors.slice(0, 3))
process.exitCode = Object.values(checks).every(Boolean) ? 0 : 1

// Регрессия #500/#504: у функций Vercel обязана быть Web-сигнатура `{ fetch }`.
const apiDir = path.join('api')
const apiFiles = fs
  .readdirSync(apiDir, { recursive: true })
  .filter((f) => String(f).endsWith('.ts') && !String(f).includes('_lib') && !String(f).includes('tsconfig'))
for (const file of apiFiles) {
  const source = fs.readFileSync(path.join(apiDir, String(file)), 'utf8')
  if (/export default async function/.test(source)) {
    throw new Error(`api/${file}: голый default-экспорт ломает вызов на Vercel, нужен export default { fetch: handler }`)
  }
}
console.log(`✓ функции api: ${apiFiles.length} шт., Web-сигнатура на месте`)
