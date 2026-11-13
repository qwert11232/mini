-- Только таблица черновиков Telegram-бота. Перед применением в рабочей базе
-- создайте резервную копию и убедитесь, что выбрана нужная база Neon.
-- Этот файл не запускает SEED и не меняет занятия, окна, брони или заказы.
create table if not exists public.bot_dialog_state (
  chat_id bigint primary key,
  pending jsonb,
  product_draft jsonb,
  session_draft jsonb,
  slot_draft jsonb,
  updated_at timestamptz not null default now()
);
