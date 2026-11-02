import { useCallback, useEffect, useState } from 'react'
import type { Booking, Order } from './types'

const BOOKINGS_KEY = 'dt.bookings.v1'
const ORDERS_KEY = 'dt.orders.v1'
const FAVORITES_KEY = 'dt.favorites.v1'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Хранилище недоступно (приватный режим) — работаем без сохранения.
  }
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export type Store = {
  bookings: Booking[]
  orders: Order[]
  favorites: string[]
  book: (booking: Omit<Booking, 'id' | 'createdAt'>) => Booking
  cancelBooking: (id: string) => void
  order: (item: Omit<Order, 'id' | 'createdAt'>) => Order
  toggleFavorite: (productId: string) => void
}

export function useStore(): Store {
  const [bookings, setBookings] = useState<Booking[]>(() => read(BOOKINGS_KEY, []))
  const [orders, setOrders] = useState<Order[]>(() => read(ORDERS_KEY, []))
  const [favorites, setFavorites] = useState<string[]>(() => read(FAVORITES_KEY, []))

  useEffect(() => write(BOOKINGS_KEY, bookings), [bookings])
  useEffect(() => write(ORDERS_KEY, orders), [orders])
  useEffect(() => write(FAVORITES_KEY, favorites), [favorites])

  const book = useCallback((draft: Omit<Booking, 'id' | 'createdAt'>) => {
    const booking: Booking = { ...draft, id: makeId('bk'), createdAt: Date.now() }
    setBookings((prev) => [booking, ...prev])
    return booking
  }, [])

  const cancelBooking = useCallback((id: string) => {
    setBookings((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const order = useCallback((draft: Omit<Order, 'id' | 'createdAt'>) => {
    const created: Order = { ...draft, id: makeId('ord'), createdAt: Date.now() }
    setOrders((prev) => [created, ...prev])
    return created
  }, [])

  const toggleFavorite = useCallback((productId: string) => {
    setFavorites((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId],
    )
  }, [])

  return { bookings, orders, favorites, book, cancelBooking, order, toggleFavorite }
}
