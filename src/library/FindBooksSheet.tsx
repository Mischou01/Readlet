import { openUrl } from '@tauri-apps/plugin-opener'
import { Check, Download, ExternalLink, Search } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '../components/Button'
import fields from '../components/fields.module.css'
import { Sheet } from '../components/Sheet'
import { api, toAppError } from '../lib/ipc'
import type { FreeBook } from '../lib/types'
import { gutenbergCover } from '../lib/urls'
import { expectAddedFiles, useLibraryBooks } from '../state/library'
import { showError, useToasts } from '../state/toasts'
import styles from './details.module.css'
import { inLibrary, storeLinks } from './freeBooks'

type Download = 'downloading' | 'added'

type Answer = { books: FreeBook[] } | { error: string }

/**
 * Free books from Project Gutenberg, downloaded straight into the books folder, and stores to try
 * when there's no free edition. Opened from the library's search, which is the reader asking, so
 * it searches as soon as it opens.
 */
export function FindBooksSheet({
  query: initial,
  onClose,
}: {
  query: string
  onClose: () => void
}) {
  const library = useLibraryBooks()
  const [query, setQuery] = useState(initial)
  const [searched, setSearched] = useState(initial)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [downloads, setDownloads] = useState<Record<number, Download>>({})
  // Only the latest search's answer is shown.
  const request = useRef(0)

  const fetchAnswer = async (q: string): Promise<Answer | null> => {
    const id = ++request.current
    const result = await api.searchFreeBooks(q).then(
      (books) => ({ books }),
      (e: unknown) => ({ error: toAppError(e).message }),
    )
    return id === request.current ? result : null
  }

  useEffect(() => {
    void (async () => {
      const result = await fetchAnswer(initial)
      if (result) setAnswer(result)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the first search only
  }, [])

  const search = async (e: FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    setSearched(q)
    setAnswer(null)
    const result = await fetchAnswer(q)
    if (result) setAnswer(result)
  }

  const download = async (book: FreeBook) => {
    setDownloads((d) => ({ ...d, [book.id]: 'downloading' }))
    try {
      const added = await api.downloadFreeBook(book)
      expectAddedFiles(added)
      setDownloads((d) => ({ ...d, [book.id]: 'added' }))
      useToasts.getState().show({
        message: added.length
          ? `Added “${book.title}” to your library`
          : `“${book.title}” is already in your library`,
      })
    } catch (err) {
      setDownloads(({ [book.id]: _, ...rest }) => rest)
      showError(`Couldn’t download “${book.title}”: ${toAppError(err).message}`)
    }
  }

  const books = answer && 'books' in answer ? answer.books : null

  return (
    <Sheet title="Find books online" onClose={onClose} style={{ top: 82 }}>
      <div className={styles.find}>
        <form className={styles.searchRow} onSubmit={(e) => void search(e)} role="search">
          <input
            className={fields.textInput}
            aria-label="Title or author"
            placeholder="Title or author"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button
            size="small"
            type="submit"
            disabled={!query.trim()}
            icon={<Search size={16} strokeWidth={1.8} aria-hidden="true" />}
          >
            Search
          </Button>
        </form>
        <p className={styles.hint}>
          Free public-domain books from Project Gutenberg, added straight to your books folder.
        </p>

        {!answer && <p className={styles.findMessage}>Looking it up…</p>}
        {answer && 'error' in answer && (
          <p className={styles.findMessage} role="alert">
            {answer.error}
          </p>
        )}
        {books?.length === 0 && (
          <p className={styles.findMessage}>No free edition found for “{searched}”.</p>
        )}

        {books && books.length > 0 && (
          <ul className={styles.results} aria-label="Free books">
            {books.map((book) => {
              const state = downloads[book.id]
              const have = state === 'added' || inLibrary(book, library)
              return (
                <li key={book.id} className={styles.resultRow}>
                  <img
                    className={styles.resultCover}
                    src={gutenbergCover(book.id)}
                    alt=""
                    loading="lazy"
                    onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
                  />
                  <span className={styles.resultText}>
                    <span className={styles.resultTitle}>{book.title}</span>
                    <span className={styles.resultMeta}>
                      {[book.author, have ? 'In your library' : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className={styles.spacer} />
                  {state === 'added' ? (
                    <Check size={18} strokeWidth={2} aria-label="Added" />
                  ) : (
                    <Button
                      size="small"
                      variant={have ? 'quiet' : 'secondary'}
                      disabled={state === 'downloading'}
                      icon={<Download size={16} strokeWidth={1.8} aria-hidden="true" />}
                      aria-label={`Download ${book.title}`}
                      onClick={() => void download(book)}
                    >
                      {state === 'downloading' ? 'Downloading…' : 'Download'}
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {answer && (
          <section className={styles.stores} aria-label="Stores">
            <h3>Not a free book?</h3>
            <p className={styles.hint}>
              Readlet can’t tell whether a store’s copy is DRM-free, and only DRM-free books open
              here. These are good places to look:
            </p>
            <ul className={styles.results}>
              {storeLinks(searched).map((store) => (
                <li key={store.name}>
                  <button
                    type="button"
                    className={styles.result}
                    onClick={() =>
                      void openUrl(store.url).catch((e: unknown) =>
                        showError(toAppError(e).message),
                      )
                    }
                  >
                    <span className={styles.resultText}>
                      <span className={styles.resultTitle}>{store.name}</span>
                      <span className={styles.resultMeta}>{store.note}</span>
                    </span>
                    <span className={styles.spacer} />
                    <ExternalLink size={16} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Sheet>
  )
}
