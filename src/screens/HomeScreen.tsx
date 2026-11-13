import { useMemo } from 'react'
import { CLUB } from '../data/club'
import type { Catalog, VerifiedUser } from '../lib/api'
import type { Booking, SectionId } from '../lib/types'
import { dayName, endTime, formatDuration, minutesUntil } from '../lib/date'
import { formatPrice, seatsLabel } from '../lib/format'
import { BallSeams, CourtMark, IconArrowUpRight, IconBall, IconCalendar, IconChevron, IconClock, IconPin, IconSparkle, IconStar, IconTrophy, IconUsers } from '../components/Icons'

type Props = {
  bookings: Booking[]
  catalog: Catalog
  user: VerifiedUser | null
  onNavigate: (id: SectionId) => void
  onOpenSession: (id: string) => void
}

export function HomeScreen({ bookings, catalog, user, onNavigate, onOpenSession }: Props) {
  const { coaches: COACHES, courts: COURTS, sessions: SESSIONS, slots: FREE_SLOTS } = catalog
  const upcoming = useMemo(
    () =>
      [...bookings]
        .filter((item) => minutesUntil(item.dayOffset, item.start) > -item.durationMin)
        .sort((a, b) => a.dayOffset * 1440 + toMinutes(a.start) - (b.dayOffset * 1440 + toMinutes(b.start)))[0],
    [bookings],
  )

  const nextSession = useMemo(() => {
    const candidates = SESSIONS.filter((session) => minutesUntil(session.dayOffset, session.start) > 0)
    return candidates.sort(
      (a, b) => a.dayOffset * 1440 + toMinutes(a.start) - (b.dayOffset * 1440 + toMinutes(b.start)),
    )[0]
  }, [SESSIONS])

  const freeCourts = useMemo(() => {
    const soon = FREE_SLOTS.filter((slot) => {
      const diff = minutesUntil(slot.dayOffset, slot.start)
      return diff > 0 && diff < 240
    })
    return COURTS.filter((court) => soon.some((slot) => slot.courtId === court.id)).length
  }, [COURTS, FREE_SLOTS])

  const greeting = user?.firstName
  const initials = [user?.firstName.trim()[0], user?.lastName?.trim()[0]].filter(Boolean).join('').toUpperCase() || 'ДТ'

  return (
    <div className="screen home">
      <section className="hero">
        <img className="hero-photo" src="/img/court-hero.jpg" alt="Корт клуба ДТ" />
        <div className="hero-scrim" />
        <div className="hero-lines" aria-hidden />

        <div className="hero-top pad">
          <div className="brand">
            <span className="brand-mark">ДТ</span>
            <span className="brand-divider" aria-hidden />
            <span className="brand-text">
              <strong>{CLUB.tagline}</strong>
              <span>{CLUB.city} · {CLUB.hours.replace('Ежедневно · ', '')}</span>
            </span>
          </div>
          <button type="button" className="avatar" onClick={() => onNavigate('about')} aria-label="Профиль клуба">
            {initials}
          </button>
        </div>

        <div className="hero-bottom pad">
          <p className="hero-hello">
            {greeting ? `Привет, ${greeting}` : 'Добро пожаловать'}
          </p>
          <h1 className="hero-title">
            Ваш корт
            <br />
            уже готов
          </h1>
          <div className="hero-meta">
            <span className="badge badge-lime">
              <span className="dot" />
              {freeCourts > 0 ? `${freeCourts} корта свободно ближайшие 4 часа` : 'Ближайшая аренда — завтра'}
            </span>
            <span className="hero-surface">
              <CourtMark className="hero-court-mark" />
              Хард · грунт · крытые корты
            </span>
          </div>
        </div>
      </section>

      <div className="home-body pad stack gap-5">
        {upcoming ? (
          <button type="button" className="card card-press next-booking" onClick={() => onNavigate(upcoming.kind === 'training' ? 'schedule' : 'play')}>
            <div className="next-booking-glow" aria-hidden />
            <div className="row-between">
              <span className="t-caption" style={{ color: 'var(--green-200)' }}>Ближайшая запись</span>
              <span className="badge badge-dark">{upcoming.kind === 'training' ? 'Занятие' : 'Аренда'}</span>
            </div>
            <p className="t-title3" style={{ marginTop: 10, color: '#fff' }}>{upcoming.title}</p>
            <p className="t-footnote" style={{ color: 'rgba(241,250,245,0.72)' }}>{upcoming.subtitle}</p>
            <div className="next-booking-times">
              <span className="row gap-2">
                <IconClock size={15} />
                {dayName(upcoming.dayOffset)}, {upcoming.start}–{endTime(upcoming.start, upcoming.durationMin)}
              </span>
              <span className="next-booking-price t-num">{formatPrice(upcoming.price)}</span>
            </div>
          </button>
        ) : null}

        <div className="quick-grid">
          <button type="button" className="quick card card-press" onClick={() => onNavigate('schedule')}>
            <span className="quick-icon quick-icon-schedule">
              <IconCalendar size={20} />
            </span>
            <span className="quick-title">Записаться на занятие</span>
            <span className="quick-note">Группы, сплиты, дети</span>
            <IconArrowUpRight className="quick-arrow" size={17} />
          </button>
          <button type="button" className="quick card card-press" onClick={() => onNavigate('play')}>
            <span className="quick-icon quick-icon-play">
              <IconBall size={20} />
            </span>
            <span className="quick-title">Свободная игра</span>
            <span className="quick-note">Аренда корта на час</span>
            <IconArrowUpRight className="quick-arrow" size={17} />
          </button>
        </div>

        {nextSession ? (
          <section className="stack gap-3">
            <div className="row-between">
              <h2 className="t-title3">Скоро в клубе</h2>
              <button type="button" className="btn-ghost t-subhead" onClick={() => onNavigate('schedule')}>
                Вся сетка
              </button>
            </div>
            <button type="button" className="card card-press next-session" onClick={() => onOpenSession(nextSession.id)}>
              <div className="next-session-time">
                <span className="t-title3 t-num">{nextSession.start}</span>
                <span className="t-caption" style={{ letterSpacing: '0.02em' }}>{dayName(nextSession.dayOffset)}</span>
              </div>
              <div className="next-session-body grow">
                <p className="t-headline">{nextSession.title}</p>
                <p className="t-footnote" style={{ marginTop: 3 }}>
                  {COURTS.find((court) => court.id === nextSession.courtId)?.name} ·{' '}
                  {COACHES.find((coach) => coach.id === nextSession.coachId)?.name} ·{' '}
                  {formatDuration(nextSession.durationMin)}
                </p>
                <div className="row gap-2" style={{ marginTop: 8 }}>
                  <span className={nextSession.seatsTotal - nextSession.seatsTaken <= 1 ? 'badge badge-lime' : 'badge badge-green'}>
                    {seatsLabel(nextSession.seatsTotal, nextSession.seatsTaken)}
                  </span>
                  <span className="t-footnote t-num" style={{ color: 'var(--text)' }}>{formatPrice(nextSession.price)}</span>
                </div>
              </div>
              <IconChevron size={18} className="t-muted" />
            </button>
          </section>
        ) : null}

        <section className="stack gap-3">
          <div className="row-between">
            <h2 className="t-title3">Тренеры</h2>
            <span className="t-footnote">Средний рейтинг {averageRating(COACHES)}</span>
          </div>
          <div className="scroller scroller--bleed coach-strip">
            {COACHES.map((coach) => (
              <article key={coach.id} className="coach-card card">
                <div className="coach-face" aria-hidden>{coach.initials}</div>
                <p className="t-subhead" style={{ fontWeight: 600 }}>{coach.name}</p>
                <p className="t-footnote">{coach.role}</p>
                <span className="coach-rating t-footnote">
                  <IconStar size={11} /> {coach.rating.toFixed(1)}
                </span>
              </article>
            ))}
          </div>
        </section>

        <section className="club-pass">
          <div className="club-pass-texture" aria-hidden />
          <BallSeams className="club-pass-ball" />
          <div className="row-between">
            <span className="t-caption" style={{ color: 'var(--green-200)' }}>Клубная карта</span>
            <span className="badge badge-lime">−15% на всё</span>
          </div>
          <p className="t-title3" style={{ marginTop: 12 }}>Абонемент на 8 занятий</p>
          <p className="t-footnote" style={{ color: 'rgba(241,250,245,0.7)', marginTop: 4 }}>
            Заморозка до 30 дней · перенос в другой город клуба
          </p>
          <div className="club-pass-foot">
            <span className="row gap-2 t-subhead" style={{ fontWeight: 600 }}>
              <IconTrophy size={16} /> {formatPrice(11600)}
            </span>
            <button type="button" className="btn btn-glass btn-sm" onClick={() => onNavigate('about')}>
              Подробнее
            </button>
          </div>
        </section>

        <section className="stack gap-3">
          <h2 className="t-title3">Инфраструктура</h2>
          <div className="group">
            {[
              { Icon: IconSparkle, title: '4 корта', note: '2 крытых, грунт и хард', meta: '07:00–23:00' },
              { Icon: IconUsers, title: '4 тренера', note: 'Дети и взрослые, любой уровень', meta: 'с 5 лет' },
              { Icon: IconPin, title: CLUB.address, note: 'Парковка и раздевалки', meta: 'Центр' },
            ].map(({ Icon, title, note, meta }) => (
              <div key={title} className="group-row">
                <span className="group-icon"><Icon size={18} /></span>
                <span className="grow stack">
                  <span className="t-subhead" style={{ fontWeight: 550 }}>{title}</span>
                  <span className="t-footnote">{note}</span>
                </span>
                <span className="t-footnote nowrap">{meta}</span>
              </div>
            ))}
          </div>
        </section>

        <p className="home-footnote">
          Бронирование подтверждается в Telegram · напоминание придёт за 2 часа
        </p>
      </div>
    </div>
  )
}

function averageRating(coaches: Catalog['coaches']): string {
  if (coaches.length === 0) return '—'
  const sum = coaches.reduce((acc, coach) => acc + coach.rating, 0)
  return (sum / coaches.length).toFixed(1)
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':')
  return Number(hours ?? 0) * 60 + Number(minutes ?? 0)
}
