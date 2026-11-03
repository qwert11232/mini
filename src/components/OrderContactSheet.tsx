import { useEffect, useState } from 'react'
import type { OrderContact, Product } from '../lib/types'
import { formatPrice } from '../lib/format'
import { IconCheck, IconPhone } from './Icons'
import { Sheet } from './Sheet'

type SubmitResult = { ok: boolean; error?: string; clientLabel?: string }

type Props = {
  open: boolean
  product: Product | null
  quantity: number
  clientLabel?: string
  initialName?: string
  initialPhone?: string | null
  onClose: () => void
  onSubmit: (contact: OrderContact) => Promise<SubmitResult>
}

/** Отдельный шаг заказа: без контактов администратор не сможет перезвонить. */
export function OrderContactSheet({
  open,
  product,
  quantity,
  clientLabel,
  initialName = '',
  initialPhone = '',
  onClose,
  onSubmit,
}: Props) {
  const [name, setName] = useState(initialName)
  const [phone, setPhone] = useState(initialPhone ?? '')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(initialName)
    setPhone(initialPhone ?? '')
    setError('')
    setSubmitting(false)
  }, [open, product?.id, initialName, initialPhone])

  if (!product) return null

  const submit = async () => {
    const cleanName = name.trim()
    const digits = phone.replace(/\D/g, '')
    if (cleanName.length < 2) {
      setError('Напишите, как к вам обращаться')
      return
    }
    if (digits.length < 10 || digits.length > 15) {
      setError('Проверьте номер телефона: нужно 10–15 цифр')
      return
    }

    setError('')
    setSubmitting(true)
    try {
      const result = await onSubmit({ name: cleanName, phone: phone.trim() })
      if (!result.ok) setError(result.error ?? 'Не удалось оформить заказ')
    } catch {
      setError('Сервис недоступен. Проверьте соединение и попробуйте ещё раз.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet
      open={open}
      title="Контакты для заказа"
      subtitle={`${product.title} ×${quantity}`}
      onClose={onClose}
      footer={
        <div className="stack gap-2">
          <div className="row-between">
            <span className="t-footnote">К оплате в клубе</span>
            <span className="t-title3 t-num">{formatPrice(product.price * quantity)}</span>
          </div>
          <button type="submit" form="order-contact-form" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? 'Сохраняем…' : 'Подтвердить заказ'}
          </button>
        </div>
      }
    >
      <form
        id="order-contact-form"
        className="stack gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="contact-note">
          <span className="contact-note-icon"><IconPhone size={18} /></span>
          <p className="t-footnote">
            Оставьте имя и телефон — администратор увидит их в заказе и сможет позвонить, когда всё будет готово.
          </p>
        </div>

        {clientLabel ? (
          <div className="client-number-row">
            <span className="t-footnote">Ваш номер клиента</span>
            <strong className="t-subhead t-num">{clientLabel}</strong>
          </div>
        ) : null}

        <label className="field">
          <span className="field-label">Ваше имя</span>
          <input
            className="text-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Например, Никита"
            autoComplete="name"
            maxLength={80}
            required
          />
        </label>

        <label className="field">
          <span className="field-label">Телефон для связи</span>
          <input
            className="text-input"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+7 (900) 000-00-00"
            autoComplete="tel"
            maxLength={40}
            required
          />
        </label>

        {error ? <p className="form-error" role="alert">{error}</p> : null}

        <p className="t-caption contact-privacy">
          <IconCheck size={13} /> Контакты используются только для этого заказа и записей в клубе.
        </p>
      </form>
    </Sheet>
  )
}
