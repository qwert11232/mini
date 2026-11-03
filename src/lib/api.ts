import type { Booking, ClientProfile, Coach, Court, FreeSlot, Order, OrderContact, Product, TrainingSession } from './types'
import { getTelegram } from './telegram'
import { deviceKey } from './device'

export type Catalog = {
  courts: Court[]
  coaches: Coach[]
  sessions: TrainingSession[]
  slots: FreeSlot[]
  products: Product[]
}

const REQUEST_TIMEOUT = 8000

/**
 * Заголовки авторизации:
 * — внутри Telegram — подпись initData (это настоящий игрок);
 * — в обычном браузере — метка устройства, чтобы записи не терялись
 *   и доезжали до админки бота.
 */
function authHeaders(): Record<string, string> {
  const initData = getTelegram()?.initData
  if (initData) return { authorization: `tma ${initData}` }
  return { 'x-dt-device': deviceKey() }
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
  // ?mine=1 — «записи этого устройства»; работает и в браузере, и в Telegram.
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
