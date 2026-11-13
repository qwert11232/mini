import { getDb } from './db.js'
import { applyBotStateSchema } from './state-schema.js'
import type { ProductDraft, SessionBuildDraft } from './screens.js'

/**
 * Состояние диалога админ-бота: ожидаемый текстовый ответ и черновики
 * конструкторов. Раньше всё жило в Map внутри serverless-инстанса и терялось,
 * когда следующий апдейт попадал на другой инстанс. Теперь состояние лежит
 * в отдельной таблице и загружается/сохраняется на каждый апдейт.
 *
 * Таблица создаётся отдельной миграцией после резервной копии; если она ещё
 * отсутствует, первый подтверждённый запрос администратора создаёт только её.
 * Общая SCHEMA и SEED рабочей базы здесь не запускаются.
 */

export type Pending =
  | { kind: 'price'; sessionId: string }
  | { kind: 'note'; playerId: string }
  | { kind: 'sessionField'; field: 'price' | 'time' | 'seats' | 'duration'; sessionId: string }
  | { kind: 'productField'; field: 'title' | 'subtitle' | 'price'; productId: string }
  | { kind: 'newProductField'; field: 'title' | 'subtitle' | 'price' }
  | { kind: 'newSessionField'; field: 'title' | 'time' | 'price' | 'seats' | 'duration' | 'days' }
  | { kind: 'newSlotField'; field: 'time' | 'price' | 'days' }
  | { kind: 'productPhoto'; productId: string }

export type SlotDraft = { time?: string; price?: number; days?: number; courtId?: string }

export type DialogState = {
  pending: Pending | null
  productDraft: ProductDraft | null
  sessionDraft: SessionBuildDraft | null
  slotDraft: SlotDraft | null
}

export type DialogMaps = {
  pending: {
    get(chatId: number): Pending | null
    set(chatId: number, value: Pending): void
    delete(chatId: number): void
    has(chatId: number): boolean
  }
  productDraft: {
    get(chatId: number): ProductDraft | null
    set(chatId: number, value: ProductDraft): void
    delete(chatId: number): void
  }
  sessionDraft: {
    get(chatId: number): SessionBuildDraft | null
    set(chatId: number, value: SessionBuildDraft): void
    delete(chatId: number): void
  }
  slotDraft: {
    get(chatId: number): SlotDraft | null
    set(chatId: number, value: SlotDraft): void
    delete(chatId: number): void
  }
}

type StateRow = {
  pending: unknown
  productDraft: unknown
  sessionDraft: unknown
  slotDraft: unknown
}

const PENDING_KINDS = new Set([
  'price',
  'note',
  'sessionField',
  'productField',
  'newProductField',
  'newSessionField',
  'newSlotField',
  'productPhoto',
])

function asObject<T>(value: unknown): T | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : null
}

function asPending(value: unknown): Pending | null {
  const object = asObject<{ kind?: unknown }>(value)
  return object && typeof object.kind === 'string' && PENDING_KINDS.has(object.kind)
    ? (object as Pending)
    : null
}

function migrationHint(error: unknown): Error {
  const reason = error instanceof Error ? error.message : String(error)
  if (/bot_dialog_state/i.test(reason) && /(does not exist|relation|не существует)/i.test(reason)) {
    return new Error(
      'Не применена миграция bot_dialog_state. Сделайте резервную копию базы и вызовите ' +
        '/api/admin/migrate-bot-state?token=... с ADMIN_SETUP_TOKEN, если он задан, ' +
        'иначе с SETUP_TOKEN. Не отправляйте токен в чат.',
    )
  }
  return error instanceof Error ? error : new Error(reason)
}

export function emptyDialog(): DialogState {
  return { pending: null, productDraft: null, sessionDraft: null, slotDraft: null }
}

/** Map-совместимая обёртка: обработчики бота продолжают работать с get/set/delete. */
export function stateMaps(state: DialogState): DialogMaps {
  return {
    pending: {
      get: () => state.pending,
      set: (_chatId, value) => {
        state.pending = value
      },
      delete: () => {
        state.pending = null
      },
      has: () => state.pending !== null,
    },
    productDraft: {
      get: () => state.productDraft,
      set: (_chatId, value) => {
        state.productDraft = value
      },
      delete: () => {
        state.productDraft = null
      },
    },
    sessionDraft: {
      get: () => state.sessionDraft,
      set: (_chatId, value) => {
        state.sessionDraft = value
      },
      delete: () => {
        state.sessionDraft = null
      },
    },
    slotDraft: {
      get: () => state.slotDraft,
      set: (_chatId, value) => {
        state.slotDraft = value
      },
      delete: () => {
        state.slotDraft = null
      },
    },
  }
}

export async function loadDialogState(chatId: number): Promise<DialogState> {
  const sql = getDb()
  const read = async (): Promise<DialogState> => {
    const rows = (await sql`
      select pending,
             product_draft as "productDraft",
             session_draft as "sessionDraft",
             slot_draft as "slotDraft"
      from public.bot_dialog_state
      where chat_id = ${chatId}
    `) as unknown as StateRow[]
    const row = rows[0]
    return {
      pending: asPending(row?.pending),
      productDraft: asObject<ProductDraft>(row?.productDraft),
      sessionDraft: asObject<SessionBuildDraft>(row?.sessionDraft),
      slotDraft: asObject<SlotDraft>(row?.slotDraft),
    }
  }
  try {
    return await read()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null
    if (code !== '42P01' || !/bot_dialog_state/i.test(reason)) throw migrationHint(error)
    // Только проверенный webhook администратора доходит до этого места.
    // Автосоздание не обращается к общей схеме и не запускает SEED.
    await applyBotStateSchema()
    console.info('[bot] создана таблица состояния диалогов')
    return read()
  }
}

export async function saveDialogState(chatId: number, state: DialogState): Promise<void> {
  const sql = getDb()
  try {
    await sql`
      insert into public.bot_dialog_state
        (chat_id, pending, product_draft, session_draft, slot_draft, updated_at)
      values (
        ${chatId},
        ${state.pending ? JSON.stringify(state.pending) : null}::jsonb,
        ${state.productDraft ? JSON.stringify(state.productDraft) : null}::jsonb,
        ${state.sessionDraft ? JSON.stringify(state.sessionDraft) : null}::jsonb,
        ${state.slotDraft ? JSON.stringify(state.slotDraft) : null}::jsonb,
        now()
      )
      on conflict (chat_id) do update set
        pending = excluded.pending,
        product_draft = excluded.product_draft,
        session_draft = excluded.session_draft,
        slot_draft = excluded.slot_draft,
        updated_at = now()
    `
  } catch (error) {
    throw migrationHint(error)
  }
}
