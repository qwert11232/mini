import type { Catalog } from './api'
import type { Booking } from './types'

export type ActiveBooking = {
  kind: Booking['kind']
  sourceId: string
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
