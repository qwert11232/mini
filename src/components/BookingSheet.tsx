import type { ActiveBooking } from '../lib/booking'
import { dayName, endTime, formatDuration, weekdayWithMonth } from '../lib/date'
import { formatPrice } from '../lib/format'
import { CLUB } from '../data/club'
import { Sheet } from './Sheet'
import { IconPin, IconUsers } from './Icons'

type Props = {
  target: ActiveBooking | null
  options: ActiveBooking[]
  onSelect: (option: ActiveBooking) => void
  onClose: () => void
  onConfirm: () => void
}

export function BookingSheet({ target, options, onSelect, onClose, onConfirm }: Props) {
  const open = target !== null

  return (
    <Sheet
      open={open}
      title={target?.kind === 'training' ? 'Запись на занятие' : 'Аренда корта'}
      subtitle={target ? `${weekdayWithMonth(target.dayOffset)} · ${target.start}` : undefined}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary btn-block" onClick={onConfirm} disabled={!target}>
          {target ? `Подтвердить · ${formatPrice(target.price)}` : 'Подтвердить'}
        </button>
      }
    >
      {target ? (
        <div className="stack gap-4">
          <p className="t-footnote">Запись будет привязана к вашему аккаунту Telegram.</p>
          <div className="booking-hero">
            <p className="t-caption" style={{ color: 'var(--green-200)' }}>{target.eyebrow}</p>
            <p className="t-title3" style={{ color: '#fff', marginTop: 6 }}>{target.title}</p>
            <p className="t-footnote" style={{ color: 'rgba(241,250,245,0.72)', marginTop: 2 }}>{target.subtitle}</p>
            <div className="booking-hero-grid">
              <div>
                <span className="booking-key">Когда</span>
                <span className="booking-val">{dayName(target.dayOffset)}, {target.start}–{endTime(target.start, target.durationMin)}</span>
              </div>
              <div>
                <span className="booking-key">Длительность</span>
                <span className="booking-val">{formatDuration(target.durationMin)}</span>
              </div>
              <div>
                <span className="booking-key">Стоимость</span>
                <span className="booking-val t-num">{formatPrice(target.price)}</span>
              </div>
              <div>
                <span className="booking-key">Оплата</span>
                <span className="booking-val">На ресепшене</span>
              </div>
            </div>
          </div>

          {target.kind === 'free' && options.length > 1 ? (
            <div className="stack gap-2">
              <p className="t-headline">Продолжительность</p>
              <div className="scroller scroller--flat" role="group" aria-label="Продолжительность аренды">
                {options.map((option) => (
                  <button key={option.durationMin} type="button" className="chip"
                    aria-pressed={target.durationMin === option.durationMin} onClick={() => onSelect(option)}>
                    {formatDuration(option.durationMin)} · {formatPrice(option.price)}
                  </button>
                ))}
              </div>
              <p className="t-footnote">Последовательные окна бронируются вместе, отменить их можно по отдельности.</p>
            </div>
          ) : null}

          <div className="group">
            <div className="group-row">
              <span className="group-icon"><IconPin size={18} /></span>
              <span className="grow stack">
                <span className="t-subhead" style={{ fontWeight: 550 }}>{CLUB.name} · {CLUB.address}</span>
                <span className="t-footnote">{CLUB.hours}</span>
              </span>
            </div>
            <div className="group-row">
              <span className="group-icon"><IconUsers size={18} /></span>
              <span className="grow stack">
                <span className="t-subhead" style={{ fontWeight: 550 }}>{target.people}</span>
                <span className="t-footnote">Отменить запись можно в разделе «О нас»</span>
              </span>
            </div>

          </div>


        </div>
      ) : null}
    </Sheet>
  )
}
