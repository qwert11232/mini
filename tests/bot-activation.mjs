import { registerHooks } from 'node:module'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'

// Изолированная БД и поддельный Telegram API: внешние сервисы не вызываются.
const db = await PGlite.create()
await db.exec(`
  create table existing_data (id int primary key, value text not null);
  insert into existing_data values (1, 'не изменять');
`)
const sql = async (strings, ...values) => {
  const text = strings.reduce((result, part, i) => result + part + (i < values.length ? `$${i + 1}` : ''), '')
  return (await db.query(text, values)).rows
}
sql.query = async (text, values) => (await db.query(text, values)).rows
globalThis.__activationDb = sql

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@neondatabase/serverless') return { url: 'test:activation-neon', shortCircuit: true }
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.includes('/api/')) {
      return nextResolve(specifier.slice(0, -3) + '.ts', context)
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url === 'test:activation-neon') {
      return { format: 'module', shortCircuit: true, source: 'export function neon() { return globalThis.__activationDb }' }
    }
    return nextLoad(url, context)
  },
})

const { privateKey, publicKey } = await generateKeyPair('RS256')
const publicJwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' }
const issuer = 'https://token.actions.githubusercontent.com'
const audience = 'https://mini-seven-xi.vercel.app/api/bot/activate'
const sha = 'a'.repeat(40)
const telegramCalls = []
const originalFetch = globalThis.fetch
let webhookUrl = 'https://unexpected.example/api/bot/webhook'
let failMethod = null

globalThis.fetch = async (url, init) => {
  const address = String(url)
  if (address === `${issuer}/.well-known/jwks`) return Response.json({ keys: [publicJwk] })
  if (address.startsWith('https://api.telegram.org/')) {
    const method = address.split('/').at(-1)
    telegramCalls.push({ method, payload: JSON.parse(init.body) })
    if (method === failMethod) return Response.json({ ok: false, description: 'test failure', error_code: 400 }, { status: 400 })
    if (method === 'getWebhookInfo') return Response.json({ ok: true, result: { url: webhookUrl, pending_update_count: 0 } })
    return Response.json({ ok: true, result: true })
  }
  throw new Error(`unexpected test request: ${address}`)
}

process.env.DATABASE_URL = 'postgres://user:pass@localhost/test'
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token'
process.env.TELEGRAM_WEBHOOK_SECRET = 'test_webhook_secret'
process.env.ADMIN_TELEGRAM_IDS = '793536041'
process.env.VITE_APP_URL = 'https://mini-seven-xi.vercel.app'
process.env.VERCEL_GIT_COMMIT_SHA = sha
process.env.VERCEL_ENV = 'production'

const { default: activation } = await import('../api/bot/setup.ts')
const activationUrl = 'https://mini-seven-xi.vercel.app/api/bot/setup?mode=activate'
const now = Math.floor(Date.now() / 1000)
async function sign(overrides = {}) {
  return new SignJWT({
    iss: issuer,
    aud: audience,
    sub: 'repo:qwert11232@157507542/mini@1441805809:ref:refs/heads/main',
    exp: now + 300,
    iat: now,
    nbf: now - 1,
    repository_id: '1441805809',
    repository: 'qwert11232/mini',
    ref: 'refs/heads/main',
    workflow_ref: 'qwert11232/mini/.github/workflows/activate-bot.yml@refs/heads/main',
    event_name: 'push',
    sha,
    ...overrides,
  }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(privateKey)
}
function request(token, method = 'POST') {
  return new Request(activationUrl, { method, headers: token ? { authorization: `Bearer ${token}` } : {} })
}
async function table() {
  return (await db.query("select to_regclass('public.bot_dialog_state') as name")).rows[0].name
}

try {
  const valid = await sign()
  assert.equal((await activation.fetch(request(valid, 'GET'))).status, 405)
  process.env.VERCEL_ENV = 'preview'
  assert.equal((await activation.fetch(request(valid))).status, 404)
  process.env.VERCEL_ENV = 'production'
  assert.equal((await activation.fetch(request(null))).status, 401)
  assert.equal((await activation.fetch(request('not-a-jwt'))).status, 401)
  process.env.SETUP_TOKEN = 'test-setup-secret'
  assert.equal((await activation.fetch(new Request(`${activationUrl}&token=test-setup-secret`, { method: 'POST' }))).status, 401)
  assert.equal((await activation.fetch(new Request(`${activationUrl}&token=test-setup-secret`, { method: 'GET' }))).status, 405)

  for (const [field, value] of [
    ['iss', 'https://example.test'],
    ['aud', 'https://example.test'],
    ['sub', 'repo:attacker/fork:ref:refs/heads/main'],
    ['repository_id', '9999999'],
    ['repository', 'attacker/fork'],
    ['ref', 'refs/heads/other'],
    ['workflow_ref', 'qwert11232/mini/.github/workflows/other.yml@refs/heads/main'],
    ['event_name', 'pull_request'],
    ['sha', 'b'.repeat(40)],
    ['exp', now - 60],
    ['nbf', now + 120],
  ]) {
    assert.equal((await activation.fetch(request(await sign({ [field]: value })))).status, 401, field)
  }
  const tokenParts = valid.split('.')
  const badSignature = `${tokenParts[0]}.${tokenParts[1]}.${tokenParts[2][0] === 'A' ? 'B' : 'A'}${tokenParts[2].slice(1)}`
  assert.equal((await activation.fetch(request(badSignature))).status, 401)
  assert.equal(await table(), null, 'недоверенный запрос не меняет базу')
  assert.equal(telegramCalls.length, 0, 'недоверенный запрос не обращается к Telegram')

  delete process.env.TELEGRAM_WEBHOOK_SECRET
  assert.equal((await activation.fetch(request(valid))).status, 503)
  process.env.TELEGRAM_WEBHOOK_SECRET = 'test_webhook_secret'
  assert.equal((await activation.fetch(request(valid))).status, 409, 'чужой webhook нельзя перенастраивать')
  assert.equal(await table(), null)
  assert.deepEqual(telegramCalls.map((call) => call.method), ['getWebhookInfo'])

  webhookUrl = 'https://mini-seven-xi.vercel.app/api/bot/webhook'
  telegramCalls.length = 0
  const response = await activation.fetch(request(valid))
  assert.equal(response.status, 200, await response.clone().text())
  const result = await response.json()
  assert.equal(result.ok, true)
  assert.equal(result.stateTable, 'bot_dialog_state')
  assert.equal(result.webhookUnchanged, true)
  assert.ok(result.steps.every((step) => step.ok))
  assert.ok(await table())
  assert.deepEqual((await db.query('select * from existing_data')).rows, [{ id: 1, value: 'не изменять' }])
  assert.ok(telegramCalls.some((call) => call.method === 'setChatMenuButton' && call.payload.menu_button.type === 'web_app'))
  assert.ok(telegramCalls.some((call) => call.method === 'setMyCommands' && call.payload.scope.type === 'all_private_chats'))
  assert.ok(telegramCalls.some((call) => call.method === 'setMyCommands' && call.payload.scope.type === 'chat' && call.payload.scope.chat_id === 793536041))
  assert.ok(!telegramCalls.some((call) => call.method === 'setWebhook'), 'очередь webhook не сбрасывается')

  await db.exec(`insert into bot_dialog_state (chat_id, product_draft) values (793536041, '{"title":"сохранить"}')`)
  assert.equal((await activation.fetch(request(valid))).status, 200)
  assert.equal((await db.query('select product_draft from bot_dialog_state')).rows[0].product_draft.title, 'сохранить')
  failMethod = 'setChatMenuButton'
  const partial = await activation.fetch(request(valid))
  assert.equal(partial.status, 502)
  assert.equal((await partial.json()).ok, false)
  assert.deepEqual((await db.query('select * from existing_data')).rows, [{ id: 1, value: 'не изменять' }])
  console.log('✓ Активация бота: проверка GitHub OIDC, безопасная миграция, меню без сброса webhook')
} finally {
  globalThis.fetch = originalFetch
  await db.close()
}
