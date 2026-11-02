-- =============================================================================
-- ДТ · схема Neon (PostgreSQL)
-- Идемпотентно: можно применять повторно, в том числе на чистой базе.
-- =============================================================================

create extension if not exists "pgcrypto";

-- ─── Пользователи Telegram ───────────────────────────────────────────────────
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  telegram_id   bigint unique not null,
  first_name    text not null,
  last_name     text,
  username      text,
  role          text not null default 'player' check (role in ('player', 'coach', 'admin')),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

-- ─── Корты и тренеры ─────────────────────────────────────────────────────────
create table if not exists courts (
  id          text primary key,
  name        text not null,
  surface     text not null check (surface in ('Хард', 'Грунт', 'Крытый хард')),
  sort_order  int not null default 0,
  is_active   boolean not null default true
);

create table if not exists coaches (
  id          text primary key,
  name        text not null,
  role        text not null,
  initials    text not null,
  rating      numeric(2, 1) not null default 5.0,
  sort_order  int not null default 0,
  is_active   boolean not null default true
);

-- ─── Занятия ─────────────────────────────────────────────────────────────────
create table if not exists training_sessions (
  id            text primary key,
  title         text not null,
  group_kind    text not null check (group_kind in ('Группа', 'Сплит', 'Индивидуально', 'Дети', 'Корт-фитнес')),
  level         text not null check (level in ('Новичок', 'Любитель', 'Средний', 'Продвинутый')),
  coach_id      text not null references coaches (id),
  court_id      text not null references courts (id),
  day_offset    int not null check (day_offset between 0 and 30),
  start_time    text not null,
  duration_min  int not null check (duration_min between 15 and 240),
  price         int not null check (price >= 0),
  seats_total   int not null check (seats_total > 0),
  seats_taken   int not null default 0 check (seats_taken >= 0),
  is_active     boolean not null default true
);

create index if not exists training_sessions_day_idx
  on training_sessions (day_offset, start_time) where is_active;

-- ─── Свободные окна аренды ───────────────────────────────────────────────────
create table if not exists free_slots (
  id            text primary key,
  court_id      text not null references courts (id),
  day_offset    int not null check (day_offset between 0 and 30),
  start_time    text not null,
  duration_min  int not null default 60,
  price         int not null check (price >= 0),
  is_active     boolean not null default true
);

create index if not exists free_slots_day_idx on free_slots (day_offset, start_time) where is_active;

-- ─── Брони (занятия и аренда в одной таблице) ─────────────────────────────────
create table if not exists bookings (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users (id) on delete cascade,
  kind          text not null check (kind in ('training', 'free')),
  source_id     text not null,
  title         text not null,
  subtitle      text not null default '',
  day_offset    int not null,
  start_time    text not null,
  duration_min  int not null,
  price         int not null,
  status        text not null default 'active' check (status in ('active', 'cancelled', 'visited')),
  created_at    timestamptz not null default now(),
  cancelled_at  timestamptz
);

create unique index if not exists bookings_active_unique
  on bookings (user_id, kind, source_id) where status = 'active';

create index if not exists bookings_user_idx on bookings (user_id, created_at desc);

-- ─── Магазин ─────────────────────────────────────────────────────────────────
create table if not exists products (
  id          text primary key,
  title       text not null,
  subtitle    text not null default '',
  category    text not null,
  price       int not null check (price >= 0),
  old_price   int,
  image       text,
  badge       text,
  colors      text[] not null default '{}',
  sort_order  int not null default 0,
  is_active   boolean not null default true
);

create table if not exists orders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete cascade,
  product_id  text not null references products (id),
  quantity    int not null default 1 check (quantity between 1 and 9),
  price       int not null,
  status      text not null default 'reserved' check (status in ('reserved', 'paid', 'issued', 'cancelled')),
  created_at  timestamptz not null default now()
);

create index if not exists orders_user_idx on orders (user_id, created_at desc);
