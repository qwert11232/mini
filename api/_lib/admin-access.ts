/** Доступ администратора определяется только неизменяемым Telegram ID. */
const DEFAULT_ADMIN_IDS = '793536041'

export function adminIds(): string[] {
  const configured = process.env.ADMIN_TELEGRAM_IDS ?? DEFAULT_ADMIN_IDS
  return [...new Set(configured.split(',').map((value) => value.trim()).filter((value) => {
    if (!/^[1-9]\d*$/.test(value)) return false
    return Number.isSafeInteger(Number(value))
  }))]
}

export function isAdminId(telegramId: number): boolean {
  return Number.isSafeInteger(telegramId) && telegramId > 0 && adminIds().includes(String(telegramId))
}
