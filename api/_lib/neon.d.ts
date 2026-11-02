/**
 * Мини-декларация Neon для транспиляции функций.
 *
 * Настоящие типы лежат в пакете, но сборщик функций Vercel не должен зависеть
 * от node_modules: если пакет не подхватится, tsc выдаёт ошибку и функция уезжает
 * сломанной. Здесь описано только то, что использует проект.
 */
declare module '@neondatabase/serverless' {
  export type NeonQuery = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<Record<string, unknown>[]>

  export type NeonClient = NeonQuery & {
    query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>
  }

  export function neon(connectionString: string): NeonClient
}
