import type { Order } from '../lib/types'
import { Sheet } from './Sheet'
import { formatPrice } from '../lib/format'
import { IconBag } from './Icons'

type Props = {
  open: boolean
  orders: Order[]
  onClose: () => void
  onGoShop: () => void
}

export function OrdersSheet({ open, orders, onClose, onGoShop }: Props) {
  const total = orders.reduce((sum, item) => sum + item.price, 0)

  return (
    <Sheet
      open={open}
      title="Мои заказы"
      subtitle={`${orders.length} · резерв 48 часов`}
      onClose={onClose}
      footer={
        orders.length > 0 ? (
          <div className="stack gap-2">
            <div className="row-between">
              <span className="t-footnote">Итого к оплате в клубе</span>
              <span className="t-title3 t-num">{formatPrice(total)}</span>
            </div>
            <button type="button" className="btn btn-tonal btn-block" onClick={onClose}>
              Понятно
            </button>
          </div>
        ) : null
      }
    >
      {orders.length === 0 ? (
        <div className="empty">
          <span className="empty-icon"><IconBag size={26} /></span>
          <p className="t-headline">Заказов пока нет</p>
          <p className="t-footnote" style={{ maxWidth: 250 }}>
            Экипировку и услуги можно забрать на ресепшене — оплата при получении.
          </p>
          <button type="button" className="btn btn-tonal btn-sm" style={{ marginTop: 12 }} onClick={onGoShop}>
            В магазин
          </button>
        </div>
      ) : (
        <div className="group">
          {orders.map((order) => (
            <div key={order.id} className="group-row">
              <span className="group-icon"><IconBag size={17} /></span>
              <span className="grow stack">
                <span className="t-subhead" style={{ fontWeight: 550 }}>{order.title}</span>
                <span className="t-footnote">Резерв активен · заберите на ресепшене</span>
              </span>
              <span className="t-subhead t-num">{formatPrice(order.price)}</span>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  )
}
