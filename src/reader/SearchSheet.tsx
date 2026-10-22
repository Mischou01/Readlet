import { Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Sheet } from '../components/Sheet'
import { pluralize } from '../lib/format'
import type { SearchExcerpt, SearchResult } from './foliate'
import styles from './reader.module.css'

interface Group {
  label: string
  items: { cfi: string; excerpt: SearchExcerpt }[]
}

interface SearchSheetProps {
  search: (query: string, onResult: (result: SearchResult) => void) => () => void
  onGoTo: (cfi: string) => void
  onClose: () => void
}

/** In-book search. foliate-js searches section by section, so results stream in. */
export function SearchSheet({ search, onGoTo, onClose }: SearchSheetProps) {
  const [query, setQuery] = useState('')
  const [groups, setGroups] = useState<Group[]>([])
  const [progress, setProgress] = useState<number | null>(null)
  const [searched, setSearched] = useState('')
  const stop = useRef<(() => void) | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus({ preventScroll: true })
    return () => stop.current?.()
  }, [])

  const run = () => {
    const q = query.trim()
    stop.current?.()
    setGroups([])
    setSearched(q)
    if (q.length < 2) {
      setProgress(null)
      return
    }
    setProgress(0)
    stop.current = search(q, (result) => {
      if (result === 'done') setProgress(null)
      else if ('progress' in result) setProgress(result.progress)
      else if ('subitems' in result) {
        const group = { label: result.label, items: result.subitems }
        setGroups((g) => [...g, group])
      }
    })
  }

  const total = groups.reduce((n, g) => n + g.items.length, 0)
  return (
    <Sheet
      title="Search"
      onClose={onClose}
      toolbar={
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            run()
          }}
        >
          <label className={styles.searchField}>
            <Search size={18} strokeWidth={1.8} aria-hidden="true" />
            <span className="visually-hidden">Search in this book</span>
            <input
              ref={input}
              type="search"
              placeholder="Search in this book"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </form>
      }
    >
      <p className={styles.searchStatus} role="status">
        {progress !== null
          ? `Searching… ${Math.round(progress * 100)}%${total ? `, ${pluralize(total, 'result')} so far` : ''}`
          : searched.length >= 2
            ? total
              ? pluralize(total, 'result')
              : `Nothing found for “${searched}”`
            : searched
              ? 'Type at least two letters'
              : ''}
      </p>
      {groups.map((group, gi) => (
        <section key={gi} aria-label={group.label}>
          {group.label && (
            <h3 className={styles.listMeta} style={{ padding: '10px 12px 2px' }}>
              {group.label}
            </h3>
          )}
          {group.items.map((item) => (
            <button
              key={item.cfi}
              type="button"
              className={`${styles.tocItem} ${styles.excerpt}`}
              onClick={() => onGoTo(item.cfi)}
            >
              {item.excerpt.pre}
              <mark>{item.excerpt.match}</mark>
              {item.excerpt.post}
            </button>
          ))}
        </section>
      ))}
    </Sheet>
  )
}
