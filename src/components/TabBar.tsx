import type { SectionId } from '../lib/types'
import { IconBag, IconBall, IconCalendar, IconHome, IconInfo } from './Icons'
import { haptic } from '../lib/telegram'

type Tab = {
  id: SectionId
  label: string
  Icon: typeof IconHome
}

const TABS: Tab[] = [
  { id: 'home', label: 'Клуб', Icon: IconHome },
  { id: 'schedule', label: 'Занятия', Icon: IconCalendar },
  { id: 'play', label: 'Игра', Icon: IconBall },
  { id: 'shop', label: 'Магазин', Icon: IconBag },
  { id: 'about', label: 'О нас', Icon: IconInfo },
]

export function TabBar({
  active,
  onSelect,
}: {
  active: SectionId
  onSelect: (id: SectionId) => void
}) {
  return (
    <nav className="tabbar glass" aria-label="Разделы приложения">
      <div className="tabbar-inner">
        {TABS.map(({ id, label, Icon }) => {
          const isActive = id === active
          return (
            <button
              key={id}
              type="button"
              className={`tab${isActive ? ' is-active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => {
                haptic('select')
                onSelect(id)
              }}
            >
              <span className="tab-icon">
                <Icon size={23} strokeWidth={isActive ? 2 : 1.7} />
              </span>
              <span className="tab-label">{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
