import type { Booking } from '../lib/types'
import { dayName, endTime } from '../lib/date'
import { formatPrice } from '../lib/format'
import { IconClose } from './Icons'

export function BookingRow({ booking, onCancel }: { booking: Booking; onCancel: () => void }) {
  return (
    <div className="booking-row">
      <span className={`booking-dot booking-dot-${booking.kind}`} aria-hidden />
      <span className="grow stack">
        <span className="t-subhead" style={{ fontWeight: 550 }}>{booking.title}</span>
        <span className="t-footnote">
          {dayName(booking.dayOffset)} · {booking.start}–{endTime(booking.start, booking.durationMin)} ·{' '}
          <span className="t-num">{formatPrice(booking.price)}</span>
        </span>
        <span className="t-footnote">{booking.subtitle}</span>
      </span>
      <button type="button" className="booking-cancel" onClick={onCancel} aria-label={`Отменить: ${booking.title}`}>
        <IconClose size={14} />
      </button>
    </div>
  )
}
