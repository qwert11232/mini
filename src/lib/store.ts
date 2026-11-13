import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from './api'
import { COACHES, COURTS, FREE_SLOTS, PRODUCTS, SESSIONS } from '../data/club'
import type { Booking, ClientProfile, Order, OrderContact } from './types'

/** 'api' — сервер; 'demo' — только локальный предпросмотр. */
export type Mode = 'api' | 'demo'

export type Store = {
  mode: Mode
  loading: boolean
  loadError: boolean
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

/** При сетевой ошибке или 5xx сервер мог сохранить действие до потери ответа. */
function outcomeUnknown(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500
}

export function useStore(): Store {
  const [mode, setMode] = useState<Mode>('demo')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
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

  /** Не показываем пустые личные данные, пока все запросы не завершились успешно. */
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(false)

    const load = async () => {
      // Профиль также подготавливает схему клиента. Не запускаем его параллельно
      // с такой же инициализацией в /orders на другом инстансе функции.
      const profile = await api.client()
      const [orderData, bookingData] = await Promise.all([api.orders(), api.bookings()])
      if (cancelled || !mounted.current) return
      setClient(profile)
      setOrders(orderData.orders)
      setBookings(bookingData.bookings)
      setMode('api')
    }

    void load().catch(() => {
      if (cancelled || !mounted.current) return
      if (import.meta.env.DEV) setMode('demo')
      else setLoadError(true)
    }).finally(() => {
      if (!cancelled && mounted.current) setLoading(false)
    })

    return () => { cancelled = true }
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
      if (!import.meta.env.DEV && mode !== 'api') return { ok: false, error: 'Сервис недоступен. Бронь не создана, попробуйте позже.' }
      if (mode === 'api') {
        try {
          await api.createBooking(draft)
          // Бронь уже создана. Если обновить список не удалось, попросим
          // перепроверить данные, а не сообщим, что создание не состоялось.
          try {
            const data = await api.bookings()
            if (mounted.current) setBookings(data.bookings)
          } catch {
            if (mounted.current) setLoadError(true)
          }
          return { ok: true }
        } catch (error) {
          if (outcomeUnknown(error)) {
            if (mounted.current) setLoadError(true)
            return { ok: false, error: 'Не удалось получить ответ. Проверьте свои записи перед повтором.' }
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
          try {
            const data = await api.bookings()
            if (mounted.current) setBookings(data.bookings)
          } catch {
            if (mounted.current) setLoadError(true)
          }
          return { ok: true }
        } catch (error) {
          if (outcomeUnknown(error)) {
            if (mounted.current) setLoadError(true)
            return { ok: false, error: 'Не удалось получить ответ. Проверьте свои записи перед повтором.' }
          }
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
          if (outcomeUnknown(error)) {
            if (mounted.current) setLoadError(true)
            return { ok: false, error: 'Не удалось получить ответ. Проверьте свои заказы перед повтором.' }
          }
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
    loadError,
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
