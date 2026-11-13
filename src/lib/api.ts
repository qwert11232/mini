import type { Booking, ClientProfile, Coach, Court, FreeSlot, Order, OrderContact, Product, TrainingSession } from './types'

export type Catalog = {
  courts: Court[]
  coaches: Coach[]
  sessions: TrainingSession[]
  slots: FreeSlot[]
  products: Product[]
}

export type VerifiedUser = { id: number; firstName: string; lastName: string | null }
export type AppSession = { token: string; expiresIn: number; user: VerifiedUser }

const REQUEST_TIMEOUT = 8000
let sessionToken: string | null = null
const sessionRejectedListeners = new Set<() => void>()

/** Сессия существует только в памяти вкладки, никогда не в URL или localStorage. */
export function setSessionToken(token: string): void {
  sessionToken = token
}

export function clearSessionToken(expected?: string): boolean {
  if (expected !== undefined && sessionToken !== expected) return false
  const hadSession = sessionToken !== null
  sessionToken = null
  return hadSession
}

export function onSessionRejected(listener: () => void): () => void {
  sessionRejectedListeners.add(listener)
  return () => { sessionRejectedListeners.delete(listener) }
}

async function request<T>(path: string, init?: RequestInit, useSession = true): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  const usedToken = useSession ? sessionToken : null
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json')
  if (usedToken && !headers.has('authorization')) headers.set('authorization', `tma-session ${usedToken}`)

  try {
    const response = await fetch(path, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
      headers,
    })

    const payload = (await response.json().catch(() => null)) as
      | (T & { error?: string })
      | null

    if (!response.ok) {
      // Не прячем отказ в «пустых» записях и не сбрасываем более новую сессию
      // из-за запоздавшего ответа предыдущего запроса.
      if (response.status === 401 && usedToken && clearSessionToken(usedToken)) {
        sessionRejectedListeners.forEach((listener) => listener())
      }
      throw new ApiError(payload?.error ?? 'Сервис недоступен', response.status)
    }
    if (!payload) throw new ApiError('Пустой ответ сервиса', 502)
    return payload
  } finally {
    window.clearTimeout(timer)
  }
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export const api = {
  // Сырой initData передаём только при входе; сервер сначала проверяет HMAC.
  openSession: (initData: string) => request<AppSession>('/api/me', {
    method: 'POST',
    headers: { authorization: `tma ${initData}` },
  }, false),
  // Каталог не содержит личных данных, подпись ему не нужна.
  catalog: () => request<Catalog>('/api/catalog', undefined, false),
  me: () => request<{ user: VerifiedUser; hasBookings: boolean }>('/api/me'),
  bookings: () => request<{ bookings: Booking[]; user?: { firstName: string } }>('/api/bookings?mine=1'),
  createBooking: (draft: Omit<Booking, 'id' | 'createdAt'>) =>
    request<{ id: string }>('/api/bookings', { method: 'POST', body: JSON.stringify(draft) }),
  cancelBooking: (id: string) =>
    request<{ ok: boolean }>(`/api/bookings?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  client: () => request<ClientProfile>('/api/client'),
  saveClient: (contact: OrderContact) =>
    request<ClientProfile & { ok: boolean }>('/api/client', {
      method: 'POST',
      body: JSON.stringify(contact),
    }),
  orders: () => request<{ orders: Order[] }>('/api/orders'),
  createOrder: (productId: string, quantity: number, contact: OrderContact) =>
    request<{ id: string; price: number; clientNo: number; clientLabel: string; contactName: string; contactPhone: string }>('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ productId, quantity, ...contact }),
    }),
}
