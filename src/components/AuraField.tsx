import styles from './AuraField.module.css'

/** The colour field behind the chrome, in the current book's aura colours. */
export function AuraField({ placement }: { placement: 'top' | 'corner' | 'bottom' }) {
  return (
    <div className={`${styles.field} ${styles[placement]}`} aria-hidden="true">
      <div className={styles.blob} />
      <div className={styles.blob} />
      <div className={styles.blob} />
    </div>
  )
}
