import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 22, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...props,
  }
}

export function IconHome(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" />
      <path d="M9.5 20.5v-6h5v6" />
    </svg>
  )
}

export function IconCalendar(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="5.5" width="17" height="15" rx="3.2" />
      <path d="M8 3.5v4M16 3.5v4M3.5 10.5h17" />
    </svg>
  )
}

export function IconBall(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M4.6 8.2c3.4 1.1 5.7 4.4 5.7 8.2M19.4 8.2c-3.4 1.1-5.7 4.4-5.7 8.2" />
    </svg>
  )
}

export function IconBag(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.8 8.4h14.4l-1.1 10.1a2 2 0 0 1-2 1.8H7.9a2 2 0 0 1-2-1.8z" />
      <path d="M8.8 8.4V7a3.2 3.2 0 0 1 6.4 0v1.4" />
    </svg>
  )
}

export function IconInfo(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 11v5.2" />
      <circle cx="12" cy="8.1" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconChevron(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m9.5 5.5 7 6.5-7 6.5" />
    </svg>
  )
}

export function IconChevronDown(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m6 9.5 6 6 6-6" />
    </svg>
  )
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m5 12.5 4.5 4.5L19 6.5" />
    </svg>
  )
}

export function IconClose(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export function IconHeart(props: IconProps & { filled?: boolean }) {
  const { filled, ...rest } = props
  return (
    <svg {...base(rest)} fill={filled ? 'currentColor' : 'none'}>
      <path d="M12 20s-7.4-4.6-7.4-9.4A4.1 4.1 0 0 1 12 7.7a4.1 4.1 0 0 1 7.4 2.9C19.4 15.4 12 20 12 20z" />
    </svg>
  )
}

export function IconClock(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.6V12l3.2 2" />
    </svg>
  )
}

export function IconPin(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 21s6.5-5.6 6.5-10.4A6.5 6.5 0 0 0 5.5 10.6C5.5 15.4 12 21 12 21z" />
      <circle cx="12" cy="10.4" r="2.4" />
    </svg>
  )
}

export function IconPhone(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6.4 4.5h2.9l1.4 3.6-2 1.4a10 10 0 0 0 5.3 5.3l1.4-2 3.6 1.4v2.9a2 2 0 0 1-2.2 2A15.6 15.6 0 0 1 4.4 6.7a2 2 0 0 1 2-2.2z" />
    </svg>
  )
}

export function IconTrophy(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 4.5h8v4.2a4 4 0 0 1-8 0z" />
      <path d="M8 6H5.5v1.6A3 3 0 0 0 8 10.5M16 6h2.5v1.6a3 3 0 0 1-2.5 2.9" />
      <path d="M12 12.7V16M8.6 19.5h6.8" />
    </svg>
  )
}

export function IconUsers(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="9.5" cy="8.6" r="3.1" />
      <path d="M3.8 19.4a5.8 5.8 0 0 1 11.4 0M16.4 6.1a3 3 0 0 1 0 5.6M18 19.4a5.4 5.4 0 0 0-1.7-3.9" />
    </svg>
  )
}

export function IconSparkle(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.8l1.7 4.7 4.7 1.7-4.7 1.7L12 16.6l-1.7-4.7L5.6 10.2l4.7-1.7z" />
      <path d="M18.4 16.2l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </svg>
  )
}

export function IconArrowUpRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 17 17 7M8.5 7H17v8.5" />
    </svg>
  )
}

export function IconMinus(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 12h12" />
    </svg>
  )
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 6v12M6 12h12" />
    </svg>
  )
}

export function IconCloud(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7.4 18.2a4.1 4.1 0 0 1-.5-8.2 5.3 5.3 0 0 1 10.2-1.4 3.9 3.9 0 0 1 .9 7.7" />
      <path d="M12 11.6v7.1M9.3 16.2 12 18.9l2.7-2.7" />
    </svg>
  )
}

export function IconTelegram(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20.5 4.6 3.9 10.9c-.9.3-.9 1.5.1 1.7l4 1.1 1.5 4.6c.3.8 1.3 1 1.9.4l2.2-2.1 3.9 2.9c.7.5 1.6.1 1.8-.7l2.4-12.5c.2-.9-.7-1.6-1.2-1.7z" />
      <path d="m8 13.7 8.9-5.5-7.2 6.5" />
    </svg>
  )
}

export function IconStar(props: IconProps) {
  return (
    <svg {...base(props)} fill="currentColor" stroke="none">
      <path d="M12 4.5l2.3 4.8 5.2.7-3.8 3.7.9 5.2-4.6-2.5-4.6 2.5.9-5.2-3.8-3.7 5.2-.7z" />
    </svg>
  )
}

/* ── Теннисные акценты: не иконки-функции, а графика ─────────────────────── */

export function CourtMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 120" fill="none" aria-hidden>
      <rect x="1" y="1" width="198" height="118" rx="4" stroke="currentColor" strokeWidth="1.5" opacity="0.55" />
      <rect x="20" y="1" width="160" height="118" stroke="currentColor" strokeWidth="1.2" opacity="0.35" />
      <path d="M20 60h160M100 1v118" stroke="currentColor" strokeWidth="1.2" opacity="0.35" />
      <path d="M60 40h80v40H60z" stroke="currentColor" strokeWidth="1.2" opacity="0.28" />
    </svg>
  )
}

export function BallSeams({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" aria-hidden>
      <circle cx="50" cy="50" r="46" stroke="currentColor" strokeWidth="1.4" opacity="0.5" />
      <path
        d="M14 22c18 6 30 20 30 36S36 88 18 94M86 22C68 28 56 42 56 58s8 30 26 36"
        stroke="currentColor"
        strokeWidth="1.4"
        opacity="0.35"
      />
    </svg>
  )
}
