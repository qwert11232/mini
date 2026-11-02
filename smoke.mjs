import { JSDOM } from 'jsdom'
import fs from 'node:fs'
import path from 'node:path'

const html = fs.readFileSync('dist/index.html', 'utf8').replace('<script type="module"', '<script defer type="module"')
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' })
const { window } = dom
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
window.scrollTo = () => {}

const jsDir = 'dist/assets'
const bundle = fs.readdirSync(jsDir).find((f) => f.endsWith('.js'))
const code = fs.readFileSync(path.join(jsDir, bundle), 'utf8')

const document = window.document
const errors = []
window.addEventListener('error', (e) => errors.push(String(e.error || e.message)))

try {
  new window.Function('document', 'window', 'globalThis', code.replace(/^\s*export\s+/gm, ''))(document, window, window)
} catch (error) {
  errors.push('EVAL: ' + error.message)
}

await new Promise((r) => setTimeout(r, 500))
const root = document.getElementById('root')
const text = root.textContent ?? ''
const checks = {
  'рендер непустой': text.length > 300,
  'геройрендер': text.includes('уже готов'),
  'таб-бар 5 разделов': ['Клуб', 'Занятия', 'Игра', 'Магазин', 'О нас'].every((t) => text.includes(t)),
  'ближайшее занятие': text.includes('Скоро в клубе'),
  'тренеры': text.includes('Артём Соколов'),
  'картинки героя': document.querySelectorAll('img').length >= 1,
  'ошибок нет': errors.length === 0,
}
for (const [name, ok] of Object.entries(checks)) console.log(ok ? '✓' : '✗', name)
if (errors.length) console.log(errors.slice(0, 3))
