import type { Coach, Court, TrainingSession } from '../lib/types'
import { endTime, formatDuration } from '../lib/date'
import { formatPrice, seatsLabel } from '../lib/format'
import { IconCheck, IconChevron, IconUsers } from './Icons'

type Props = {
  session: TrainingSession
  coach: Coach | undefined
  court: Court | undefined
  booked: boolean
  onOpen: () => void
}

export function SessionCard({ session, coach, court, booked, onOpen }: Props) {
  const seats = session.seatsTotal - session.seatsTaken
  const isFull = seats <= 0
  const almostFull = !isFull && seats <= 1

  return (
    <article className={`session card${isFull ? ' is-full' : ''}`}>
      <div className="session-time">
        <span className="session-time-start t-num">{session.start}</span>
        <span className="session-time-end t-num">{endTime(session.start, session.durationMin)}</span>
        <span className="session-time-dur">{formatDuration(session.durationMin)}</span>
      </div>

      <div className="session-body grow">
        <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
          <span className="badge badge-muted">{session.group}</span>
          <span className="badge badge-green">{session.level}</span>
          {booked ? (
            <span className="badge badge-lime">
              <IconCheck size={11} strokeWidth={2.6} /> Вы записаны
            </span>
          ) : null}
        </div>
        <p className="t-headline" style={{ marginTop: 8 }}>{session.title}</p>
        <p className="t-footnote" style={{ marginTop: 3 }}>
          {coach?.name ?? 'Тренер'} · {court?.name ?? 'Корт'} · {court?.surface ?? 'Хард'}
        </p>

        <div className="session-foot">
          <span className="row gap-2 t-footnote">
            <IconUsers size={14} />
            <span className={almostFull ? 'session-seats-hot' : isFull ? 't-muted' : undefined}>
              {seatsLabel(session.seatsTotal, session.seatsTaken)}
            </span>
          </span>
          <span className="session-price t-num">{formatPrice(session.price)}</span>
        </div>
      </div>

      <button
        type="button"
        className="session-open"
        onClick={onOpen}
        disabled={isFull}
        aria-label={isFull ? 'Мест нет' : `Записаться: ${session.title}`}
      >
        {isFull ? <span className="session-full">Мест нет</span> : <IconChevron size={18} />}
      </button>
    </article>
  )
}
