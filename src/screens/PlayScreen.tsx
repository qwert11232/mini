import { useMemo, useState } from 'react'
import { COURTS, FREE_SLOTS } from '../data/club'
import type { Booking, Court } from '../lib/types'
import { ScreenHeader } from '../components/Chrome'
import { DayStrip } from '../components/DayStrip'
import { IconBall, IconCheck, IconClock, IconUsers } from '../components/Icons'
import { dayName, endTime } from '../lib/date'
import { formatPrice } from '../lib/format'
import { haptic } from '../lib/telegram'

const DAYS = [0, 1, 2, 3, 4, 5, 6]

type Props = {
  bookings: Booking[]
  onBookSlot: (slotId: string) => void
}

export function PlayScreen({ bookings, onBookSlot }: Props) {
  const [day, setDay] = useState(0)
  const [courtId, setCourtId] = useState<string>('all')

  const slots = useMemo(
    () =>
      FREE_SLOTS.filter((slot) => slot.dayOffset === day)
        .filter((slot) => courtId === 'all' || slot.courtId === courtId)
        .sort((a, b) => a.start.localeCompare(b.start)),
    [day, courtId],
  )

  const bookedIds = new Set(bookings.filter((item) => item.kind === 'free').map((item) => item.sourceId))

  const grouped = COURTS.map((court) => ({
    court,
    items: slots.filter((slot) => slot.courtId === court.id),
  })).filter((entry) => entry.items.length > 0)

  return (
    <div className="screen">
      <ScreenHeader
        eyebrow="Без тренера"
        title="Свободная игра"
        subtitle="Арендуйте корт на час — мячи и вода включены"
      />

      <DayStrip days={DAYS} active={day} onSelect={(value) => { haptic('select'); setDay(value) }} />

      <div className="pad" style={{ marginTop: 14 }}>
        <div className="scroller">
          <button
            type="button"
            className="chip"
            aria-pressed={courtId === 'all'}
            onClick={() => { haptic('select'); setCourtId('all') }}
          >
            Все корты
          </button>
          {COURTS.map((court) => (
            <button
              key={court.id}
              type="button"
              className="chip"
              aria-pressed={courtId === court.id}
              onClick={() => { haptic('select'); setCourtId(court.id) }}
            >
              {court.name}
              <span className="chip-sub">{court.surface}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="pad stack gap-5" style={{ marginTop: 18 }}>
        <div className="play-hero card">
          <div className="play-hero-lines" aria-hidden />
          <BallSmall />
          <div className="play-hero-text">
            <p className="t-caption">Аренда корта</p>
            <p className="t-title2" style={{ marginTop: 4 }}>от {formatPrice(2000)} / час</p>
            <p className="t-footnote" style={{ marginTop: 4, color: 'rgba(241,250,245,0.72)' }}>
              Свет, разметка, мячи и раздевалка включены
            </p>
          </div>
          <div className="play-hero-pills">
            {[
              { Icon: IconClock, text: '07:00–23:00' },
              { Icon: IconUsers, text: 'до 4 игроков' },
              { Icon: IconBall, text: '4 корта' },
            ].map(({ Icon, text }) => (
              <span key={text} className="play-pill">
                <Icon size={13} /> {text}
              </span>
            ))}
          </div>
        </div>

        {grouped.length === 0 ? (
          <div className="card card-pad empty">
            <span className="empty-icon"><IconClock size={26} /></span>
            <p className="t-headline">Свободных окон нет</p>
            <p className="t-footnote" style={{ maxWidth: 250 }}>
              На {dayName(day).toLowerCase()} всё занято. Посмотрите соседний день — обычно есть утро.
            </p>
          </div>
        ) : (
          grouped.map(({ court, items }) => (
            <section key={court.id} className="stack gap-3">
              <CourtHeading court={court} free={items.length} />
              <div className="slot-grid">
                {items.map((slot) => {
                  const used = bookedIds.has(slot.id)
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      className={`slot${used ? ' is-booked' : ''}`}
                      onClick={() => { haptic('light'); onBookSlot(slot.id) }}
                      disabled={used}
                    >
                      <span className="slot-time t-num">{slot.start}</span>
                      <span className="slot-end t-num">до {endTime(slot.start, slot.durationMin)}</span>
                      <span className="slot-price t-num">{used ? 'Ваша бронь' : formatPrice(slot.price)}</span>
                      {used ? <IconCheck size={13} className="slot-check" /> : null}
                    </button>
                  )
                })}
              </div>
            </section>
          ))
        )}

        <div className="card card-pad stack gap-3">
          <p className="t-headline">Нужен партнёр?</p>
          <p className="t-footnote">
            Клуб найдёт игрока вашего уровня на свободное окно. Напишите в бот — подберём пару за пару часов.
          </p>
          <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
            <span className="badge badge-green">Уровень NTRP 2.5–4.0</span>
            <span className="badge badge-muted">бесплатно</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function CourtHeading({ court, free }: { court: Court; free: number }) {
  return (
    <div className="row-between">
      <div className="row gap-2">
        <span className="court-dot" aria-hidden />
        <h2 className="t-headline">{court.name}</h2>
        <span className="t-footnote">{court.surface}</span>
      </div>
      <span className="t-footnote t-num">{free} окон</span>
    </div>
  )
}

function BallSmall() {
  return (
    <svg className="play-ball" viewBox="0 0 100 100" aria-hidden>
      <defs>
        <radialGradient id="ballFill" cx="35%" cy="28%" r="80%">
          <stop offset="0%" stopColor="#e6ff8a" />
          <stop offset="55%" stopColor="#c2f02a" />
          <stop offset="100%" stopColor="#7fb800" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill="url(#ballFill)" />
      <path d="M14 20c18 7 31 21 31 37S33 88 15 95M86 20C68 27 55 41 55 57s8 31 26 38" stroke="#0b3b27" strokeOpacity="0.35" strokeWidth="2" fill="none" />
    </svg>
  )
}
