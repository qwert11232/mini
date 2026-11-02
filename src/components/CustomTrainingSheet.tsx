import { useState } from 'react'
import { LEVELS } from '../data/club'
import type { Coach } from '../lib/types'
import { Sheet } from './Sheet'
import { IconCheck } from './Icons'
import { dayName } from '../lib/date'
import { formatPrice } from '../lib/format'
import type { Level } from '../lib/types'

const TIMES = ['08:00', '10:00', '12:00', '16:00', '18:30', '20:00']
const DAYS = [0, 1, 2, 3, 4, 5, 6]

type Draft = {
  title: string
  subtitle: string
  dayOffset: number
  start: string
  durationMin: number
  price: number
}

type Props = {
  coaches: Coach[]
  open: boolean
  onClose: () => void
  onBook: (draft: Draft) => void
}

export function CustomTrainingSheet({ coaches: COACHES, open, onClose, onBook }: Props) {
  const [coachId, setCoachId] = useState(COACHES[0]?.id ?? '')

  const [level, setLevel] = useState<Level>('Любитель')
  const [dayOffset, setDayOffset] = useState(1)
  const [start, setStart] = useState(TIMES[2] ?? '12:00')

  const coach = COACHES.find((item) => item.id === coachId)
  const price = 3500

  return (
    <Sheet
      open={open}
      title="Свой урок"
      subtitle="Индивидуальная тренировка · 60 минут"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={!coach}
          onClick={() =>
            onBook({
              title: 'Индивидуальная тренировка',
              subtitle: `${coach?.name ?? 'Тренер'} · ${level}`,
              dayOffset,
              start,
              durationMin: 60,
              price,
            })
          }
        >
          Записаться · {formatPrice(price)}
        </button>
      }
    >
      <div className="stack gap-5">
        <section className="stack gap-2">
          <p className="t-caption">Тренер</p>
          <div className="stack gap-2">
            {COACHES.map((item) => {
              const active = item.id === coachId
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`pick-row${active ? ' is-active' : ''}`}
                  aria-pressed={active}
                  onClick={() => setCoachId(item.id)}
                >
                  <span className="coach-face coach-face-sm" aria-hidden>{item.initials}</span>
                  <span className="grow stack">
                    <span className="t-subhead" style={{ fontWeight: 550 }}>{item.name}</span>
                    <span className="t-footnote">{item.role}</span>
                  </span>
                  {active ? <IconCheck size={17} className="pick-check" /> : null}
                </button>
              )
            })}
          </div>
        </section>

        <section className="stack gap-2">
          <p className="t-caption">Уровень</p>
          <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
            {LEVELS.map((item) => (
              <button
                key={item}
                type="button"
                className="chip"
                aria-pressed={level === item}
                onClick={() => setLevel(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </section>

        <section className="stack gap-2">
          <p className="t-caption">День</p>
          <div className="scroller" style={{ marginInline: 0, paddingInline: 0 }}>
            {DAYS.map((offset) => (
              <button
                key={offset}
                type="button"
                className="chip"
                aria-pressed={dayOffset === offset}
                onClick={() => setDayOffset(offset)}
              >
                {dayName(offset)}
              </button>
            ))}
          </div>
        </section>

        <section className="stack gap-2">
          <p className="t-caption">Время</p>
          <div className="time-grid">
            {TIMES.map((time) => (
              <button
                key={time}
                type="button"
                className={`time-pick t-num${start === time ? ' is-active' : ''}`}
                aria-pressed={start === time}
                onClick={() => setStart(time)}
              >
                {time}
              </button>
            ))}
          </div>
        </section>
      </div>
    </Sheet>
  )
}
