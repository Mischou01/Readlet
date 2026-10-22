/** Two overlapping pebbles: one ink, one in the current book's accent. */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true">
      <ellipse cx="12" cy="16" rx="8" ry="10.5" transform="rotate(-16 12 16)" fill="var(--ink)" />
      <ellipse
        cx="19"
        cy="14"
        rx="7.5"
        ry="10"
        transform="rotate(18 19 14)"
        fill="var(--accent)"
        opacity="0.85"
        style={{ transition: 'fill 1.2s var(--ease-out)' }}
      />
    </svg>
  )
}
