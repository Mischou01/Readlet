import { FolderOpen, Globe, Plus, Search, SlidersVertical, X } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AppHeader } from '../components/AppHeader'
import { AuraField } from '../components/AuraField'
import { Button, IconButton } from '../components/Button'
import { pluralize } from '../lib/format'
import { isAndroid } from '../lib/platform'
import { useApp } from '../state/app'
import { useLibrary, useLibraryBooks } from '../state/library'
import { useAuraFor } from '../theme/aura'
import { pickAndAddBooks, pickLibraryFolder } from './actions'
import { BookCollection } from './BookCollection'
import { FindBooksSheet } from './FindBooksSheet'
import { GoalCard } from './GoalCard'
import { Hero } from './Hero'
import { useIndexer } from './indexer'
import styles from './library.module.css'
import { pickCurrentBook, sortBooks, type LibraryBook } from './model'
import { ResurfaceCard } from './ResurfaceCard'

/** The hero book: what you're reading, or else the newest unread book. */
function heroBook(books: LibraryBook[]): LibraryBook | null {
  return (
    pickCurrentBook(books) ??
    sortBooks(
      books.filter((b) => b.status === 'toRead' && !b.entry.drm),
      'added',
    )[0] ??
    null
  )
}

export function LibraryView() {
  const books = useLibraryBooks()
  const loaded = useLibrary((s) => s.loaded)
  const scanning = useLibrary((s) => s.scanning)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [findingOnline, setFindingOnline] = useState<string | null>(null)
  const hero = useMemo(() => heroBook(books), [books])
  useAuraFor(hero?.entry.palette)

  const actions = (
    <>
      {searching ? (
        <SearchField
          value={query}
          onChange={setQuery}
          onClose={() => {
            setQuery('')
            setSearching(false)
          }}
        />
      ) : (
        <IconButton glass label="Search your books" onClick={() => setSearching(true)}>
          <Search size={19} strokeWidth={1.8} aria-hidden="true" />
        </IconButton>
      )}
      <IconButton glass label="Add books" onClick={() => void pickAndAddBooks()}>
        <Plus size={19} strokeWidth={1.8} aria-hidden="true" />
      </IconButton>
      <IconButton glass label="Settings" onClick={() => setSettingsOpen(true)}>
        <SlidersVertical size={19} strokeWidth={1.8} aria-hidden="true" />
      </IconButton>
    </>
  )

  const empty = loaded && !scanning && books.length === 0
  return (
    <div className={styles.page}>
      <AuraField placement="top" />
      <AppHeader section="library" actions={actions} />
      <main className={styles.main}>
        {empty ? (
          <EmptyLibrary />
        ) : (
          <>
            {hero && !query && (
              <section className={styles.hero} aria-label="Continue reading">
                <Hero book={hero} />
                <aside className={styles.aside}>
                  <ResurfaceCard books={books} />
                  <GoalCard current={hero.status === 'reading' ? hero : null} />
                </aside>
              </section>
            )}
            <IndexingStatus />
            <BookCollection books={books} query={query} />
            {query.trim() && (
              <button
                type="button"
                className={styles.searchOnline}
                onClick={() => setFindingOnline(query.trim())}
              >
                <Globe size={17} strokeWidth={1.8} aria-hidden="true" />
                Search online for “{query.trim()}”
              </button>
            )}
          </>
        )}
      </main>
      <AnimatePresence>
        {findingOnline !== null && (
          <FindBooksSheet query={findingOnline} onClose={() => setFindingOnline(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}

function SearchField({
  value,
  onChange,
  onClose,
}: {
  value: string
  onChange: (v: string) => void
  onClose: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  return (
    <div className={styles.search} role="search">
      <Search size={18} strokeWidth={1.8} aria-hidden="true" />
      <input
        ref={input}
        type="search"
        aria-label="Search by title or author"
        placeholder="Title or author"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <IconButton label="Close search" onClick={onClose} style={{ width: 34, height: 34 }}>
        <X size={16} aria-hidden="true" />
      </IconButton>
    </div>
  )
}

function IndexingStatus() {
  const { running, done, total } = useIndexer()
  if (!running || total === 0) return null
  const left = Math.max(0, total - done)
  return (
    <div className={styles.indexing} role="status" style={{ marginTop: 40 }}>
      <span className={styles.spinner} aria-hidden="true" />
      Getting {pluralize(left, 'book')} ready
    </div>
  )
}

function EmptyLibrary() {
  const root = useApp((s) => s.info?.libraryRoot)
  return (
    <div className={styles.emptyLibrary}>
      <h1>Your shelves are waiting</h1>
      <p>
        There are no books in {root ? <strong>{root}</strong> : 'your books folder'} yet.{' '}
        {isAndroid
          ? 'Add some, or put EPUB, MOBI, AZW3, FB2, CBZ or PDF (experimental) files in that folder.'
          : 'Add some, or drop EPUB, MOBI, AZW3, FB2, CBZ or PDF (experimental) files anywhere in this window.'}
      </p>
      <div className={styles.heroActions}>
        <Button
          variant="primary"
          icon={<Plus size={18} aria-hidden="true" />}
          onClick={() => void pickAndAddBooks()}
        >
          Add books
        </Button>
        <Button
          icon={<FolderOpen size={18} strokeWidth={1.8} aria-hidden="true" />}
          onClick={() => void pickLibraryFolder()}
        >
          Choose another folder
        </Button>
      </div>
    </div>
  )
}
