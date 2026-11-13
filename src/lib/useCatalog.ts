import { useCallback, useEffect, useState } from 'react'
import { api, type Catalog } from './api'
import { demoCatalog } from './store'

/** В продакшене не подменяем недоступный каталог вымышленными демо-данными. */
export function useCatalog() {
  const [catalog, setCatalog] = useState<Catalog>(() => demoCatalog())
  const [revision, setRevision] = useState(0)
  const [source, setSource] = useState<'loading' | 'demo' | 'api' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    setSource('loading')

    api.catalog().then((data) => {
      if (cancelled) return
      setCatalog(data)
      setSource('api')
    }).catch(() => {
      if (cancelled) return
      setSource(import.meta.env.DEV ? 'demo' : 'error')
    })

    return () => { cancelled = true }
  }, [revision])

  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  return { catalog, source, refresh }
}
