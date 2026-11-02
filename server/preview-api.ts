import type { Plugin, Connect } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Локальный предпросмотр без Vercel и Neon.
 *
 * Поднимает те же маршруты, что и /api на Vercel, но данные берёт из
 * .preview/db.json (создаётся из src/data/club.ts при первом запуске).
 * Telegram не нужен: пользователь подставляется демонстрационный.
 * Это позволяет открыть сайт одним `npm run dev` — без установки и без секретов.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const STORE_PATH = join(ROOT, '.preview', 'db.json')
const DEMO_USER = { id: 100000001, firstName: 'Демо', lastName: null, username: 'dt_preview' }

type Store = {
  courts: unknown[]
  coaches: unknown[]
  sessions: Record<string, unknown>[]
  slots: Record<string, unknown>[]
  products: Record<string, unknown>[]
  bookings: Record<string, unknown>[]
  orders: Record<string, unknown>[]
}

let cache: Store | null = null

async function seedStore(): Promise<Store> {
  const club = (await import('../src/data/club.ts')) as typeof import('../src/data/club')
  return {
    courts: club.COURTS,
    coaches: club.COACHES,
    sessions: club.SESSIONS.map((item) => ({ ...item })),
    slots: club.FREE_SLOTS.map((item) => ({ ...item, isActive: true })),
    products: club.PRODUCTS.map((item) => ({ ...item })),
    bookings: [],
    orders: [],
  }
}

async function loadStore(): Promise<Store> {
  if (cache) return cache
  try {
    cache = JSON.parse(await readFile(STORE_PATH, 'utf8')) as Store
  } catch {
    cache = await seedStore()
    await saveStore(cache)
  }
  return cache
}

async function saveStore(store: Store): Promise<void> {
  await mkdir(dirname(STORE_PATH), { recursive: true })
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2), 'utf8')
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function previewApi(): Plugin {
  return {
    name: 'dt-preview-api',
    configureServer(server) {
      server.middlewares.use('/api', (async (
        req: IncomingMessage,
        res: ServerResponse,
      ) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const route = url.pathname.replace(/\/$/, '')
        const method = req.method ?? 'GET'
        const store = await loadStore()

        if (route === '/health') {
          return send(res, 200, { mode: 'preview', database: 'file', ok: true })
        }

        if (route === '/catalog' && method === 'GET') {
          return send(res, 200, {
            courts: store.courts,
            coaches: store.coaches,
            sessions: store.sessions,
            slots: store.slots.filter((slot) => slot.isActive !== false),
            products: store.products,
          })
        }

        if (route === '/me' && method === 'GET') {
          return send(res, 200, { user: DEMO_USER, hasBookings: store.bookings.length > 0 })
        }

        if (route === '/bookings' && method === 'GET') {
          return send(res, 200, { bookings: store.bookings, user: { firstName: DEMO_USER.firstName } })
        }

        if (route === '/bookings' && method === 'POST') {
          const body = await readBody(req)
          const sourceId = String(body.sourceId ?? '')
          const kind = String(body.kind ?? '')

          if (kind === 'free') {
            const slot = store.slots.find((item) => item.id === sourceId)
            if (!slot || slot.isActive === false) {
              return send(res, 409, { error: 'Это время уже заняли — выберите другое' })
            }
            slot.isActive = false
          }

          if (kind === 'training') {
            const session = store.sessions.find((item) => item.id === sourceId)
            if (session) {
              const total = Number(session.seatsTotal)
              const taken = Number(session.seatsTaken)
              if (taken >= total) return send(res, 409, { error: 'Мест на это занятие больше нет' })
              session.seatsTaken = taken + 1
            }
          }

          const booking = {
            ...body,
            id: `bk-${Date.now().toString(36)}`,
            createdAt: Date.now(),
          }
          store.bookings.unshift(booking)
          await saveStore(store)
          return send(res, 201, { id: booking.id })
        }

        if (route === '/bookings' && method === 'DELETE') {
          const id = url.searchParams.get('id')
          const index = store.bookings.findIndex((item) => item.id === id)
          if (index === -1) return send(res, 404, { error: 'Запись не найдена' })

          const [removed] = store.bookings.splice(index, 1)
          if (removed && removed.kind === 'free') {
            const slot = store.slots.find((item) => item.id === removed.sourceId)
            if (slot) slot.isActive = true
          }
          if (removed && removed.kind === 'training') {
            const session = store.sessions.find((item) => item.id === removed.sourceId)
            if (session) session.seatsTaken = Math.max(Number(session.seatsTaken) - 1, 0)
          }
          await saveStore(store)
          return send(res, 200, { ok: true })
        }

        if (route === '/orders' && method === 'GET') {
          return send(res, 200, { orders: store.orders })
        }

        if (route === '/orders' && method === 'POST') {
          const body = await readBody(req)
          const product = store.products.find((item) => item.id === String(body.productId ?? ''))
          if (!product) return send(res, 404, { error: 'Товар недоступен' })

          const quantity = Math.min(Math.max(Number(body.quantity ?? 1), 1), 9)
          const order = {
            id: `ord-${Date.now().toString(36)}`,
            productId: product.id,
            title: product.title,
            price: Number(product.price) * quantity,
            quantity,
            createdAt: Date.now(),
          }
          store.orders.unshift(order)
          await saveStore(store)
          return send(res, 201, { id: order.id, price: order.price })
        }

        return send(res, 404, { error: 'Маршрут не найден' })
      }) as Connect.NextHandleFunction)
    },
  }
}
