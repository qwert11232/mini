/** Тонкая обёртка над официальным Telegram WebApp SDK. */

type TelegramHaptic = {
  impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void
  notificationOccurred: (type: 'error' | 'success' | 'warning') => void
  selectionChanged: () => void
}

type TelegramWebApp = {
  initData: string
  platform: string
  colorScheme: 'light' | 'dark'
  ready: () => void
  expand: () => void
  close?: () => void
  openTelegramLink?: (url: string) => void
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

/** Ссылка для связи ведёт в чат бота, не на сайт приложения. */
export function openTelegramLink(url: string): boolean {
  const app = getTelegram()
  if (!app?.openTelegramLink) return false
  try {
    app.openTelegramLink(url)
    return true
  } catch {
    return false
  }
}

export const ADMIN_BOT_URL = import.meta.env.VITE_ADMIN_BOT_URL || 'https://t.me/testtesttennisbot'
export const CLUB_BOT_NAME = (import.meta.env.VITE_TELEGRAM_BOT_NAME || 'testtesttennisbot').replace(/^@/, '')
