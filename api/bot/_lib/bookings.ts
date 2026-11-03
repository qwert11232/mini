import { audit, getDb, type Result } from './db.js'

/**
 * Действия панели по записям: отмена, восстановление, правка мест, выдача заказа.
 * Все проверяют текущее состояние в SQL, поэтому двойное нажатие кнопки
 * не создаёт двойных списаний.
 */

/** Отмена записи админом: возвращает место или окно аренды в продажу. */
export async function cancelBooking(bookingId: string, adminTelegramId: number): Promise<Result> {
  if (!bookingId) return { ok: false, message: 'Запись не найдена' }
  const sql = getDb()

  const cancelled = (await sql`
    update bookings
    set status = 'cancelled', cancelled_at = now()
    where id = ${bookingId} and status = 'active'
    returning kind, source_id as "sourceId", title
  `) as unknown as { kind: string; sourceId: string; title: string }[]

  const row = cancelled[0]
  if (!row) return { ok: false, message: 'Запись уже отменена' }

  if (row.kind === 'free') {
    await sql`update free_slots set is_active = true where id = ${row.sourceId}`
  } else {
    await sql`update training_sessions set seats_taken = greatest(seats_taken - 1, 0) where id = ${row.sourceId}`
  }

  await audit(adminTelegramId, 'booking.cancel', { bookingId, kind: row.kind, title: row.title })
  return { ok: true, message: 'Запись отменена' }
}

/** Ручная корректировка числа записавшихся (админ видит реальную явку). */
export async function shiftSeats(sessionId: string, delta: number, adminTelegramId: number): Promise<Result> {
  if (!sessionId) return { ok: false, message: 'Занятие не найдено' }
  const sql = getDb()

  const updated = (await sql`
    update training_sessions
    set seats_taken = least(greatest(seats_taken + ${delta}, 0), seats_total)
    where id = ${sessionId}
    returning seats_taken as taken, seats_total as total
  `) as unknown as { taken: number; total: number }[]

  const row = updated[0]
  if (!row) return { ok: false, message: 'Занятие не найдено' }

  await audit(adminTelegramId, 'session.seats', { sessionId, delta, taken: row.taken })
  return { ok: true, message: `Места: ${row.taken}/${row.total}` }
}

/** Заказ выдан на ресепшене: закрываем и уведомляем покупателя. */
export async function markIssued(orderId: string, adminTelegramId: number): Promise<Result> {
  if (!orderId) return { ok: false, message: 'Заказ не найден' }
  const sql = getDb()

  const updated = (await sql`
    update orders set status = 'issued'
    where id = ${orderId} and status = 'reserved'
    returning id, price
  `) as unknown as { id: string; price: number }[]

  if (!updated[0]) return { ok: false, message: 'Заказ уже выдан' }

  await audit(adminTelegramId, 'order.issued', { orderId, price: updated[0].price })
  const [buyer] = (await sql`
    select u.telegram_id as "telegramId", p.title
    from orders o join users u on u.id = o.user_id join products p on p.id = o.product_id
    where o.id = ${orderId}
  `) as unknown as { telegramId: number; title: string }[]

  if (buyer) {
    await sendBuyerNotice(buyer.telegramId, buyer.title)
  }
  return { ok: true, message: 'Заказ выдан' }
}

/** Уведомление покупателю; ошибка отправки не должна ломать выдачу. */
async function sendBuyerNotice(telegramId: number, title: string): Promise<void> {
  try {
    const { sendMessage } = await import('./telegram.js')
    await sendMessage(telegramId, `Заказ готов к выдаче: <b>${title}</b>. Ждём на ресепшене.`)
  } catch (error) {
    console.warn('[bot] не удалось уведомить покупателя', error instanceof Error ? error.message : error)
  }
}
