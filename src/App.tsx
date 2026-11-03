import { useCallback, useEffect, useMemo, useState } from 'react'
import { TabBar } from './components/TabBar'
import { Toast, useToast } from './components/Toast'
import { BookingSheet } from './components/BookingSheet'
import { ProductSheet } from './components/ProductSheet'
import { CustomTrainingSheet } from './components/CustomTrainingSheet'
import { OrdersSheet } from './components/OrdersSheet'
import { OrderContactSheet } from './components/OrderContactSheet'
import { HomeScreen } from './screens/HomeScreen'
import { ScheduleScreen } from './screens/ScheduleScreen'
import { PlayScreen } from './screens/PlayScreen'
import { ShopScreen } from './screens/ShopScreen'
import { AboutScreen } from './screens/AboutScreen'
import { useStore } from './lib/store'
import { useCatalog } from './lib/useCatalog'
import { bookingFromSession, slotOptions, type ActiveBooking } from './lib/booking'
import type { Product, SectionId } from './lib/types'
import { haptic, initTelegram } from './lib/telegram'
import { dayName, endTime } from './lib/date'
import './styles/tokens.css'
import './styles/base.css'
import './styles/app.css'

export function App() {
  const [section, setSection] = useState<SectionId>('home')
  const [bookingTarget, setBookingTarget] = useState<ActiveBooking | null>(null)
  const [bookingOptions, setBookingOptions] = useState<ActiveBooking[]>([])
  const [productId, setProductId] = useState<string | null>(null)
  const [orderDraft, setOrderDraft] = useState<{ product: Product; quantity: number } | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [ordersOpen, setOrdersOpen] = useState(false)
  const store = useStore()
  const { catalog, refresh: refreshCatalog } = useCatalog()
  const { toast, show } = useToast()

  useEffect(() => {
    initTelegram()
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [section])

  const openSession = useCallback(
    (id: string) => {
      setBookingOptions([])
      setBookingTarget(bookingFromSession(catalog, id))
    },
    [catalog],
  )

  const openSlot = useCallback(
    (id: string) => {
      const options = slotOptions(catalog, id, store.bookings)
      setBookingOptions(options)
      setBookingTarget(options[0] ?? null)
    },
    [catalog, store.bookings],
  )

  const confirmBooking = useCallback(() => {
    if (!bookingTarget) return
    const target = bookingTarget
    setBookingTarget(null)
    void store
      .book({
        sourceId: target.sourceId,
        sourceIds: target.sourceIds,
        kind: target.kind,
        title: target.title,
        subtitle: target.subtitle,
        dayOffset: target.dayOffset,
        start: target.start,
        durationMin: target.durationMin,
        price: target.price,
      })
      .then((result) => {
        if (result.ok) {
          refreshCatalog()
          haptic('success')
          show('Записано', `${dayName(target.dayOffset)}, ${target.start}–${endTime(target.start, target.durationMin)}`)
        } else {
          haptic('error')
          show('Не удалось записаться', result.error)
        }
      })
  }, [bookingTarget, store, show, refreshCatalog])

  const activeProduct = useMemo(
    () => catalog.products.find((product) => product.id === productId) ?? null,
    [catalog.products, productId],
  )
  const savedContactName = store.client?.firstName && store.client.firstName !== 'Гость с сайта'
    ? store.client.firstName
    : ''

  return (
    <div className="app-shell">
      <main key={section}>
        {section === 'home' ? (
          <HomeScreen bookings={store.bookings} catalog={catalog} onNavigate={setSection} onOpenSession={openSession} />
        ) : null}
        {section === 'schedule' ? (
          <ScheduleScreen
            bookings={store.bookings}
            catalog={catalog}
            onOpenSession={openSession}
            onCreateCustom={() => setCustomOpen(true)}
          />
        ) : null}
        {section === 'play' ? <PlayScreen bookings={store.bookings} catalog={catalog} onBookSlot={openSlot} /> : null}
        {section === 'shop' ? (
          <ShopScreen
            favorites={store.favorites}
            products={catalog.products}
            orderCount={store.orders.length}
            onToggleFavorite={store.toggleFavorite}
            onOpenProduct={setProductId}
            onOpenOrders={() => setOrdersOpen(true)}
          />
        ) : null}
        {section === 'about' ? (
          <AboutScreen
            bookings={store.bookings}
            coaches={catalog.coaches}
            client={store.client}
            mode={store.mode}
            loading={store.loading}
            onRetry={store.retry}
            onCancelBooking={(id) => {
              void store.cancelBooking(id).then((result) => {
                if (result.ok) { refreshCatalog(); show('Запись отменена') }
                else show('Не удалось отменить запись', result.error)
              })
            }}
          />
        ) : null}
      </main>

      <TabBar active={section} onSelect={setSection} />
      <Toast toast={toast} />

      <BookingSheet target={bookingTarget} options={bookingOptions} onSelect={setBookingTarget} onClose={() => setBookingTarget(null)} onConfirm={confirmBooking} />

      <ProductSheet
        product={activeProduct}
        favorite={activeProduct ? store.favorites.includes(activeProduct.id) : false}
        onClose={() => setProductId(null)}
        onToggleFavorite={() => {
          if (activeProduct) store.toggleFavorite(activeProduct.id)
        }}
        onOrder={(product, quantity) => {
          setProductId(null)
          setOrderDraft({ product, quantity })
        }}
      />

      <OrderContactSheet
        open={orderDraft !== null}
        product={orderDraft?.product ?? null}
        quantity={orderDraft?.quantity ?? 1}
        clientLabel={store.client?.clientLabel}
        initialName={savedContactName}
        initialPhone={store.client?.phone}
        onClose={() => setOrderDraft(null)}
        onSubmit={async (contact) => {
          const draft = orderDraft
          if (!draft) return { ok: false, error: 'Заказ уже закрыт' }
          const result = await store.order(draft.product.id, draft.quantity, contact, draft.product.title)
          if (result.ok) {
            setOrderDraft(null)
            haptic('success')
            show(
              'Заказ оформлен',
              `${draft.product.title} · ${result.clientLabel ? `клиент ${result.clientLabel}` : 'резерв 48 часов'}`,
            )
          } else {
            haptic('error')
          }
          return result
        }}
      />

      <CustomTrainingSheet
        open={customOpen}
        onClose={() => setCustomOpen(false)}
        coaches={catalog.coaches}
        onBook={(draft) => {
          setCustomOpen(false)
          void store
            .book({
              sourceId: `custom-${Date.now()}`,
              kind: 'training',
              title: draft.title,
              subtitle: draft.subtitle,
              dayOffset: draft.dayOffset,
              start: draft.start,
              durationMin: draft.durationMin,
              price: draft.price,
            })
            .then((result) => {
              if (result.ok) {
                haptic('success')
                show('Тренер забронирован', `${dayName(draft.dayOffset)}, ${draft.start}`)
              } else {
                haptic('error')
                show('Не удалось записаться', result.error)
              }
            })
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
