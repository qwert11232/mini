import { useEffect, useState } from 'react'
import { IconCheck } from './Icons'

export type ToastPayload = { id: number; title: string; text?: string }

export function useToast() {
  const [toast, setToast] = useState<ToastPayload | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const show = (title: string, text?: string) => setToast({ id: Date.now(), title, text })

  return { toast, show }
}

export function Toast({ toast }: { toast: ToastPayload | null }) {
  if (!toast) return null
  return (
    <div className="toast glass" role="status" aria-live="polite" key={toast.id}>
      <span className="toast-icon">
        <IconCheck size={15} strokeWidth={2.4} />
      </span>
      <span className="stack">
        <strong className="t-subhead">{toast.title}</strong>
        {toast.text ? <span className="t-footnote">{toast.text}</span> : null}
      </span>
    </div>
  )
}
