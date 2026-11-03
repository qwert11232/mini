/**
 * Схема и демо-данные Neon. Один источник правды: отсюда их берут и
 * /api/admin/setup (первичная накатка из браузера), и кнопка «Починить схему»
 * в боте — она досоздаёт недостающие таблицы и колонки на существующей базе.
 *
 * Все стейтменты идемпотентны: повторный прогон ничего не ломает.
 */

/**
 * Отдельный набор миграции клиентов: его же лениво применяет /api/client и
 * заказы, поэтому после деплоя не нужен ручной SQL или терминал.
 */
export const CUSTOMER_SCHEMA = [
  `alter table users add column if not exists phone text`,
  `alter table users add column if not exists client_no integer`,
  `create sequence if not exists users_client_no_seq`,
  `update users set client_no = nextval('users_client_no_seq') where client_no is null`,
  `alter table orders add column if not exists contact_name text`,
  `alter table orders add column if not exists contact_phone text`,
]

export const SCHEMA = [
  `create extension if not exists "pgcrypto"`,
  `create table if not exists users (
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
   )`,
  `create table if not exists courts (
     id text primary key,
     name text not null,
     surface text not null,
     sort_order int not null default 0,
     is_active boolean not null default true
   )`,
  `create table if not exists coaches (
     id text primary key,
     name text not null,
     role text not null,
     initials text not null,
     rating numeric(2,1) not null default 5.0,
     sort_order int not null default 0,
     is_active boolean not null default true
   )`,
  `create table if not exists training_sessions (
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
   )`,
  `create table if not exists free_slots (
     id text primary key,
     court_id text not null,
     day_offset int not null,
     start_time text not null,
     duration_min int not null default 60,
     price int not null,
     is_active boolean not null default true,
     starts_at timestamptz
   )`,
  `create table if not exists bookings (
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
   )`,
  `create unique index if not exists bookings_active_unique
     on bookings (user_id, kind, source_id) where status = 'active'`,
  `create table if not exists products (
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
   )`,
  `create table if not exists orders (
     id uuid primary key default gen_random_uuid(),
     user_id uuid not null references users (id) on delete cascade,
     product_id text not null references products (id),
     quantity int not null default 1,
     price int not null,
     status text not null default 'reserved' check (status in ('reserved','paid','issued','cancelled')),
     contact_name text,
     contact_phone text,
     created_at timestamptz not null default now()
   )`,
  // Запись может быть без игрока: админ закрывает корт под телефонную бронь.
  `alter table bookings alter column user_id drop not null`,
  `alter table users add column if not exists admin_note text`,
  ...CUSTOMER_SCHEMA,
  `create index if not exists users_seen_idx on users (last_seen_at desc)`,
  `create table if not exists admin_audit (
     id uuid primary key default gen_random_uuid(),
     telegram_id bigint not null,
     action text not null,
     payload jsonb not null default '{}',
     created_at timestamptz not null default now()
   )`,
]

export const SEED = [
  `insert into courts (id, name, surface, sort_order) values
     ('c1','Корт 1','Крытый хард',1), ('c2','Корт 2','Крытый хард',2),
     ('c3','Корт 3','Грунт',3), ('c4','Корт 4','Хард',4)
   on conflict (id) do update set name = excluded.name, surface = excluded.surface`,
  `insert into coaches (id, name, role, initials, rating, sort_order) values
     ('k1','Артём Соколов','Главный тренер · КМС','АС',4.9,1),
     ('k2','Мария Левина','Взрослые группы','МЛ',4.8,2),
     ('k3','Илья Гордин','Дети 6–14','ИГ',4.9,3),
     ('k4','Дарья Киселёва','Сплиты и корт-фитнес','ДК',4.7,4)
   on conflict (id) do update set name = excluded.name, role = excluded.role`,
  `insert into training_sessions
     (id, title, group_kind, level, coach_id, court_id, day_offset, start_time, duration_min, price, seats_total, seats_taken)
   values
     ('s1','Группа · начальный уровень','Группа','Новичок','k2','c3',0,'09:00',90,1400,6,4),
     ('s2','Утро · техника удара','Сплит','Любитель','k1','c1',0,'11:30',60,2200,2,1),
     ('s3','Дети 8–11 лет','Дети','Новичок','k3','c2',0,'16:00',60,900,8,6),
     ('s4','Вечерняя группа · средний','Группа','Средний','k1','c1',0,'19:00',90,1600,6,5),
     ('s5','Корт-фитнес с ракеткой','Корт-фитнес','Любитель','k4','c4',1,'08:30',60,1200,10,7),
     ('s6','Индивидуальная тренировка','Индивидуально','Продвинутый','k1','c1',1,'10:00',60,3500,1,0),
     ('s7','Группа · продвинутые','Группа','Продвинутый','k1','c2',1,'20:00',90,1800,4,3),
     ('s8','Дети 12–14 лет','Дети','Любитель','k3','c2',2,'15:00',90,1100,8,3),
     ('s9','Сплит · подача и приём','Сплит','Средний','k2','c3',2,'18:30',60,2200,2,0),
     ('s10','Утро · свободная техника','Группа','Любитель','k4','c4',3,'09:30',60,1300,6,2),
     ('s11','Игровая практика · сет','Группа','Средний','k2','c1',3,'19:30',90,1500,6,4),
     ('s12','Субботний интенсив','Группа','Продвинутый','k1','c1',4,'11:00',120,2400,8,5),
     ('s13','Дети · суббота','Дети','Новичок','k3','c2',4,'10:00',60,900,8,8),
     ('s14','Воскресная группа','Группа','Любитель','k2','c3',5,'12:00',90,1400,6,3),
     ('s15','Индивидуальная тренировка','Индивидуально','Средний','k4','c4',6,'17:00',60,3200,1,0)
   on conflict (id) do nothing`,
  `insert into products (id, title, subtitle, category, price, old_price, image, badge, colors, sort_order) values
     ('p1','Ракетка DT Control 300','Баланс для любителя · 300 г','Ракетки',18900,21900,'/img/shop-racket.jpg','−14%',array['#1c6b43','#14211a'],1),
     ('p2','Мячи DT Tour, 3 шт.','Хард и грунт · ITF Approved','Мячи',890,null,'/img/shop-balls.jpg',null,array['#c2f02a'],2),
     ('p3','Худи клуба, forest','Хлопок 340 г · размеры S–XXL','Одежда',6400,null,'/img/shop-hoodie.jpg','Новое',array['#0b3b27','#e1e6df'],3),
     ('p4','Натяжка струн','24 часа · мастер клуба','Услуги',1900,null,null,null,array['#10503a'],4),
     ('p5','Грип DT Overgrip ×3','Влагостойкий, таки-финиш','Аксессуары',690,null,null,null,array['#e1e6df','#a5dc10','#14211a'],5),
     ('p6','Термосумка на 6 ракеток','Два отсека · влагозащита','Аксессуары',5200,null,null,null,array['#0b3b27'],6),
     ('p7','Ракетка DT Junior 26','Дети 9–12 лет · 250 г','Ракетки',11900,null,null,null,array['#34a06a','#14211a'],7),
     ('p8','Индивидуальный урок','60 минут с тренером · сертификат','Услуги',3500,null,null,null,array['#10503a'],8)
   on conflict (id) do nothing`,
  `insert into free_slots (id, court_id, day_offset, start_time, duration_min, price)
   select c.id || '-' || t.start_time, c.id, t.day_offset, t.start_time,
          case when t.idx % 5 = 4 then 90 else 60 end,
          case when c.surface = 'Грунт' then 2400 else 2000 end
   from courts c
   cross join (values
     ('07:00',0,0), ('08:00',1,1), ('10:00',2,2), ('12:00',3,3), ('13:00',4,4),
     ('14:00',5,5), ('17:00',6,6), ('18:00',0,7), ('21:00',1,8), ('22:00',2,9)
   ) as t(start_time, day_offset, idx)
   where t.idx % 5 <> 0
   on conflict (id) do nothing`,
  `update training_sessions
     set starts_at = date_trunc('day', now()) + make_interval(days => day_offset) + (start_time || ':00')::interval
     where starts_at is null or starts_at::date <> (now()::date + day_offset)`,
  `update free_slots
     set starts_at = date_trunc('day', now()) + make_interval(days => day_offset) + (start_time || ':00')::interval
     where starts_at is null or starts_at::date <> (now()::date + day_offset)`,
]


