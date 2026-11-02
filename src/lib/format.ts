const rubles = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
})

export function formatPrice(value: number): string {
  return rubles.format(value).replace(/\s/g, '\u00A0')
}

export function pluralize(count: number, forms: [string, string, string]): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}

export function seatsLabel(total: number, taken: number): string {
  const free = Math.max(total - taken, 0)
  if (free === 0) return 'Мест нет'
  return `${free} ${pluralize(free, ['место', 'места', 'мест'])} свободно`
}
