import { IconBall, IconTelegram } from './Icons'
import { CLUB_BOT_NAME, getTelegram } from '../lib/telegram'

type Kind = 'checking' | 'loading' | 'missing' | 'invalid' | 'expired' | 'connection'

type Props = { kind: Kind; onRetry?: () => void }

/** Экран входа и ошибок не содержит ссылки на обычный сайт приложения. */
export function EntryScreen({ kind, onRetry }: Props) {
  const busy = kind === 'checking' || kind === 'loading'
  const instructions = kind === 'missing' || kind === 'invalid' || kind === 'expired'
  const canClose = kind !== 'missing' && instructions && Boolean(getTelegram()?.close)
  const title = kind === 'checking'
    ? 'Подключаем Telegram'
    : kind === 'loading'
      ? 'Загружаем клуб'
      : kind === 'missing'
        ? 'Откройте в Telegram'
        : kind === 'expired'
          ? 'Сессия завершилась'
          : kind === 'invalid'
            ? 'Не удалось подтвердить вход'
            : 'Нет соединения с клубом'

  return (
    <div className="entry-shell">
      <main className="entry-content" aria-live="polite" aria-busy={busy}>
        <div className="entry-brand">
          <span className="brand-mark">ДТ</span>
          <span><strong>ДТ</strong><br />Теннисный клуб</span>
        </div>
        <div className="entry-card">
          <span className="entry-icon" aria-hidden="true">
            {instructions ? <IconTelegram size={28} /> : <IconBall size={28} />}
          </span>
          <p className="entry-eyebrow">МИНИ-ПРИЛОЖЕНИЕ КЛУБА</p>
          <h1>{title}</h1>
          {kind === 'checking' ? <p>Проверяем данные вашего аккаунта…</p> : null}
          {kind === 'loading' ? <p>Получаем расписание, записи и заказы…</p> : null}
          {kind === 'missing' ? (
            <p>В обычном браузере данные Telegram недоступны. Войдите через бота клуба:</p>
          ) : null}
          {kind === 'invalid' ? (
            <p>Данные Telegram не удалось проверить. Закройте приложение и откройте его заново из бота.</p>
          ) : null}
          {kind === 'expired' ? (
            <p>Для безопасности нужно снова подтвердить аккаунт. Закройте приложение и откройте его заново из бота.</p>
          ) : null}
          {kind === 'connection' ? (
            <p>Не удалось загрузить данные. Проверьте интернет и повторите попытку. Если вы уже отправляли заявку, после подключения проверьте её в списке.</p>
          ) : null}
          {instructions ? (
            <ol className="entry-steps">
              <li><span>1</span><div>Найдите в Telegram бота <strong>@{CLUB_BOT_NAME}</strong> и отправьте <strong>/start</strong>.</div></li>
              <li><span>2</span><div>Нажмите <strong>«Открыть приложение»</strong> в сообщении или кнопку меню бота.</div></li>
            </ol>
          ) : null}
          {kind === 'connection' && onRetry ? (
            <button type="button" className="btn btn-primary btn-block entry-action" onClick={onRetry}>Повторить</button>
          ) : null}
          {canClose ? (
            <button type="button" className="btn btn-tonal btn-block entry-action" onClick={() => getTelegram()?.close?.()}>Закрыть приложение</button>
          ) : null}
        </div>
        <p className="entry-note">Ваши записи и заказы привязаны к аккаунту Telegram.</p>
      </main>
    </div>
  )
}
