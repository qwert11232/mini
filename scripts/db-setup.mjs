/**
 * Наполнение Neon при сборке на Vercel.
 *
 * Зачем: GitHub Actions не видит секрет базы, а сборка Vercel получает
 * DATABASE_URL из переменных проекта и имеет сетевой доступ к Neon.
 * Схема и сид идемпотентны, поэтому запуск на каждой сборке безопасен.
 *
 * Локально и без DATABASE_URL скрипт молча выходит — сборка не ломается.
 */
import { readFile } from 'node:fs/promises'
import pg from 'pg'

const url = process.env.DATABASE_URL

if (!url) {
  console.log('[db-setup] DATABASE_URL не задан — пропускаю (локальная сборка или Preview без базы)')
  process.exit(0)
}

const files = ['db/schema.sql', 'db/seed.sql']
const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
})

try {
  await client.connect()

  for (const file of files) {
    const sql = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
    await client.query(sql)
    console.log(`[db-setup] применено: ${file}`)
  }

  const counts = await client.query(`
    select 'courts' as name, count(*)::int as total from courts
    union all select 'coaches', count(*)::int from coaches
    union all select 'training_sessions', count(*)::int from training_sessions
    union all select 'free_slots', count(*)::int from free_slots
    union all select 'products', count(*)::int from products
  `)
  console.log('[db-setup] данные:', counts.rows.map((row) => `${row.name}=${row.total}`).join(' '))
} catch (error) {
  // База может быть недоступна из окружения сборки — сайт всё равно должен выйти.
  console.error('[db-setup] не удалось подготовить базу:', error instanceof Error ? error.message : error)
} finally {
  await client.end().catch(() => {})
}
