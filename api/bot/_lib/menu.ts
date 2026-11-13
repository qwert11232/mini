import { adminIds } from './db.js'
import { setChatMenuButton, setMyCommands, takeLastError, type BotCommand } from './telegram.js'

const PLAYER_COMMANDS: BotCommand[] = [
  { command: 'start', description: 'Главное меню' },
  { command: 'me', description: 'Мои записи' },
  { command: 'orders', description: 'Мои заказы' },
  { command: 'schedule', description: 'Расписание занятий' },
  { command: 'help', description: 'Помощь' },
]

const ADMIN_COMMANDS: BotCommand[] = [
  { command: 'start', description: 'Панель администратора' },
  { command: 'me', description: 'Мои записи' },
  { command: 'schedule', description: 'Расписание · панель' },
  { command: 'help', description: 'Справка панели' },
  { command: 'today', description: 'Записи на сегодня' },
  { command: 'tomorrow', description: 'Записи на завтра' },
  { command: 'orders', description: 'Заказы к выдаче' },
  { command: 'admin', description: 'Панель администратора' },
]

export type MenuStep = { step: string; ok: boolean; detail?: unknown }

/** Обновляет только кнопку и подсказки команд; webhook и очередь не меняет. */
export async function configureBotMenu(app: string): Promise<MenuStep[]> {
  const result: MenuStep[] = []
  const button = await setChatMenuButton(app, 'Открыть приложение')
  result.push({ step: 'setChatMenuButton', ok: button, detail: button ? app : takeLastError() })

  const defaults = await setMyCommands(PLAYER_COMMANDS, { type: 'default' })
  result.push({ step: 'setMyCommands:default', ok: defaults, detail: defaults ? PLAYER_COMMANDS.length : takeLastError() })

  const players = await setMyCommands(PLAYER_COMMANDS, { type: 'all_private_chats' })
  result.push({ step: 'setMyCommands:players', ok: players, detail: players ? PLAYER_COMMANDS.length : takeLastError() })

  for (const id of adminIds()) {
    const chatId = Number(id)
    const configured = await setMyCommands(ADMIN_COMMANDS, { type: 'chat', chat_id: chatId })
    result.push({
      step: 'setMyCommands:admin',
      ok: configured,
      detail: configured ? chatId : { chatId, error: takeLastError() },
    })
  }
  return result
}
