/**
 * Тонкая обёртка над Telegram WebApp SDK.
 * Задача: приложение должно работать и в браузере (превью), и внутри Telegram.
 */

type TelegramHaptic = {
  impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void
  notificationOccurred: (type: 'error' | 'success' | 'warning') => void
  selectionChanged: () => void
}

type TelegramWebApp = {
  initData: string
  initDataUnsafe?: { user?: { id: number; first_name?: string; last_name?: string; username?: string } }
  platform: string
  colorScheme: 'light' | 'dark'
  ready: () => void
  expand: () => void
  setHeaderColor?: (color: string) => void
  setBackgroundColor?: (color: string) => void
  enableClosingConfirmation?: () => void
  HapticFeedback?: TelegramHaptic
  BackButton?: {
    show: () => void
    hide: () => void
    onClick: (cb: () => void) => void
    offClick: (cb: () => void) => void
  }
  disableVerticalSwipes?: () => void
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}

export function getTelegram(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null
}

export function isInsideTelegram(): boolean {
  return Boolean(getTelegram()?.initData)
}

/** Инициализация: разворачиваем на весь экран и красим шапку под клуб. */
export function initTelegram(): void {
  const app = getTelegram()
  if (!app) return
  app.ready()
  app.expand()
  app.setHeaderColor?.('#0B3B27')
  app.setBackgroundColor?.('#F6F8F5')
  app.disableVerticalSwipes?.()
}

export function haptic(kind: 'select' | 'light' | 'success' | 'error'): void {
  const feedback = getTelegram()?.HapticFeedback
  if (!feedback) return
  if (kind === 'select') feedback.selectionChanged()
  else if (kind === 'success') feedback.notificationOccurred('success')
  else if (kind === 'error') feedback.notificationOccurred('error')
  else feedback.impactOccurred('light')
}

export function userName(): string | null {
  const user = getTelegram()?.initDataUnsafe?.user
  if (!user) return null
  return user.first_name ?? user.username ?? null
}

export function userInitials(): string {
  const user = getTelegram()?.initDataUnsafe?.user
  if (!user) return 'ДТ'
  const first = user.first_name?.trim()?.[0] ?? ''
  const last = user.last_name?.trim()?.[0] ?? ''
  return (first + last).toUpperCase() || 'ДТ'
}

/** Ссылка на бота администрирования — заполняется на этапе подключения бота. */
export const ADMIN_BOT_URL = 'https://t.me/'
