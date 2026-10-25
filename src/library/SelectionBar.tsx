import { ChevronDown, LibraryBig, MoreHorizontal, Trash2, X } from 'lucide-react'
import { motion } from 'motion/react'
import { IconButton } from '../components/Button'
import { MenuButton, type MenuEntry } from '../components/Menu'
import { pluralize } from '../lib/format'
import styles from './library.module.css'

interface SelectionBarProps {
  count: number
  total: number
  shelfItems: MenuEntry[]
  statusItems: MenuEntry[]
  /** The rest of the selection's actions (`moreItems`). */
  moreItems: MenuEntry[]
  onSelectAll: () => void
  onDelete: () => void
  onDone: () => void
}

/** Floats at the bottom of the library while books are being selected. */
export function SelectionBar(props: SelectionBarProps) {
  const { count, total, shelfItems, statusItems, moreItems, onSelectAll, onDelete, onDone } = props
  return (
    <motion.div
      role="toolbar"
      aria-label="Selected books"
      className={styles.selectionBar}
      // Slides rather than fades: frosted glass that fades pops when the fade ends.
      initial={{ y: 140 }}
      animate={{ y: 0 }}
      exit={{ y: 140 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
    >
      <span className={styles.selectionCount} aria-live="polite">
        {count ? `${pluralize(count, 'book')} selected` : 'Choose books to select them'}
      </span>
      <MenuButton
        label="Add to shelf"
        className={styles.selectionAction}
        items={shelfItems}
        disabled={count === 0}
      >
        <LibraryBig size={17} strokeWidth={1.8} aria-hidden="true" />
        Add to shelf
        <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
      </MenuButton>
      <MenuButton
        label="Mark as"
        className={styles.selectionAction}
        items={statusItems}
        disabled={count === 0}
      >
        Mark as
        <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
      </MenuButton>
      <MenuButton
        label={count === 1 ? 'More for the selected book' : 'More for the selected books'}
        title="More"
        className={`${styles.selectionAction} ${styles.selectionMore}`}
        items={moreItems}
        disabled={count === 0}
      >
        <MoreHorizontal size={18} strokeWidth={1.8} aria-hidden="true" />
      </MenuButton>
      <IconButton
        label={count === 1 ? 'Delete the selected book' : 'Delete the selected books'}
        className={styles.selectionDelete}
        disabled={count === 0}
        onClick={onDelete}
      >
        <Trash2 size={17} strokeWidth={1.8} aria-hidden="true" />
      </IconButton>
      {count < total && (
        <button type="button" className={styles.selectionQuiet} onClick={onSelectAll}>
          Select all
        </button>
      )}
      <IconButton label="Done selecting" className={styles.selectionClose} onClick={onDone}>
        <X size={18} strokeWidth={2} aria-hidden="true" />
      </IconButton>
    </motion.div>
  )
}
