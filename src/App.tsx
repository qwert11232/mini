import { useCallback, useEffect, useMemo, useState } from 'react'
import { TabBar } from './components/TabBar'
import { Toast, useToast } from './components/Toast'
import { BookingSheet } from './components/BookingSheet'
import { ProductSheet } from './components/ProductSheet'
import { CustomTrainingSheet } from './components/CustomTrainingSheet'
import { OrdersSheet } from './components/OrdersSheet'
import { HomeScreen } from './screens/HomeScreen'
import { ScheduleScreen } from './screens/ScheduleScreen'
import { PlayScreen } from './screens/PlayScreen'
import { ShopScreen } from './screens/ShopScreen'
import { AboutScreen } from './screens/AboutScreen'
import { useStore } from './lib/store'
import { bookingFromSession, bookingFromSlot, type ActiveBooking } from './lib/booking'
import type { SectionId } from './lib/types'
import { haptic, initTelegram } from './lib/telegram'
import { PRODUCTS } from './data/club'
import { dayName, endTime } from './lib/date'
import './styles/tokens.css'
import './styles/base.css'
import './styles/app.css'

export function App() {
  const [section, setSection] = useState<SectionId>('home')
  const [bookingTarget, setBookingTarget] = useState<ActiveBooking | null>(null)
  const [productId, setProductId] = useState<string | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [ordersOpen, setOrdersOpen] = useState(false)
  const store = useStore()
  const { toast, show } = useToast()

  useEffect(() => {
    initTelegram()
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [section])

  const openSession = useCallback((id: string) => {
    setBookingTarget(bookingFromSession(id))
  }, [])

  const openSlot = useCallback((id: string) => {
    setBookingTarget(bookingFromSlot(id))
  }, [])

  const confirmBooking = useCallback(() => {
    if (!bookingTarget) return
    store.book({
      sourceId: bookingTarget.sourceId,
      kind: bookingTarget.kind,
      title: bookingTarget.title,
      subtitle: bookingTarget.subtitle,
      dayOffset: bookingTarget.dayOffset,
      start: bookingTarget.start,
      durationMin: bookingTarget.durationMin,
      price: bookingTarget.price,
    })
    haptic('success')
    show('Записано', `${dayName(bookingTarget.dayOffset)}, ${bookingTarget.start}–${endTime(bookingTarget.start, bookingTarget.durationMin)}`)
    setBookingTarget(null)
  }, [bookingTarget, store, show])

  const activeProduct = useMemo(
    () => PRODUCTS.find((product) => product.id === productId) ?? null,
    [productId],
  )

  return (
    <div className="app-shell">
      <main key={section}>
        {section === 'home' ? (
          <HomeScreen bookings={store.bookings} onNavigate={setSection} onOpenSession={openSession} />
        ) : null}
        {section === 'schedule' ? (
          <ScheduleScreen
            bookings={store.bookings}
            onOpenSession={openSession}
            onCreateCustom={() => setCustomOpen(true)}
          />
        ) : null}
        {section === 'play' ? <PlayScreen bookings={store.bookings} onBookSlot={openSlot} /> : null}
        {section === 'shop' ? (
          <ShopScreen
            favorites={store.favorites}
            orderCount={store.orders.length}
            onToggleFavorite={store.toggleFavorite}
            onOpenProduct={setProductId}
            onOpenOrders={() => setOrdersOpen(true)}
          />
        ) : null}
        {section === 'about' ? (
          <AboutScreen bookings={store.bookings} onCancelBooking={store.cancelBooking} />
        ) : null}
      </main>

      <TabBar active={section} onSelect={setSection} />
      <Toast toast={toast} />

      <BookingSheet target={bookingTarget} onClose={() => setBookingTarget(null)} onConfirm={confirmBooking} />

      <ProductSheet
        product={activeProduct}
        favorite={activeProduct ? store.favorites.includes(activeProduct.id) : false}
        onClose={() => setProductId(null)}
        onToggleFavorite={() => {
          if (activeProduct) store.toggleFavorite(activeProduct.id)
        }}
        onOrder={(product) => {
          store.order({ productId: product.id, title: product.title, price: product.price })
          haptic('success')
          show('Заказ оформлен', `${product.title} · резерв 48 часов`)
          setProductId(null)
        }}
      />

      <CustomTrainingSheet
        open={customOpen}
        onClose={() => setCustomOpen(false)}
        onBook={(draft) => {
          store.book({
            sourceId: `custom-${Date.now()}`,
            kind: 'training',
            title: draft.title,
            subtitle: draft.subtitle,
            dayOffset: draft.dayOffset,
            start: draft.start,
            durationMin: draft.durationMin,
            price: draft.price,
          })
          haptic('success')
          show('Тренер забронирован', `${dayName(draft.dayOffset)}, ${draft.start}`)
          setCustomOpen(false)
        }}
      />

      <OrdersSheet
        open={ordersOpen}
        orders={store.orders}
        onClose={() => setOrdersOpen(false)}
        onGoShop={() => {
          setOrdersOpen(false)
          setSection('shop')
        }}
      />
    </div>
  )
}
