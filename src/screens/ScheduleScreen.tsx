import { useMemo, useState } from 'react'
import { GROUPS } from '../data/club'
import type { Catalog } from '../lib/api'
import type { Booking } from '../lib/types'
import { ScreenHeader } from '../components/Chrome'
import { DayStrip } from '../components/DayStrip'
import { SessionCard } from '../components/SessionCard'
import { IconBall } from '../components/Icons'
import { haptic } from '../lib/telegram'

const DAYS = [0, 1, 2, 3, 4, 5, 6]
const GROUP_FILTERS = ['Все', ...GROUPS] as const

type Props = {
  bookings: Booking[]
  catalog: Catalog
  onOpenSession: (id: string) => void
  onCreateCustom: () => void
}

export function ScheduleScreen({ bookings, catalog, onOpenSession, onCreateCustom }: Props) {
  const { coaches: COACHES, courts: COURTS, sessions: SESSIONS } = catalog
  const [day, setDay] = useState(0)
  const [group, setGroup] = useState<(typeof GROUP_FILTERS)[number]>('Все')

  const daySessions = useMemo(
    () =>
      SESSIONS.filter((session) => session.dayOffset === day)
        .filter((session) => group === 'Все' || session.group === group)
        .sort((a, b) => a.start.localeCompare(b.start)),
    [SESSIONS, day, group],
  )

  const totalSeats = SESSIONS.filter((session) => session.dayOffset === day).reduce(
    (sum, session) => sum + Math.max(session.seatsTotal - session.seatsTaken, 0),
    0,
  )

  return (
    <div className="screen">
      <ScreenHeader
        eyebrow="Клуб ДТ"
        title="Расписание"
        subtitle={`${totalSeats} свободных мест на выбранный день`}
        action={
          <button type="button" className="btn btn-tonal btn-sm" onClick={onCreateCustom}>
            Свой урок
          </button>
        }
      />

      <DayStrip days={DAYS} active={day} onSelect={(value) => { haptic('select'); setDay(value) }} />

      <div className="pad" style={{ marginTop: 14 }}>
        <div className="scroller scroller--flat">
          {GROUP_FILTERS.map((item) => (
            <button
              key={item}
              type="button"
              className="chip"
              aria-pressed={group === item}
              onClick={() => { haptic('select'); setGroup(item) }}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="pad stack gap-3" style={{ marginTop: 16 }}>
        {daySessions.length === 0 ? (
          <div className="card card-pad empty">
            <span className="empty-icon"><IconBall size={26} /></span>
            <p className="t-headline">На этот день занятий нет</p>
            <p className="t-footnote" style={{ maxWidth: 260 }}>
              Выберите другой день или соберите индивидуальную тренировку с тренером.
            </p>
            <button type="button" className="btn btn-tonal btn-sm" style={{ marginTop: 12 }} onClick={onCreateCustom}>
              Индивидуально
            </button>
          </div>
        ) : (
          daySessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              coach={COACHES.find((coach) => coach.id === session.coachId)}
              court={COURTS.find((court) => court.id === session.courtId)}
              booked={bookings.some((item) => item.kind === 'training' && item.sourceId === session.id)}
              onOpen={() => onOpenSession(session.id)}
            />
          ))
        )}
      </div>

      <div className="pad" style={{ marginTop: 22 }}>
        <div className="legend card card-pad">
          <p className="t-caption" style={{ marginBottom: 10 }}>Как читать расписание</p>
          {[
            { tag: 'Группа', text: 'до 6 человек, одинаковый уровень' },
            { tag: 'Сплит', text: 'два игрока и тренер, максимум внимания' },
            { tag: 'Дети', text: 'группы 5–14 лет, тренер Илья Гордин' },
          ].map((item) => (
            <div key={item.tag} className="legend-row">
              <span className="badge badge-muted">{item.tag}</span>
              <span className="t-footnote grow">{item.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
