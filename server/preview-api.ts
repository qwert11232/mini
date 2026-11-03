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

        if (route === '/client' && method === 'GET') {
          return send(res, 200, { clientNo: 1, clientLabel: '№ 1', firstName: DEMO_USER.firstName, phone: null, hasPhone: false })
        }

        if (route === '/client' && method === 'POST') {
          const body = await readBody(req)
          const name = String(body.name ?? '').trim()
          const phone = String(body.phone ?? '').trim()
          if (!name || !phone) return send(res, 400, { error: 'Укажите имя и телефон' })
          return send(res, 200, { ok: true, clientNo: 1, clientLabel: '№ 1', firstName: name, phone, hasPhone: true })
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
            const ids = Array.isArray(body.sourceIds) ? body.sourceIds : [sourceId]
            const slots = ids.map((id) => store.slots.find((item) => item.id === id && item.isActive !== false))
            if (ids.length < 1 || ids.length > 8 || ids[0] !== sourceId || new Set(ids).size !== ids.length || slots.some((slot) => !slot)) {
              return send(res, 409, { error: 'Это время уже заняли — выберите другое' })
            }
            const ordered = slots as Record<string, unknown>[]
            const startMinutes = (slot: Record<string, unknown>) => {
              const [h, m] = String(slot.start).split(':').map(Number)
              return (h ?? 0) * 60 + (m ?? 0)
            }
            const duration = ordered.reduce((sum, slot) => sum + Number(slot.durationMin), 0)
            if (duration > 240 || ordered.some((slot, index) => index > 0 && (
              slot.courtId !== ordered[0]?.courtId || slot.dayOffset !== ordered[0]?.dayOffset ||
              startMinutes(slot) !== startMinutes(ordered[index - 1]!) + Number(ordered[index - 1]!.durationMin)
            ))) return send(res, 400, { error: 'Выберите последовательные окна одного корта' })
            const bookings = ordered.map((slot, index) => ({
              ...body, sourceIds: undefined, sourceId: slot.id, start: slot.start,
              durationMin: slot.durationMin, price: slot.price,
              id: `bk-${Date.now().toString(36)}-${index}`, createdAt: Date.now(),
            }))
            ordered.forEach((slot) => { slot.isActive = false })
            store.bookings.unshift(...bookings)
            await saveStore(store)
            return send(res, 201, { id: bookings[0]?.id, ids: bookings.map((booking) => booking.id) })
          }

          if (kind === 'training') {
            const session = store.sessions.find((item) => item.id === sourceId)
            if (!session) return send(res, 404, { error: 'Занятие не найдено' })
            const total = Number(session.seatsTotal)
            const taken = Number(session.seatsTaken)
            if (taken >= total || store.bookings.some((item) => item.kind === kind && item.sourceId === sourceId)) {
              return send(res, 409, { error: 'Мест нет или вы уже записаны' })
            }
            session.seatsTaken = taken + 1
            body.title = session.title
            body.start = session.start
            body.durationMin = session.durationMin
            body.price = session.price
            body.dayOffset = session.dayOffset
          } else {
            return send(res, 400, { error: 'Неизвестный тип записи' })
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

          const name = String(body.name ?? '').trim()
          const phone = String(body.phone ?? '').trim()
          if (!name || !phone) return send(res, 400, { error: 'Укажите имя и телефон для заказа' })

          const quantity = Math.min(Math.max(Number(body.quantity ?? 1), 1), 9)
          const order = {
            id: `ord-${Date.now().toString(36)}`,
            productId: product.id,
            title: product.title,
            price: Number(product.price) * quantity,
            quantity,
            contactName: name,
            contactPhone: phone,
            clientNo: 1,
            createdAt: Date.now(),
          }
          store.orders.unshift(order)
          await saveStore(store)
          return send(res, 201, {
            id: order.id,
            price: order.price,
            clientNo: 1,
            clientLabel: '№ 1',
            contactName: name,
            contactPhone: phone,
          })
        }

        return send(res, 404, { error: 'Маршрут не найден' })
      }) as Connect.NextHandleFunction)
    },
  }
}
