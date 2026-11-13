import { json } from '../_lib/db.js'
import { verifyActivationToken } from './_lib/activation-auth.js'
import { appUrl } from './_lib/app-url.js'
import { adminIds } from './_lib/db.js'
import { configureBotMenu } from './_lib/menu.js'
import { applyBotStateSchema } from './_lib/state-schema.js'
import { getWebhookInfo, webhookSecret } from './_lib/telegram.js'

/**
 * Активация только после production-деплоя, без секретов в GitHub Actions.
 * Подписанный GitHub OIDC-токен привязан к репозиторию, workflow, main и SHA
 * задеплоенного коммита. Никаких произвольных команд или SQL маршрут не принимает.
 */
async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ ok: false }, 405)
  if (process.env.VERCEL_ENV !== 'production') return json({ ok: false }, 404)

  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return json({ ok: false }, 401)
  try {
    await verifyActivationToken(authorization.slice(7), process.env.VERCEL_GIT_COMMIT_SHA ?? '')
  } catch {
    // Не логируем токен и детали его проверки.
    return json({ ok: false }, 401)
  }

  try {
    const app = appUrl()
    if (!webhookSecret() || adminIds().length === 0) {
      return json({ ok: false, error: 'Проверьте секрет webhook и ID администратора' }, 503)
    }
    const info = await getWebhookInfo()
    if (!info || typeof info !== 'object' || !('url' in info) || info.url !== `${app}/api/bot/webhook`) {
      return json({ ok: false, error: 'Действующий webhook не совпадает с адресом приложения' }, 409)
    }

    await applyBotStateSchema()
    const steps = await configureBotMenu(app)
    const ok = steps.every((step) => step.ok)
    console.info('[bot/activate]', { ok, table: 'bot_dialog_state', menuSteps: steps.length })
    return json({
      ok,
      stateTable: 'bot_dialog_state',
      webhookUnchanged: true,
      steps: steps.map(({ step, ok: stepOk }) => ({ step, ok: stepOk })),
    }, ok ? 200 : 502)
  } catch (error) {
    console.error('[bot/activate]', error instanceof Error ? error.message : 'Ошибка активации')
    return json({ ok: false, error: 'Не удалось подготовить бота' }, 500)
  }
}

export default { fetch: handler }
