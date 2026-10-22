import { ArrowLeft, Bookmark, List, Search, Volume2 } from 'lucide-react'
import { CloseWindowButton } from '../components/AppHeader'
import { IconButton } from '../components/Button'
import controls from '../components/controls.module.css'
import styles from './reader.module.css'

export type ReaderSheet = 'contents' | 'search' | 'text'

interface ReaderToolbarProps {
  title: string
  chapter: string | undefined
  hidden: boolean
  sheet: ReaderSheet | null
  bookmarked: boolean
  readingAloud: boolean
  onBack: () => void
  onSheet: (sheet: ReaderSheet) => void
  onToggleBookmark: () => void
  onReadAloud: () => void
  onHover: (hovering: boolean) => void
}

/** The floating glass toolbar; it fades out while you read. */
export function ReaderToolbar(props: ReaderToolbarProps) {
  const { title, chapter, hidden, sheet, bookmarked, readingAloud } = props
  const toggle = (s: ReaderSheet) => () => props.onSheet(s)
  return (
    <header
      className={styles.toolbar}
      data-hidden={hidden || undefined}
      data-tauri-drag-region
      onPointerEnter={() => props.onHover(true)}
      onPointerLeave={() => props.onHover(false)}
      onFocus={() => props.onHover(true)}
      onBlur={() => props.onHover(false)}
    >
      <button type="button" className={styles.back} onClick={props.onBack}>
        <ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />
        Library
      </button>
      <div className={styles.titleBlock} data-tauri-drag-region>
        <span className={styles.bookTitle} data-tauri-drag-region>
          {title}
        </span>
        {chapter && (
          <span className={styles.chapter} data-tauri-drag-region>
            {chapter}
          </span>
        )}
      </div>
      <div className={styles.tools}>
        <IconButton
          label="Contents"
          aria-pressed={sheet === 'contents'}
          onClick={toggle('contents')}
        >
          <List size={19} strokeWidth={1.8} aria-hidden="true" />
        </IconButton>
        <IconButton
          label="Search in book"
          aria-pressed={sheet === 'search'}
          onClick={toggle('search')}
        >
          <Search size={19} strokeWidth={1.8} aria-hidden="true" />
        </IconButton>
        <IconButton label="Text settings" aria-pressed={sheet === 'text'} onClick={toggle('text')}>
          <span className={styles.aa} aria-hidden="true">
            Aa
          </span>
        </IconButton>
        <IconButton
          label={readingAloud ? 'Stop reading aloud' : 'Read aloud'}
          aria-pressed={readingAloud}
          onClick={props.onReadAloud}
        >
          <Volume2 size={19} strokeWidth={1.8} aria-hidden="true" />
        </IconButton>
        <IconButton
          label={bookmarked ? 'Remove bookmark' : 'Add bookmark'}
          aria-pressed={bookmarked}
          onClick={props.onToggleBookmark}
        >
          <Bookmark
            size={19}
            strokeWidth={1.8}
            fill={bookmarked ? 'currentColor' : 'none'}
            aria-hidden="true"
          />
        </IconButton>
        <span className={controls.divider} aria-hidden="true" />
        <CloseWindowButton />
      </div>
    </header>
  )
}
