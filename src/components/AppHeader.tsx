import { getCurrentWindow } from '@tauri-apps/api/window'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useApp, type Section } from '../state/app'
import { IconButton } from './Button'
import controls from './controls.module.css'
import styles from './AppHeader.module.css'
import { Logo } from './Logo'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'library', label: 'Library' },
  { id: 'highlights', label: 'Highlights' },
  { id: 'stats', label: 'Stats' },
]

/** Closes the window. Pending writes are flushed by the close-requested handlers. */
export function CloseWindowButton() {
  return (
    <IconButton label="Close window" onClick={() => void getCurrentWindow().close()}>
      <span className={controls.close}>
        <X size={13} strokeWidth={2.4} aria-hidden="true" />
      </span>
    </IconButton>
  )
}

/** The window's title bar: brand, the section switcher and per-view actions. Draggable. */
export function AppHeader({ section, actions }: { section: Section; actions?: ReactNode }) {
  const navigate = useApp((s) => s.navigate)
  return (
    <header className={styles.header} data-tauri-drag-region>
      <div className={styles.brand} data-tauri-drag-region>
        <Logo />
        <span data-tauri-drag-region>Readlet</span>
      </div>
      <nav className={styles.nav} aria-label="Sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={styles.navItem}
            aria-current={s.id === section ? 'page' : undefined}
            onClick={() => navigate({ name: s.id })}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <div className={styles.actions} data-tauri-drag-region>
        {actions}
        <span className={controls.divider} aria-hidden="true" />
        <CloseWindowButton />
      </div>
    </header>
  )
}
