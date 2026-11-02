// Мини-описание того, что функции берут из Node: без @types/node,
// чтобы Vercel-транспиляция не зависела от установленных типов.
declare const process: {
  env: Record<string, string | undefined>
  exit: (code?: number) => never
  version: string
}
declare const console: {
  log: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}
