import { dayName, dayNumber, weekdayWithMonth } from '../lib/date'

type Props = {
  days: number[]
  active: number
  onSelect: (offset: number) => void
}

/** Горизонтальная лента дней: «Сегодня / Завтра / пт 7». */
export function DayStrip({ days, active, onSelect }: Props) {
  return (
    <div className="day-strip-wrap">
      <div className="scroller day-strip">
        {days.map((offset) => {
          const isActive = offset === active
          return (
            <button
              key={offset}
              type="button"
              className={`day-chip${isActive ? ' is-active' : ''}`}
              aria-pressed={isActive}
              onClick={() => onSelect(offset)}
            >
              <span className="day-chip-name">{offset < 2 ? dayName(offset) : dayName(offset)}</span>
              <span className="day-chip-num t-num">{dayNumber(offset)}</span>
            </button>
          )
        })}
      </div>
      <p className="day-strip-label pad t-footnote">{weekdayWithMonth(active)}</p>
    </div>
  )
}
