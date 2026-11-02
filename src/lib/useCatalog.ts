import { useEffect, useState } from 'react'
import { api, type Catalog } from './api'
import { demoCatalog } from './store'

/**
 * Каталог (корты, тренеры, занятия, окна, товары) из /api/catalog.
 * Пока ответа нет — сразу показываем демо-данные, чтобы экран не пустовал;
 * если API недоступен, демо остаётся рабочим.
 */
export function useCatalog() {
  const [catalog, setCatalog] = useState<Catalog>(() => demoCatalog())
  const [source, setSource] = useState<'demo' | 'api'>('demo')

  useEffect(() => {
    let cancelled = false

    api
      .catalog()
      .then((data) => {
        if (cancelled) return
        setCatalog(data)
        setSource('api')
      })
      .catch(() => {
        // Демо-данные уже на экране — ничего не ломаем.
      })

    return () => {
      cancelled = true
    }
  }, [])

  return { catalog, source }
}
