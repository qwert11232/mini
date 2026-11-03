/**
 * Ключ устройства: у браузера вне Telegram нет подписи, поэтому записи
 * привязываются к случайной метке в localStorage. Пока метка та же —
 * записи видит и сайт, и админка в боте (гостем «Гость с сайта»).
 */
const DEVICE_KEY = 'dt.device.v1'

function randomKey(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 40)
}

export function deviceKey(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY)
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing
    const created = randomKey()
    localStorage.setItem(DEVICE_KEY, created)
    return created
  } catch {
    // Приватный режим: метка живёт только в памяти вкладки.
    return randomKey()
  }
}
