const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']
const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

export function dayDate(offset: number): Date {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + offset)
  return date
}

/** Короткое имя дня: «Сегодня», «Завтра», «пт». */
export function dayName(offset: number): string {
  if (offset === 0) return 'Сегодня'
  if (offset === 1) return 'Завтра'
  const weekday = WEEKDAYS_SHORT[dayDate(offset).getDay()]
  return weekday ? weekday.charAt(0).toUpperCase() + weekday.slice(1) : ''
}

export function dayNumber(offset: number): number {
  return dayDate(offset).getDate()
}

export function weekdayWithMonth(offset: number): string {
  const date = dayDate(offset)
  const weekday = WEEKDAYS[date.getDay()] ?? ''
  const month = MONTHS[date.getMonth()] ?? ''
  return `${weekday}, ${date.getDate()} ${month}`
}

export function weeklyStripStrings(): string[] {
  return WEEKDAYS_SHORT
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`
}

export function endTime(start: string, durationMin: number): string {
  const [rawHours, rawMinutes] = start.split(':')
  const total = Number(rawHours ?? 0) * 60 + Number(rawMinutes ?? 0) + durationMin
  const hours = Math.floor(total / 60) % 24
  const minutes = total % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function minutesUntil(offset: number, start: string): number {
  const [rawHours, rawMinutes] = start.split(':')
  const target = dayDate(offset)
  target.setHours(Number(rawHours ?? 0), Number(rawMinutes ?? 0), 0, 0)
  return Math.round((target.getTime() - Date.now()) / 60000)
}
