import { audit, getDb, type Result } from './db.js'

/**
 * Действия панели по записям: отмена, восстановление, правка мест, выдача заказа.
 * Все проверяют текущее состояние в SQL, поэтому двойное нажатие кнопки
 * не создаёт двойных списаний.
 */

/** Отмена записи админом и возврат места выполняются одной SQL-командой. */
export async function cancelBooking(bookingId: string, adminTelegramId: number): Promise<Result> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId)) {
    return { ok: false, message: 'Запись не найдена' }
  }
  const sql = getDb()
  const cancelled = (await sql`
    with cancelled as (
      update bookings set status = 'cancelled', cancelled_at = now()
      where id = ${bookingId}::uuid and status = 'active'
      returning id, kind, source_id, title
    ), released_slot as (
      update free_slots f set is_active = true from cancelled c
      where c.kind = 'free' and f.id = c.source_id
        and not exists (select 1 from bookings b where b.kind = 'free' and b.source_id = f.id and b.status = 'active' and b.id <> c.id)
      returning f.id
    ), released_seat as (
      update training_sessions s set seats_taken = greatest(s.seats_taken - 1, 0) from cancelled c
      where c.kind = 'training' and s.id = c.source_id returning s.id
    ), logged as (
      insert into admin_audit (telegram_id, action, payload)
      select ${adminTelegramId}, 'booking.cancel',
             jsonb_build_object('bookingId', ${bookingId}::text, 'kind', c.kind, 'title', c.title)
      from cancelled c returning id
    ) select kind, source_id as "sourceId", title from cancelled
  `) as unknown as { kind: string; sourceId: string; title: string }[]

  const row = cancelled[0]
  if (!row) return { ok: false, message: 'Запись уже отменена или не найдена' }
  return { ok: true, message: 'Запись отменена' }
}

/** Снять только запись ресепшена; места реальных игроков не затрагиваются. */
export async function cancelManualSeat(sessionId: string, adminTelegramId: number): Promise<Result> {
  if (!sessionId) return { ok: false, message: 'Занятие не найдено' }
  const sql = getDb()
  const updated = (await sql`
    with target as materialized (
      select b.id from bookings b
      where b.kind = 'training' and b.source_id = ${sessionId}
        and b.user_id is null and b.status = 'active'
        and exists (select 1 from training_sessions s where s.id = b.source_id)
      order by b.created_at desc, b.id desc
      limit 1 for update skip locked
    ), cancelled as (
      update bookings b set status = 'cancelled', cancelled_at = now()
      from target t where b.id = t.id and b.status = 'active'
      returning b.id, b.source_id
    ), released as (
      update training_sessions s set seats_taken = greatest(s.seats_taken - 1, 0)
      from cancelled c where s.id = c.source_id
      returning s.seats_taken as taken, s.seats_total as total
    ), logged as (
      insert into admin_audit (telegram_id, action, payload)
      select ${adminTelegramId}, 'session.manual_cancel', ${JSON.stringify({ sessionId })}::jsonb
      from released returning id
    ) select taken, total from released
  `) as unknown as { taken: number; total: number }[]
  const row = updated[0]
  if (!row) return { ok: false, message: 'Записей ресепшена нет. Запись игрока отменяется в разделе «Сегодня / Завтра».' }
  return { ok: true, message: `Запись ресепшена отменена: ${row.taken}/${row.total}` }
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
    const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    await sendMessage(telegramId, `Заказ <b>${safeTitle}</b> выдан. Спасибо!`)
  } catch (error) {
    console.warn('[bot] не удалось уведомить покупателя', error instanceof Error ? error.message : error)
  }
}
