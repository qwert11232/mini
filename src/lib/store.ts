import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from './api'
import { getTelegram } from './telegram'
import { COACHES, COURTS, FREE_SLOTS, PRODUCTS, SESSIONS } from '../data/club'
import type { Booking, ClientProfile, Order, OrderContact } from './types'

const MODE_KEY = 'dt.mode.v1'

/** 'api' — живой бэкенд Vercel+Neon; 'demo' — локальные данные (нет сети/бэкенда ТГ). */
export type Mode = 'api' | 'demo'

export type Store = {
  mode: Mode
  loading: boolean
  bookings: Booking[]
  orders: Order[]
  client: ClientProfile | null
  favorites: string[]
  book: (draft: Omit<Booking, 'id' | 'createdAt'>) => Promise<{ ok: boolean; error?: string }>
  cancelBooking: (id: string) => Promise<{ ok: boolean; error?: string }>
  order: (
    productId: string,
    quantity: number,
    contact: OrderContact,
    productTitle?: string,
  ) => Promise<{ ok: boolean; error?: string; clientLabel?: string }>
  toggleFavorite: (productId: string) => void
  retry: () => void
}

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'api' ? 'api' : 'demo'
  } catch {
    return 'demo'
  }
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Приватный режим: продолжаем без сохранения.
  }
}

export function useStore(): Store {
  const [mode, setMode] = useState<Mode>(readMode)
  const [loading, setLoading] = useState(mode === 'api')
  const [bookings, setBookings] = useState<Booking[]>(() => import.meta.env.DEV ? readLocal('dt.bookings.v1', []) : [])
  const [orders, setOrders] = useState<Order[]>(() => import.meta.env.DEV ? readLocal('dt.orders.v1', []) : [])
  const [client, setClient] = useState<ClientProfile | null>(null)
  const [favorites, setFavorites] = useState<string[]>(() => readLocal('dt.favorites.v1', []))
  const [attempt, setAttempt] = useState(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  /** Определяем режим один раз за сессию: отвечает ли /api. */
  useEffect(() => {
    let cancelled = false
    setLoading(true)

    // Номер клиента подгружаем при входе на сайт, а не только после заказа.
    // Ошибка профиля не должна переводить весь сайт в демо-режим.
    api
      .client()
      .then((profile) => {
        if (!cancelled && mounted.current && typeof profile.clientNo === 'number') setClient(profile)
      })
      .catch(() => {
        // Профиль появится при повторной попытке или после оформления заказа.
      })

    api
      .orders()
      .then((data) => {
        if (cancelled || !mounted.current) return
        setOrders((previous) => [
          ...previous.filter((item) => !data.orders.some((order) => order.id === item.id)),
          ...data.orders,
        ])
      })
      .catch(() => {
        // Ошибка списка заказов не должна скрывать доступное расписание.
      })

    api
      .bookings()
      .then((data) => {
        if (cancelled || !mounted.current) return
        setMode('api')
        writeLocal(MODE_KEY, 'api')
        setBookings(data.bookings)
      })
      .catch(() => {
        if (cancelled || !mounted.current) return
        setMode('demo')
        writeLocal(MODE_KEY, 'demo')
      })
      .finally(() => {
        if (!cancelled && mounted.current) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [attempt])

  useEffect(() => {
    if (import.meta.env.DEV && mode === 'demo') writeLocal('dt.bookings.v1', bookings)
  }, [bookings, mode])

  useEffect(() => {
    if (import.meta.env.DEV && mode === 'demo') writeLocal('dt.orders.v1', orders)
  }, [orders, mode])

  useEffect(() => {
    writeLocal('dt.favorites.v1', favorites)
  }, [favorites])

  const book = useCallback(
    async (draft: Omit<Booking, 'id' | 'createdAt'>) => {
      if (!import.meta.env.DEV && !getTelegram()?.initData) return { ok: false, error: 'Откройте приложение в Telegram, чтобы записаться.' }
      if (!import.meta.env.DEV && mode !== 'api') return { ok: false, error: 'Сервис недоступен. Бронь не создана, попробуйте позже.' }
      if (mode === 'api') {
        try {
          await api.createBooking(draft)
          const data = await api.bookings().catch(() => null)
          if (mounted.current && data) setBookings(data.bookings)
          return { ok: true }
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            if (mounted.current) {
              setMode('demo')
              writeLocal(MODE_KEY, 'demo')
            }
          }
          return { ok: false, error: error instanceof Error ? error.message : 'Не удалось записаться' }
        }
      }

      const booking: Booking = { ...draft, id: `bk-${Date.now().toString(36)}`, createdAt: Date.now() }
      setBookings((prev) => [booking, ...prev])
      return { ok: true }
    },
    [mode],
  )

  const cancelBooking = useCallback(
    async (id: string) => {
      if (mode === 'api') {
        try {
          await api.cancelBooking(id)
          const data = await api.bookings().catch(() => null)
          if (mounted.current && data) setBookings(data.bookings)
          return { ok: true }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : 'Не удалось отменить запись' }
        }
      }
      if (!import.meta.env.DEV) return { ok: false, error: 'Сервис недоступен. Запись не отменена.' }
      setBookings((prev) => prev.filter((item) => item.id !== id))
      return { ok: true }
    },
    [mode],
  )

  const order = useCallback(
    async (productId: string, quantity: number, contact: OrderContact, productTitle?: string) => {
      if (!import.meta.env.DEV && !getTelegram()?.initData) return { ok: false, error: 'Откройте приложение в Telegram, чтобы оформить заказ.' }
      if (!import.meta.env.DEV && mode !== 'api') return { ok: false, error: 'Сервис недоступен. Заказ не создан, попробуйте позже.' }
      if (mode === 'api') {
        try {
          const created = await api.createOrder(productId, quantity, contact)
          const product = PRODUCTS.find((item) => item.id === productId)
          if (mounted.current) {
            setOrders((prev) => [
              {
                id: created.id,
                productId,
                title: productTitle ?? product?.title ?? 'Товар',
                price: created.price,
                quantity,
                contactName: created.contactName,
                contactPhone: created.contactPhone,
                clientNo: created.clientNo,
                createdAt: Date.now(),
              },
              ...prev,
            ])
            setClient({
              clientNo: created.clientNo,
              clientLabel: created.clientLabel,
              firstName: created.contactName,
              phone: created.contactPhone,
              hasPhone: true,
            })
          }
          return { ok: true, clientLabel: created.clientLabel }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : 'Не удалось оформить' }
        }
      }

      const product = PRODUCTS.find((item) => item.id === productId)
      if (!product) return { ok: false, error: 'Товар недоступен' }
      const created: Order = {
        id: `ord-${Date.now().toString(36)}`,
        productId,
        title: productTitle ?? product.title,
        price: product.price * quantity,
        quantity,
        contactName: contact.name,
        contactPhone: contact.phone,
        createdAt: Date.now(),
      }
      setOrders((prev) => [created, ...prev])
      return { ok: true }
    },
    [mode],
  )

  const toggleFavorite = useCallback((productId: string) => {
    setFavorites((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId],
    )
  }, [])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  return {
    mode,
    loading,
    bookings,
    orders,
    client,
    favorites,
    book,
    cancelBooking,
    order,
    toggleFavorite,
    retry,
  }
}

/** Справочники для демо-режима (и подписи, которые не хранятся в API). */
export function demoCatalog() {
  return {
    courts: COURTS,
    coaches: COACHES,
    sessions: SESSIONS,
    slots: FREE_SLOTS,
    products: PRODUCTS,
  }
}
