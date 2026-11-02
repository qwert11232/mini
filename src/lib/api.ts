import type { Booking, Coach, Court, FreeSlot, Order, Product, TrainingSession } from './types'
import { getTelegram } from './telegram'

export type Catalog = {
  courts: Court[]
  coaches: Coach[]
  sessions: TrainingSession[]
  slots: FreeSlot[]
  products: Product[]
}

const REQUEST_TIMEOUT = 8000

/** Заголовки авторизации: подпись Telegram, если приложение открыто внутри мессенджера. */
function authHeaders(): Record<string, string> {
  const initData = getTelegram()?.initData
  return initData ? { authorization: `tma ${initData}` } : {}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

  try {
    const response = await fetch(path, {
      ...init,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...authHeaders(),
        ...init?.headers,
      },
    })

    const payload = (await response.json().catch(() => null)) as
      | (T & { error?: string })
      | null

    if (!response.ok) {
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
  catalog: () => request<Catalog>('/api/catalog'),
  me: () => request<{ user: { firstName: string }; hasBookings: boolean }>('/api/me'),
  bookings: () => request<{ bookings: Booking[]; user?: { firstName: string } }>('/api/bookings'),
  createBooking: (draft: Omit<Booking, 'id' | 'createdAt'>) =>
    request<{ id: string }>('/api/bookings', { method: 'POST', body: JSON.stringify(draft) }),
  cancelBooking: (id: string) =>
    request<{ ok: boolean }>(`/api/bookings?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  orders: () => request<{ orders: Order[] }>('/api/orders'),
  createOrder: (productId: string, quantity: number) =>
    request<{ id: string; price: number }>('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ productId, quantity }),
    }),
}
