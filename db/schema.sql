-- =============================================================================
-- ДТ · схема Neon (PostgreSQL)
-- Идемпотентно: можно применять повторно, в том числе на чистой базе.
-- Источник правды для приложения — api/_lib/schema.ts; этот файл держим синхронным
-- для тех, кто накатывает схему через psql / GitHub Actions.
-- =============================================================================

create extension if not exists "pgcrypto";

-- ─── users ───────────────────────────────────────────────────────
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint unique not null,
  first_name text not null,
  last_name text,
  username text,
  role text not null default 'player' check (role in ('player','coach','admin')),
  admin_note text,
  phone text,
  client_no integer,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- ─── courts ──────────────────────────────────────────────────────
create table if not exists courts (
  id text primary key,
  name text not null,
  surface text not null,
  sort_order int not null default 0,
  is_active boolean not null default true
);

-- ─── coaches ─────────────────────────────────────────────────────
create table if not exists coaches (
  id text primary key,
  name text not null,
  role text not null,
  initials text not null,
  rating numeric(2,1) not null default 5.0,
  sort_order int not null default 0,
  is_active boolean not null default true
);

-- ─── training_sessions ───────────────────────────────────────────
create table if not exists training_sessions (
  id text primary key,
  title text not null,
  group_kind text not null,
  level text not null,
  coach_id text not null,
  court_id text not null,
  day_offset int not null,
  start_time text not null,
  duration_min int not null,
  price int not null,
  seats_total int not null,
  seats_taken int not null default 0,
  is_active boolean not null default true,
  starts_at timestamptz
);

-- ─── free_slots ──────────────────────────────────────────────────
create table if not exists free_slots (
  id text primary key,
  court_id text not null,
  day_offset int not null,
  start_time text not null,
  duration_min int not null default 60,
  price int not null,
  is_active boolean not null default true,
  starts_at timestamptz
);

-- ─── bookings ────────────────────────────────────────────────────
create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users (id) on delete cascade,
  kind text not null check (kind in ('training','free')),
  source_id text not null,
  title text not null,
  subtitle text not null default '',
  day_offset int not null,
  start_time text not null,
  duration_min int not null,
  price int not null,
  status text not null default 'active' check (status in ('active','cancelled','visited')),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  starts_at timestamptz
);

create unique index if not exists bookings_active_unique
  on bookings (user_id, kind, source_id) where status = 'active';

-- ─── products ────────────────────────────────────────────────────
create table if not exists products (
  id text primary key,
  title text not null,
  subtitle text not null default '',
  category text not null,
  price int not null,
  old_price int,
  image text,
  badge text,
  colors text[] not null default '{}',
  sort_order int not null default 0,
  is_active boolean not null default true
);

-- ─── orders ──────────────────────────────────────────────────────
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  product_id text not null references products (id),
  quantity int not null default 1,
  price int not null,
  status text not null default 'reserved' check (status in ('reserved','paid','issued','cancelled')),
  contact_name text,
  contact_phone text,
  created_at timestamptz not null default now()
);

alter table bookings alter column user_id drop not null;

alter table users add column if not exists admin_note text;

-- Контакты и постоянный номер клиента (те же миграции применяет api/_lib/customers.ts).
alter table users add column if not exists phone text;
alter table users add column if not exists client_no integer;
create sequence if not exists users_client_no_seq;
update users set client_no = nextval('users_client_no_seq') where client_no is null;
alter table orders add column if not exists contact_name text;
alter table orders add column if not exists contact_phone text;

create index if not exists users_seen_idx on users (last_seen_at desc);

-- ─── admin_audit ─────────────────────────────────────────────────
create table if not exists admin_audit (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  action text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ─── bot_dialog_state ────────────────────────────────────────────
-- Черновики админ-бота: не связаны с бронями и заказами.
create table if not exists bot_dialog_state (
  chat_id bigint primary key,
  pending jsonb,
  product_draft jsonb,
  session_draft jsonb,
  slot_draft jsonb,
  updated_at timestamptz not null default now()
);

