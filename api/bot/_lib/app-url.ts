import type { InlineButton } from './telegram.js'

const DEFAULT_APP_URL = 'https://mini-seven-xi.vercel.app'

/**
 * Один адрес для кнопок и webhook. Неверный VITE_APP_URL не подменяем другим
 * доменом: это могло бы незаметно перенаправить бота на чужой deployment.
 */
export function appUrl(): string {
  const value = process.env.VITE_APP_URL === undefined ? DEFAULT_APP_URL : process.env.VITE_APP_URL.trim()
  try {
    const parsed = new URL(value)
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.search && !parsed.hash) {
      return parsed.toString().replace(/\/+$/, '')
    }
  } catch {
    // Ниже выдаём одну понятную ошибку, не включая значение переменной в лог.
  }
  throw new Error('VITE_APP_URL должен быть HTTPS-адресом без логина, пароля, query и fragment')
}

/** Inline-кнопка Telegram, открывающая Mini App внутри клиента, а не в браузере. */
export function appButton(text = '🎾 Открыть приложение'): InlineButton {
  return { text, web_app: { url: appUrl() } }
}
