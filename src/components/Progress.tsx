import type { CSSProperties } from 'react'

interface ProgressBarProps {
  /** 0–1 */
  value: number
  label: string
  height?: number
  color?: string
  className?: string
  style?: CSSProperties
}

export function ProgressBar({
  value,
  label,
  height = 6,
  color = 'var(--accent)',
  className,
  style,
}: ProgressBarProps) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={className}
      style={{
        height,
        borderRadius: 999,
        overflow: 'hidden',
        background: 'var(--track)',
        ...style,
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          borderRadius: 999,
          background: color,
          transition: 'width 600ms var(--ease-out), background-color 1.2s var(--ease-out)',
        }}
      />
    </div>
  )
}

interface ProgressRingProps {
  value: number
  size: number
  stroke: number
  label: string
}

export function ProgressRing({ value, size, stroke, label }: ProgressRingProps) {
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const filled = Math.max(0, Math.min(1, value)) * circumference
  const c = size / 2
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
      {filled > 0 && (
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          transform={`rotate(-90 ${c} ${c})`}
          style={{
            transition: 'stroke-dasharray 800ms var(--ease-out), stroke 1.2s var(--ease-out)',
          }}
        />
      )}
    </svg>
  )
}
