import { useCallback, useEffect, useMemo, useState } from 'react'
import { TabBar } from './components/TabBar'
import { EntryScreen } from './components/EntryScreen'
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
import { api, ApiError, clearSessionToken, onSessionRejected, setSessionToken, type VerifiedUser } from './lib/api'
import { bookingFromSession, slotOptions, type ActiveBooking } from './lib/booking'
import type { Product, SectionId } from './lib/types'
import { getTelegram, haptic, initTelegram } from './lib/telegram'
import { dayName, endTime } from './lib/date'
import './styles/tokens.css'
import './styles/base.css'
import './styles/app.css'

type AccessState =
  | { kind: 'checking' | 'missing' | 'invalid' | 'expired' | 'connection' }
  | { kind: 'ready'; user: VerifiedUser | null }

export function App() {
  const [access, setAccess] = useState<AccessState>(() => import.meta.env.DEV
    ? { kind: 'ready', user: null }
    : getTelegram()?.initData ? { kind: 'checking' } : { kind: 'missing' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => { initTelegram() }, [])
  useEffect(() => onSessionRejected(() => setAccess({ kind: 'expired' })), [])

  useEffect(() => {
    // npm run dev использует только локальный эмулятор, не рабочий API.
    if (import.meta.env.DEV) return
    const initData = getTelegram()?.initData
    if (!initData) {
      setAccess({ kind: 'missing' })
      return
    }

    let cancelled = false
    let issuedToken: string | undefined
    let expiryTimer: number | undefined
    setAccess({ kind: 'checking' })

    void api.openSession(initData).then((session) => {
      if (cancelled) return
      if (!session || typeof session.token !== 'string' || !session.token ||
          !Number.isSafeInteger(session.expiresIn) || session.expiresIn <= 0 || session.expiresIn > 86_400 ||
          !session.user || !Number.isSafeInteger(session.user.id) || session.user.id <= 0 ||
          typeof session.user.firstName !== 'string' ||
          (session.user.lastName !== null && typeof session.user.lastName !== 'string')) {
        throw new Error('Некорректный ответ сервиса')
      }
      issuedToken = session.token
      setSessionToken(session.token)
      setAccess({ kind: 'ready', user: session.user })
      // Используем интервал от сервера, а не часы телефона. Сам сервер также
      // проверяет срок на каждом запросе, даже если таймер WebView был усыплён.
      expiryTimer = window.setTimeout(() => {
        if (!cancelled && clearSessionToken(session.token)) setAccess({ kind: 'expired' })
      }, session.expiresIn * 1000)
    }).catch((error: unknown) => {
      if (cancelled) return
      setAccess({ kind: error instanceof ApiError && error.status === 401 ? 'invalid' : 'connection' })
    })

    return () => {
      cancelled = true
      if (expiryTimer !== undefined) window.clearTimeout(expiryTimer)
      if (issuedToken) clearSessionToken(issuedToken)
    }
  }, [attempt])

  if (access.kind !== 'ready') {
    return <EntryScreen kind={access.kind} onRetry={() => setAttempt((value) => value + 1)} />
  }
  return <ClubApp user={access.user} />
}

function ClubApp({ user }: { user: VerifiedUser | null }) {
  const [section, setSection] = useState<SectionId>('home')
  const [bookingTarget, setBookingTarget] = useState<ActiveBooking | null>(null)
  const [bookingOptions, setBookingOptions] = useState<ActiveBooking[]>([])
  const [productId, setProductId] = useState<string | null>(null)
  const [orderDraft, setOrderDraft] = useState<{ product: Product; quantity: number } | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [ordersOpen, setOrdersOpen] = useState(false)
  const store = useStore()
  const { catalog, source: catalogSource, refresh: refreshCatalog } = useCatalog()
  const { toast, show } = useToast()

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

  if (store.loading || catalogSource === 'loading') return <EntryScreen kind="loading" />
  if (store.loadError || catalogSource === 'error') {
    return <EntryScreen kind="connection" onRetry={() => { store.retry(); refreshCatalog() }} />
  }

  return (
    <div className="app-shell">
      <main key={section}>
        {section === 'home' ? (
          <HomeScreen bookings={store.bookings} catalog={catalog} user={user} onNavigate={setSection} onOpenSession={openSession} />
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
