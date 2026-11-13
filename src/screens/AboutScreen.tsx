import { useState } from 'react'
import { CLUB } from '../data/club'
import type { ClientProfile, Coach } from '../lib/types'
import { ScreenHeader } from '../components/Chrome'
import { BookingRow } from '../components/BookingRow'
import {
  BallSeams,
  CourtMark,
  IconArrowUpRight,
  IconChevronDown,
  IconCloud,
  IconPhone,
  IconPin,
  IconStar,
  IconTelegram,
  IconTrophy,
  IconUsers,
} from '../components/Icons'
import type { Booking } from '../lib/types'
import { ADMIN_BOT_URL, openTelegramLink } from '../lib/telegram'

const FAQ = [
  {
    q: 'Как отменить запись?',
    a: 'Откройте «О нас → Мои записи» и нажмите крестик рядом с записью. По вопросам отмены свяжитесь с клубом.',
  },
  {
    q: 'Нужна ли своя ракетка?',
    a: 'Нет. На ресепшене выдают ракетки и мячи, для детей — ракетки нужного размера. Первое занятие с инвентарём бесплатно.',
  },
  {
    q: 'Как попасть в группу своего уровня?',
    a: 'Уровень определяется на первом занятии: новичок, любитель, средний, продвинутый. Перейти в другую группу можно в любой момент.',
  },
  {
    q: 'Можно прийти без партнёра?',
    a: 'Да. Свободная игра — это аренда корта, партнёра можно найти через клубный чат или бота.',
  },
]

const STATS = [
  { value: '4', label: 'корта', Icon: CourtMark },
  { value: '2014', label: 'год основания', Icon: IconTrophy },
  { value: '420+', label: 'игроков клуба', Icon: IconUsers },
  { value: '4.8', label: 'рейтинг', Icon: IconStar },
]

type Props = {
  bookings: Booking[]
  coaches: Coach[]
  client: ClientProfile | null
  mode: 'api' | 'demo'
  loading: boolean
  onRetry: () => void
  onCancelBooking: (id: string) => void
}

export function AboutScreen({ bookings, coaches: COACHES, client, mode, loading, onRetry, onCancelBooking }: Props) {
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  return (
    <div className="screen">
      <ScreenHeader eyebrow="Клуб" title="О нас" subtitle="ДТ — теннисный клуб в Вологде с 2014 года" />

      <div className="pad stack gap-5">
        <figure className="about-photo card">
          <img src="/img/court-about.jpg" alt="Лаундж клуба ДТ" loading="lazy" />
          <figcaption>
            <span className="badge badge-lime">Корт-лаундж</span>
            <p className="t-footnote" style={{ color: 'rgba(241,250,245,0.8)', marginTop: 8 }}>
              Кофе, перетяжка ракеток и разбор игры — до и после корта
            </p>
          </figcaption>
        </figure>

        <div className="stats-grid">
          {STATS.map(({ value, label, Icon }) => (
            <div key={label} className="stat card">
              <Icon className="stat-mark" />
              <span className="stat-value t-num">{value}</span>
              <span className="t-footnote">{label}</span>
            </div>
          ))}
        </div>

        <section className="stack gap-3">
          <h2 className="t-title3">Как всё устроено</h2>
          <div className="group">
            {[
              { title: 'Один корт — одна игра', note: 'Аренда последовательных свободных окон без подселения' },
              { title: 'Тренер под уровень', note: 'Подбираем группу после первого занятия' },
              { title: 'Дети с 5 лет', note: 'Отдельные группы, мягкие мячи, мини-корт' },
              { title: 'Зимой — крытые корты', note: 'Круглый год, +18° и свет 1000 лк' },
            ].map((item) => (
              <div key={item.title} className="group-row">
                <span className="about-bullet" aria-hidden />
                <span className="grow stack">
                  <span className="t-subhead" style={{ fontWeight: 550 }}>{item.title}</span>
                  <span className="t-footnote">{item.note}</span>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="stack gap-3">
          <div className="row-between">
            <h2 className="t-title3">Команда</h2>
            <span className="t-footnote">{COACHES.length} тренера</span>
          </div>
          <div className="group">
            {COACHES.map((coach) => (
              <div key={coach.id} className="group-row">
                <span className="coach-face coach-face-sm" aria-hidden>{coach.initials}</span>
                <span className="grow stack">
                  <span className="t-subhead" style={{ fontWeight: 550 }}>{coach.name}</span>
                  <span className="t-footnote">{coach.role}</span>
                </span>
                <span className="coach-rating t-footnote">
                  <IconStar size={11} /> {coach.rating.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="stack gap-3">
          <div className="row-between">
            <h2 className="t-title3">Мои записи</h2>
            <span className="t-footnote t-num">{bookings.length}</span>
          </div>
          {bookings.length === 0 ? (
            <div className="card card-pad empty empty-row">
              <BallSeams className="empty-ball" />
              <div className="stack gap-1">
                <p className="t-subhead" style={{ fontWeight: 600 }}>Пока пусто</p>
                <p className="t-footnote">Запишитесь на занятие или возьмите корт на час — всё появится здесь.</p>
              </div>
            </div>
          ) : (
            <div className="group">
              {bookings.map((booking) => (
                <BookingRow key={booking.id} booking={booking} onCancel={() => onCancelBooking(booking.id)} />
              ))}
            </div>
          )}
        </section>

        <section className="stack gap-3">
          <h2 className="t-title3">Вопросы</h2>
          <div className="group">
            {FAQ.map((item, index) => {
              const open = openFaq === index
              return (
                <div key={item.q} className="faq">
                  <button
                    type="button"
                    className="faq-q"
                    aria-expanded={open}
                    onClick={() => setOpenFaq(open ? null : index)}
                  >
                    <span className="t-subhead" style={{ fontWeight: 550 }}>{item.q}</span>
                    <IconChevronDown size={17} className={`faq-chevron${open ? ' is-open' : ''}`} />
                  </button>
                  {open ? <p className="faq-a t-footnote">{item.a}</p> : null}
                </div>
              )
            })}
          </div>
        </section>

        <section className="contacts card card-pad stack gap-3">
          <p className="t-caption">Контакты</p>
          <div className="row gap-3">
            <span className="group-icon"><IconPin size={17} /></span>
            <span className="stack grow">
              <span className="t-subhead" style={{ fontWeight: 550 }}>{CLUB.address}</span>
              <span className="t-footnote">{CLUB.hours}</span>
            </span>
          </div>
          <div className="row gap-3">
            <span className="group-icon"><IconPhone size={17} /></span>
            <span className="t-subhead grow" style={{ fontWeight: 550 }}>{CLUB.phone}</span>
          </div>
          <div className="contacts-actions">
            <a
              className="btn btn-primary btn-sm"
              href={ADMIN_BOT_URL}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => { if (openTelegramLink(ADMIN_BOT_URL)) event.preventDefault() }}
            >
              <IconTelegram size={16} /> Написать в клуб
            </a>
            <span className="badge badge-green">Ответ до 15 минут</span>
          </div>
        </section>

        {client ? (
          <section className="stack gap-3">
            <h2 className="t-title3">Ваш профиль</h2>
            <div className="group">
              <div className="group-row">
                <span className="group-icon"><IconUsers size={17} /></span>
                <span className="grow stack">
                  <span className="t-subhead" style={{ fontWeight: 550 }}>Номер клиента: {client.clientLabel}</span>
                  <span className="t-footnote">Назовите его на ресепшене — так мы быстро найдём ваши записи и заказы.</span>
                </span>
                <span className="badge badge-green">В базе</span>
              </div>
              <div className="group-row">
                <span className="group-icon"><IconPhone size={17} /></span>
                <span className="grow stack">
                  <span className="t-subhead" style={{ fontWeight: 550 }}>{client.phone ?? 'Телефон пока не указан'}</span>
                  <span className="t-footnote">
                    {client.phone ? 'По нему администратор свяжется по вашему заказу.' : 'Имя и телефон можно оставить при оформлении заказа.'}
                  </span>
                </span>
              </div>
            </div>
          </section>
        ) : null}

        <section className="stack gap-3">
          <h2 className="t-title3">Синхронизация</h2>
          <div className="group">
            <div className="group-row">
              <span className="group-icon"><IconCloud size={17} /></span>
              <span className="grow stack">
                <span className="t-subhead" style={{ fontWeight: 550 }}>
                  {import.meta.env.DEV ? 'Локальный предпросмотр' : mode === 'api' ? 'База клуба' : 'Записи недоступны'}
                </span>
                <span className="t-footnote">
                  {loading
                    ? 'Проверяем соединение…'
                    : import.meta.env.DEV
                      ? 'Демо-данные локального предпросмотра'
                      : mode === 'api'
                        ? 'Записи сохраняются в базе клуба и видны администратору в боте'
                        : 'Проверьте соединение и повторите попытку'}
                </span>
              </span>
              {mode === 'demo' ? (
                <button type="button" className="btn-ghost t-subhead" onClick={onRetry}>
                  Проверить
                </button>
              ) : (
                <span className="badge badge-green">Онлайн</span>
              )}
            </div>
          </div>
        </section>

        <section className="about-note">
          <IconArrowUpRight size={16} />
          <p className="t-footnote">
            Управление клубом и брони — через Telegram-бота.
          </p>
        </section>

        <p className="home-footnote">ДТ · Теннисный клуб · {CLUB.hours}</p>
      </div>
    </div>
  )
}
