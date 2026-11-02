import type { ReactNode } from 'react'

/** Крупный заголовок экрана в стиле iOS с поддержкой теннисного акцента. */
export function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <header className="screen-header pad">
      <div className="row-between">
        <div className="grow">
          {eyebrow ? <p className="t-caption">{eyebrow}</p> : null}
          <h1 className="t-large" style={{ marginTop: eyebrow ? 4 : 0 }}>{title}</h1>
        </div>
        {action}
      </div>
      {subtitle ? <p className="t-subhead t-muted" style={{ marginTop: 6 }}>{subtitle}</p> : null}
    </header>
  )
}

/** Липкий заголовок секции. */
export function SectionTitle({
  title,
  action,
}: {
  title: string
  action?: ReactNode
}) {
  return (
    <div className="row-between section-title pad">
      <h2 className="t-title3">{title}</h2>
      {action}
    </div>
  )
}
