import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconClose } from './Icons'

type SheetProps = {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

/** Нижняя шторка в духе iOS: пружинное появление, затемнение, закрытие по фону. */
export function Sheet({ open, title, subtitle, onClose, children, footer }: SheetProps) {
  const [mounted, setMounted] = useState(open)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    const timer = window.setTimeout(() => setMounted(false), 280)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open])

  if (!mounted) return null

  return (
    <div className={`sheet-layer${open ? ' is-open' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="sheet-backdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-grabber" aria-hidden />
        <header className="sheet-header">
          <div className="grow">
            <h2 className="t-title3">{title}</h2>
            {subtitle ? <p className="t-footnote" style={{ marginTop: 2 }}>{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <IconClose size={18} />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-footer">{footer}</div> : null}
      </div>
    </div>
  )
}
