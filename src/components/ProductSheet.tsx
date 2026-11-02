import { useState } from 'react'
import type { Product } from '../lib/types'
import { Sheet } from './Sheet'
import { formatPrice } from '../lib/format'
import { IconCheck, IconHeart, IconMinus, IconPlus } from './Icons'

type Props = {
  product: Product | null
  favorite: boolean
  onClose: () => void
  onToggleFavorite: () => void
  onOrder: (product: Product, quantity: number) => void
}

export function ProductSheet({ product, favorite, onClose, onToggleFavorite, onOrder }: Props) {
  const [quantity, setQuantity] = useState(1)

  return (
    <Sheet
      open={product !== null}
      title={product?.title ?? 'Товар'}
      subtitle={product?.subtitle}
      onClose={onClose}
      footer={
        product ? (
          <div className="stack gap-3">
            <div className="row-between">
              <div className="stepper">
                <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} aria-label="Меньше">
                  <IconMinus size={16} />
                </button>
                <span className="t-num">{quantity}</span>
                <button type="button" onClick={() => setQuantity((value) => Math.min(9, value + 1))} aria-label="Больше">
                  <IconPlus size={16} />
                </button>
              </div>
              <span className="t-title3 t-num">{formatPrice(product.price * quantity)}</span>
            </div>
            <button type="button" className="btn btn-primary btn-block" onClick={() => onOrder(product, quantity)}>
              Оформить
            </button>
          </div>
        ) : null
      }
    >
      {product ? (
        <div className="stack gap-4">
          <div className={`product-sheet-media${product.image ? '' : ' is-plain'}`}>
            {product.image ? (
              <img src={product.image} alt={product.title} />
            ) : (
              <span className="product-sheet-placeholder" aria-hidden />
            )}
            <button
              type="button"
              className={`product-fav product-fav-lg${favorite ? ' is-on' : ''}`}
              onClick={onToggleFavorite}
              aria-pressed={favorite}
              aria-label="В избранное"
            >
              <IconHeart size={18} filled={favorite} />
            </button>
          </div>

          <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
            <span className="badge badge-green">{product.category}</span>
            <span className="badge badge-muted">В наличии</span>
            {product.badge ? <span className="badge badge-lime">{product.badge}</span> : null}
          </div>

          <div className="stack gap-2">
            <div className="row-between">
              <span className="t-footnote">Цена</span>
              <span className="t-subhead t-num" style={{ fontWeight: 600 }}>
                {formatPrice(product.price)}
                {product.oldPrice ? <span className="product-old t-num"> {formatPrice(product.oldPrice)}</span> : null}
              </span>
            </div>
            <div className="row-between">
              <span className="t-footnote">Цвета</span>
              <span className="row gap-2">
                {product.colors.map((color) => (
                  <span key={color} className="color-swatch" style={{ background: color }} />
                ))}
              </span>
            </div>
            <div className="row-between">
              <span className="t-footnote">Выдача</span>
              <span className="t-subhead">Ресепшен клуба</span>
            </div>
          </div>

          <div className="product-perks">
            {['Резерв 48 часов', 'Оплата в клубе или в боте', 'Обмен в течение 14 дней'].map((item) => (
              <span key={item} className="row gap-2 t-footnote">
                <IconCheck size={14} strokeWidth={2.4} className="booking-check" />
                {item}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </Sheet>
  )
}
