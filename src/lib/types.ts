export type SectionId = 'home' | 'schedule' | 'play' | 'shop' | 'about'

export type Level = 'Новичок' | 'Любитель' | 'Средний' | 'Продвинутый'

export type CourtSurface = 'Хард' | 'Грунт' | 'Крытый хард'

export type Court = {
  id: string
  name: string
  surface: CourtSurface
}

export type Coach = {
  id: string
  name: string
  role: string
  initials: string
  rating: number
}

export type TrainingGroup = 'Группа' | 'Сплит' | 'Индивидуально' | 'Дети' | 'Корт-фитнес'

export type TrainingSession = {
  id: string
  title: string
  group: TrainingGroup
  level: Level
  coachId: string
  courtId: string
  dayOffset: number
  start: string
  durationMin: number
  price: number
  seatsTotal: number
  seatsTaken: number
}

export type FreeSlot = {
  id: string
  courtId: string
  dayOffset: number
  start: string
  durationMin: number
  price: number
}

export type ProductCategory = 'Ракетки' | 'Мячи' | 'Одежда' | 'Аксессуары' | 'Услуги'

export type Product = {
  id: string
  title: string
  subtitle: string
  category: ProductCategory
  price: number
  oldPrice?: number
  image?: string
  badge?: string
  colors: string[]
}

export type Booking = {
  id: string
  sourceId: string
  kind: 'training' | 'free'
  title: string
  subtitle: string
  dayOffset: number
  start: string
  durationMin: number
  price: number
  createdAt: number
}

export type Order = {
  id: string
  productId: string
  title: string
  price: number
  createdAt: number
}
