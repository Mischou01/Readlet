import { ArrowLeft, Search } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '../components/Button'
import fields from '../components/fields.module.css'
import { toAppError, api } from '../lib/ipc'
import { formatAuthors } from '../lib/format'
import type { BookEntry, FoundBook } from '../lib/types'
import { openLibraryCover } from '../lib/urls'
import { differences, foundForm, searchQueryFor, type DetailsForm } from './details'
import styles from './details.module.css'

const LABELS: Record<keyof DetailsForm, string> = {
  title: 'Title',
  authors: 'Authors',
  series: 'Series',
  seriesIndex: 'Number in series',
  language: 'Language',
  publisher: 'Publisher',
  published: 'Published',
  identifier: 'ISBN',
  description: 'Description',
}

interface Picked {
  book: FoundBook
  found: Partial<DetailsForm>
  /** The fields that would change the form. */
  fields: (keyof DetailsForm)[]
  cover: number | null
}

interface FindDetailsProps {
  entry: BookEntry
  form: DetailsForm
  /** Whether the form shows a cover now, so a found one isn't ticked over it. */
  hasCover: boolean
  /** Fills the form with the ticked values (and the cover, if ticked); nothing is saved yet. */
  onUse: (values: Partial<DetailsForm>, cover: number | null) => void
}

/**
 * Searches Open Library and lets the reader pick an edition, then tick which of its details to
 * use. Searching starts as soon as this opens: opening it is the reader asking.
 */
export function FindDetails({ entry, form, hasCover, onUse }: FindDetailsProps) {
  const [query, setQuery] = useState(() => searchQueryFor(entry))
  const [results, setResults] = useState<FoundBook[] | null>(null)
  // The first search starts as soon as this opens.
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  // Only the latest request's answer is shown.
  const request = useRef(0)

  /** Shows the answer to the latest request only. */
  const answer = useCallback(async (q: string) => {
    const id = ++request.current
    const result = await api.searchBookDetails(q).then(
      (found) => ({ found }),
      (e: unknown) => ({ error: toAppError(e).message }),
    )
    return id === request.current ? result : null
  }, [])

  const search = async (q: string) => {
    setBusy(true)
    setError(null)
    setPicked(null)
    show(await answer(q))
  }

  const show = (result: { found: FoundBook[] } | { error: string } | null) => {
    if (!result) return
    if ('found' in result) setResults(result.found)
    else setError(result.error)
    setBusy(false)
  }

  useEffect(() => {
    void (async () => show(await answer(query)))()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the first search only
  }, [])

  const pick = async (book: FoundBook) => {
    const id = ++request.current
    setBusy(true)
    setError(null)
    try {
      const details = await api.fetchBookDetails(book.work, book.edition)
      if (id !== request.current) return
      const found = foundForm(book, details)
      const changed = differences(form, found)
      const cover = details.cover ?? book.cover
      setPicked({ book, found, fields: changed, cover })
      // Nothing the reader has is replaced unless they tick it: only blanks start ticked.
      setTicked(
        new Set([
          ...changed.filter((f) => !form[f].trim()),
          ...(cover != null && !hasCover ? ['cover'] : []),
        ]),
      )
    } catch (e) {
      if (id === request.current) setError(toAppError(e).message)
    } finally {
      if (id === request.current) setBusy(false)
    }
  }

  const toggle = (field: string) =>
    setTicked((current) => {
      const next = new Set(current)
      if (next.has(field)) next.delete(field)
      else next.add(field)
      return next
    })

  if (picked) {
    const { book, found, cover } = picked
    const nothingNew = picked.fields.length === 0 && cover == null
    return (
      <div className={styles.find}>
        <Button
          size="small"
          variant="quiet"
          icon={<ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />}
          onClick={() => setPicked(null)}
        >
          Other editions
        </Button>
        <p className={styles.hint}>
          {nothingNew
            ? 'Your details already match this edition.'
            : `Tick what to use from “${book.title}”. Nothing is saved until you press Save.`}
        </p>
        <ul className={styles.compare}>
          {cover != null && (
            <li>
              <label className={styles.compareRow}>
                <input
                  type="checkbox"
                  checked={ticked.has('cover')}
                  onChange={() => toggle('cover')}
                />
                <span className={styles.compareText}>
                  <span className={styles.compareLabel}>Cover</span>
                  <img className={styles.foundCover} src={openLibraryCover(cover)} alt="" />
                </span>
              </label>
            </li>
          )}
          {picked.fields.map((field) => (
            <li key={field}>
              <label className={styles.compareRow}>
                <input type="checkbox" checked={ticked.has(field)} onChange={() => toggle(field)} />
                <span className={styles.compareText}>
                  <span className={styles.compareLabel}>{LABELS[field]}</span>
                  <span className={styles.compareFound}>
                    {found[field]?.replace(/\n+/g, ' · ')}
                  </span>
                  <span className={styles.compareNow}>
                    {form[field].trim()
                      ? `Now: ${form[field].replace(/\n+/g, ' · ')}`
                      : 'Now empty'}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className={styles.formActions}>
          <span className={styles.spacer} />
          <Button
            size="small"
            variant="primary"
            disabled={ticked.size === 0}
            onClick={() =>
              onUse(
                Object.fromEntries(
                  picked.fields.filter((f) => ticked.has(f)).map((f) => [f, found[f]]),
                ),
                ticked.has('cover') ? cover : null,
              )
            }
          >
            Use selected
          </Button>
        </div>
      </div>
    )
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (query.trim()) void search(query)
  }

  return (
    <div className={styles.find}>
      <form className={styles.searchRow} onSubmit={submit} role="search">
        <input
          className={fields.textInput}
          aria-label="Title, author or ISBN"
          placeholder="Title, author or ISBN"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button
          size="small"
          type="submit"
          disabled={busy || !query.trim()}
          icon={<Search size={16} strokeWidth={1.8} aria-hidden="true" />}
        >
          Search
        </Button>
      </form>
      <p className={styles.hint}>Searches Open Library with what you type here.</p>

      {error && (
        <p className={styles.findMessage} role="alert">
          {error}
        </p>
      )}
      {busy && <p className={styles.findMessage}>Looking it up…</p>}
      {!busy && !error && results?.length === 0 && (
        <p className={styles.findMessage}>Nothing found. Try fewer words, or the ISBN.</p>
      )}

      {!busy && results && results.length > 0 && (
        <ul className={styles.results} aria-label="Editions found">
          {results.map((book) => (
            <li key={`${book.work}/${book.edition ?? ''}`}>
              <button type="button" className={styles.result} onClick={() => void pick(book)}>
                {book.cover != null ? (
                  <img
                    className={styles.resultCover}
                    src={openLibraryCover(book.cover)}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <span className={styles.resultCover} />
                )}
                <span className={styles.resultText}>
                  <span className={styles.resultTitle}>{book.title}</span>
                  <span className={styles.resultMeta}>
                    {[formatAuthors(book.authors), book.year, book.publisher]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
