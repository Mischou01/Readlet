import styles from './details.module.css'

/** Names from the library that match what's typed into a field, to tap instead (names.ts). */
export function NameSuggestions({
  names,
  label,
  onPick,
}: {
  names: readonly string[]
  label: string
  onPick: (name: string) => void
}) {
  if (!names.length) return null
  return (
    <div className={styles.suggestions} role="group" aria-label={label}>
      {names.map((name) => (
        <button key={name} type="button" className={styles.suggestion} onClick={() => onPick(name)}>
          {name}
        </button>
      ))}
    </div>
  )
}
