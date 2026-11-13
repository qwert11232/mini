import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import path from 'node:path'

// Vercel обнаруживает маршруты в api/, кроме директорий/файлов с префиксом _.
// Оставляем место для лимита Hobby и не считаем .d.ts служебными функциями.
async function routes(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const result = []
  for (const entry of entries) {
    if (entry.name.startsWith('_')) continue
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) result.push(...await routes(file))
    else if (/\.(?:js|mjs|cjs|ts|mts|cts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) result.push(file)
  }
  return result
}
const files = await routes('api')
assert.ok(files.length <= 12, `Vercel Hobby: ${files.length} функций вместо максимум 12:\n${files.join('\n')}`)
console.log(`✓ Vercel Hobby: ${files.length}/12 API-функций`)
