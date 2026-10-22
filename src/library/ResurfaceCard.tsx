import { RotateCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Cover } from '../components/Cover'
import { dayKey, formatAgo, formatAuthors } from '../lib/format'
import { markerBackground } from '../lib/highlightColors'
import { useToday } from '../lib/hooks'
import { api } from '../lib/ipc'
import type { Resurfaced } from '../lib/types'
import { allHighlights, resurfaceOrder } from '../highlights/resurface'
import { useApp } from '../state/app'
import { useColorScheme } from '../theme/aura'
import styles from './library.module.css'
import type { LibraryBook } from './model'

/** "From your highlights": an older highlight to revisit, with a button for another. */
export function ResurfaceCard({ books }: { books: LibraryBook[] }) {
  const navigate = useApp((s) => s.navigate)
  const dark = useColorScheme() === 'dark'
  /** What was shown on earlier days; loaded once so today's order stays put. */
  const [history, setHistory] = useState<Resurfaced[] | null>(null)
  const loggedToday = useRef(new Set<string>())
  const [step, setStep] = useState(0)
  const today = dayKey(useToday().getTime())

  useEffect(() => {
    let live = true
    api.listResurfaced().then(
      (entries) => live && setHistory(entries),
      () => live && setHistory([]),
    )
    return () => {
      live = false
    }
  }, [])

  const highlights = useMemo(() => allHighlights(books), [books])
  const ordered = useMemo(
    () => (history ? resurfaceOrder(highlights, history, today) : []),
    [highlights, history, today],
  )
  const current = ordered.length ? ordered[step % ordered.length] : undefined

  useEffect(() => {
    if (!current || !history) return
    const id = current.annotation.id
    const alreadyLogged =
      loggedToday.current.has(id) || history.some((e) => e.highlight === id && e.day === today)
    if (alreadyLogged) return
    loggedToday.current.add(id)
    api
      .logResurfaced([{ highlight: id, day: today }])
      .catch((e) => console.warn('logging a resurfaced highlight failed', e))
  }, [current, history, today])

  if (!current) return null
  const { book, annotation } = current
  const author = formatAuthors(book.authors)
  return (
    <section className={styles.card} aria-labelledby="resurface-heading">
      <div className={styles.cardHeader}>
        <h2 id="resurface-heading">From your highlights</h2>
        {ordered.length > 1 && (
          <button
            type="button"
            className={styles.dropdown}
            style={{
              border: 'none',
              background: 'transparent',
              margin: '-10px -12px -10px 0',
              color: 'var(--haze)',
            }}
            onClick={() => setStep((s) => s + 1)}
          >
            <RotateCw size={15} strokeWidth={2} aria-hidden="true" />
            Another
          </button>
        )}
      </div>
      <blockquote className={styles.quote}>
        <span
          className={styles.quoteMark}
          style={{ backgroundImage: markerBackground(annotation.color, dark) }}
        >
          {annotation.text}
        </span>
      </blockquote>
      <button
        type="button"
        className={styles.quoteSource}
        onClick={() => navigate({ name: 'highlights', book: book.fingerprint })}
      >
        <Cover entry={book.entry} title={book.title} authors={book.authors} width={30} />
        <span style={{ minWidth: 0 }}>
          <strong>{book.title}</strong>
          <span className={styles.muted} style={{ display: 'block' }}>
            {[author, `highlighted ${formatAgo(annotation.createdAt)}`].filter(Boolean).join(', ')}
          </span>
        </span>
      </button>
    </section>
  )
}
