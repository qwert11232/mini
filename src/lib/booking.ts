import type { Catalog } from './api'
import type { Booking } from './types'

export type ActiveBooking = {
  kind: Booking['kind']
  sourceId: string
  sourceIds?: string[]
  eyebrow: string
  title: string
  subtitle: string
  people: string
  dayOffset: number
  start: string
  durationMin: number
  price: number
}

const NO_COURT = 'Корт'

export function bookingFromSession(catalog: Catalog, sessionId: string): ActiveBooking | null {
  const session = catalog.sessions.find((item) => item.id === sessionId)
  if (!session) return null
  const coach = catalog.coaches.find((item) => item.id === session.coachId)
  const court = catalog.courts.find((item) => item.id === session.courtId)
  const free = Math.max(session.seatsTotal - session.seatsTaken, 0)

  return {
    kind: 'training',
    sourceId: session.id,
    eyebrow: session.group,
    title: session.title,
    subtitle: `${coach?.name ?? 'Тренер'} · ${court?.name ?? NO_COURT}`,
    people: `${coach?.name ?? 'Тренер'} · ${free} ${free === 1 ? 'место' : 'мест'} осталось`,
    dayOffset: session.dayOffset,
    start: session.start,
    durationMin: session.durationMin,
    price: session.price,
  }
}

export function bookingFromSlot(catalog: Catalog, slotId: string): ActiveBooking | null {
  const slot = catalog.slots.find((item) => item.id === slotId)
  if (!slot) return null
  const court = catalog.courts.find((item) => item.id === slot.courtId)

  return {
    kind: 'free',
    sourceId: slot.id,
    eyebrow: 'Свободная игра',
    title: `Аренда · ${court?.name ?? NO_COURT}`,
    subtitle: `${court?.surface ?? 'Хард'} · до 4 игроков`,
    people: 'До 4 игроков · мячи на ресепшене',
    dayOffset: slot.dayOffset,
    start: slot.start,
    durationMin: slot.durationMin,
    price: slot.price,
  }
}

/** Варианты строятся только из реально доступных соседних окон одного корта. */
export function slotOptions(catalog: Catalog, slotId: string, bookings: Booking[]): ActiveBooking[] {
  const first = catalog.slots.find((slot) => slot.id === slotId)
  const base = bookingFromSlot(catalog, slotId)
  if (!first || !base) return []
  const booked = new Set(bookings.filter((item) => item.kind === 'free').map((item) => item.sourceId))
  const candidates = catalog.slots.filter((slot) => slot.courtId === first.courtId && slot.dayOffset === first.dayOffset && !booked.has(slot.id))
  const result: ActiveBooking[] = []
  const ids: string[] = []
  let current = first
  let duration = 0
  let price = 0
  while (current && duration + current.durationMin <= 240 && ids.length < 8) {
    ids.push(current.id)
    duration += current.durationMin
    price += current.price
    result.push({ ...base, sourceIds: [...ids], durationMin: duration, price })
    const [hour, minute] = current.start.split(':').map(Number)
    const end = (hour ?? 0) * 60 + (minute ?? 0) + current.durationMin
    if (end >= 1440) break
    const next = candidates.find((slot) => {
      const [h, m] = slot.start.split(':').map(Number)
      return (h ?? 0) * 60 + (m ?? 0) === end && !ids.includes(slot.id)
    })
    if (!next) break
    current = next
  }
  return result
}
