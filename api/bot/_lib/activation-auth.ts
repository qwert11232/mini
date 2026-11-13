import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'

// Активацию может вызвать только собственный workflow после деплоя main.
// OIDC-токен короткоживущий и выпускается GitHub; секреты Vercel в Actions не передаются.
export const BOT_ACTIVATION_AUDIENCE = 'https://mini-seven-xi.vercel.app/api/bot/activate'
const ISSUER = 'https://token.actions.githubusercontent.com'
const WORKFLOW = 'qwert11232/mini/.github/workflows/activate-bot.yml@refs/heads/main'
// Для этого репозитория GitHub включает immutable subject: в нём есть оба ID.
const SUBJECT = 'repo:qwert11232@157507542/mini@1441805809:ref:refs/heads/main'
const keys = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`))

export async function verifyActivationToken(
  token: string,
  deployedSha: string,
  keyResolver: JWTVerifyGetKey = keys,
): Promise<void> {
  if (!token || token.length > 16_384 || !/^[0-9a-f]{40}$/i.test(deployedSha)) {
    throw new Error('Недействительная авторизация')
  }
  const { payload } = await jwtVerify(token, keyResolver, {
    issuer: ISSUER,
    audience: BOT_ACTIVATION_AUDIENCE,
    algorithms: ['RS256'],
    requiredClaims: ['sub', 'exp', 'iat', 'nbf', 'repository_id', 'repository', 'ref', 'workflow_ref', 'event_name', 'sha'],
    maxTokenAge: '10m',
    clockTolerance: 30,
  })
  if (payload.sub !== SUBJECT || payload.repository_id !== '1441805809' ||
      payload.repository !== 'qwert11232/mini' || payload.ref !== 'refs/heads/main' ||
      payload.workflow_ref !== WORKFLOW || (payload.event_name !== 'push' && payload.event_name !== 'workflow_dispatch') ||
      payload.sha !== deployedSha) {
    throw new Error('Недействительная авторизация')
  }
}
