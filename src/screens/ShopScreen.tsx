import { useMemo, useState } from 'react'
import { PRODUCTS, PRODUCT_CATEGORIES } from '../data/club'
import type { Product } from '../lib/types'
import { ScreenHeader } from '../components/Chrome'
import { IconBag, IconChevron, IconHeart, IconStar } from '../components/Icons'
import { formatPrice } from '../lib/format'
import { haptic } from '../lib/telegram'

const CATEGORIES = PRODUCT_CATEGORIES

type Props = {
  favorites: string[]
  orderCount: number
  onToggleFavorite: (id: string) => void
  onOpenProduct: (id: string) => void
  onOpenOrders: () => void
}

export function ShopScreen({ favorites, orderCount, onToggleFavorite, onOpenProduct, onOpenOrders }: Props) {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('Все')

  const products = useMemo(
    () => PRODUCTS.filter((product) => category === 'Все' || product.category === category),
    [category],
  )

  return (
    <div className="screen">
      <ScreenHeader
        eyebrow="Клубный магазин"
        title="Магазин"
        subtitle="Экипировка, струны и услуги клуба"
        action={
          <button type="button" className="orders-link" onClick={onOpenOrders}>
            <IconBag size={18} />
            {orderCount > 0 ? <span className="orders-count t-num">{orderCount}</span> : null}
          </button>
        }
      />

      <div className="pad">
        <div className="scroller">
          {CATEGORIES.map((item) => (
            <button
              key={item}
              type="button"
              className="chip"
              aria-pressed={category === item}
              onClick={() => { haptic('select'); setCategory(item) }}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="pad" style={{ marginTop: 18 }}>
        <div className="shop-grid">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              favorite={favorites.includes(product.id)}
              onOpen={() => onOpenProduct(product.id)}
              onToggleFavorite={() => { haptic('light'); onToggleFavorite(product.id) }}
            />
          ))}
        </div>
      </div>

      <div className="pad" style={{ marginTop: 22 }}>
        <div className="group">
          <div className="group-row">
            <span className="group-icon"><IconStar size={17} /></span>
            <span className="grow stack">
              <span className="t-subhead" style={{ fontWeight: 550 }}>Натяжка и подбор ракетки</span>
              <span className="t-footnote">Бесплатно при покупке в клубе</span>
            </span>
            <IconChevron size={17} className="t-muted" />
          </div>
          <div className="group-row">
            <span className="group-icon"><IconBag size={17} /></span>
            <span className="grow stack">
              <span className="t-subhead" style={{ fontWeight: 550 }}>Забрать на ресепшене</span>
              <span className="t-footnote">Резерв держим 48 часов</span>
            </span>
            <IconChevron size={17} className="t-muted" />
          </div>
        </div>
      </div>
    </div>
  )
}

function ProductCard({
  product,
  favorite,
  onOpen,
  onToggleFavorite,
}: {
  product: Product
  favorite: boolean
  onOpen: () => void
  onToggleFavorite: () => void
}) {
  return (
    <article className="product card card-press">
      <button type="button" className="product-open" onClick={onOpen} aria-label={product.title}>
        <div className={`product-media${product.image ? '' : ' is-plain'}`}>
          {product.image ? (
            <img src={product.image} alt="" loading="lazy" />
          ) : (
            <span className="product-placeholder" aria-hidden>
              <span className="product-chip" style={{ background: product.colors[0] }} />
            </span>
          )}
          {product.badge ? <span className="product-badge badge badge-lime">{product.badge}</span> : null}
        </div>
        <div className="product-info">
          <p className="t-subhead product-title">{product.title}</p>
          <p className="t-footnote product-sub">{product.subtitle}</p>
          <div className="product-price">
            <span className="t-num">{formatPrice(product.price)}</span>
            {product.oldPrice ? <span className="product-old t-num">{formatPrice(product.oldPrice)}</span> : null}
          </div>
        </div>
      </button>
      <button
        type="button"
        className={`product-fav${favorite ? ' is-on' : ''}`}
        onClick={onToggleFavorite}
        aria-pressed={favorite}
        aria-label={favorite ? 'Убрать из избранного' : 'В избранное'}
      >
        <IconHeart size={17} filled={favorite} />
      </button>
    </article>
  )
}
