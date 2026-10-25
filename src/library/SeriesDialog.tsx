import { useId, useMemo, useState, type FormEvent } from 'react'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import fields from '../components/fields.module.css'
import { pluralize } from '../lib/format'
import { api, toAppError } from '../lib/ipc'
import { useLibrary, useLibraryBooks } from '../state/library'
import { showError, useToasts } from '../state/toasts'
import styles from './details.module.css'
import { knownSeries, matchSeries, seriesToSave, suggestSeries } from './names'
import { NameSuggestions } from './NameSuggestions'

/**
 * Puts several books in one series, numbered in the order they're shown if the reader wants, or
 * takes them out of their series when the name is left empty.
 */
export function SeriesDialog({
  fingerprints,
  onSaved,
  onClose,
}: {
  /** In the order they're shown. */
  fingerprints: string[]
  onSaved: () => void
  onClose: () => void
}) {
  const books = useLibraryBooks()
  const chosen = useMemo(
    () => books.filter((b) => fingerprints.includes(b.fingerprint)),
    [books, fingerprints],
  )
  // The chosen books don't count: they're the ones being numbered.
  const known = useMemo(
    () =>
      knownSeries(books.filter((b) => !fingerprints.includes(b.fingerprint)).map((b) => b.entry)),
    [books, fingerprints],
  )
  const [name, setName] = useState(() => {
    const names = new Set(chosen.map((b) => b.entry.series ?? ''))
    const [only] = names
    return names.size === 1 && only ? only : ''
  })
  const [numbered, setNumbered] = useState(false)
  const [saving, setSaving] = useState(false)
  const id = useId()
  const series = seriesToSave(name, known)
  const start = matchSeries(name, known)?.next ?? 1
  const count = fingerprints.length

  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    if (saving) return
    setSaving(true)
    const { putBook } = useLibrary.getState()
    const results = await Promise.allSettled(
      fingerprints.map((fp, i) =>
        api
          .setBookDetails(
            fp,
            series
              ? { series, ...(numbered ? { seriesIndex: start + i } : {}) }
              : { series: null, seriesIndex: null },
          )
          .then(putBook),
      ),
    )
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failed) {
      showError(`Couldn’t change the series: ${toAppError(failed.reason).message}`)
      setSaving(false)
      return
    }
    onClose()
    onSaved()
    useToasts.getState().show({
      message: series
        ? `Put ${pluralize(count, 'book')} in “${series}”`
        : `Took ${pluralize(count, 'book')} out of their series`,
    })
  }

  return (
    <Dialog
      title={`Put ${pluralize(count, 'book')} in a series`}
      description="Leave the name empty to take them out of their series."
      onClose={onClose}
      actions={
        <>
          <Button variant="quiet" size="small" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="small" disabled={saving} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <form className={styles.form} onSubmit={(e) => void save(e)} style={{ marginTop: 16 }}>
        <div>
          <label className="visually-hidden" htmlFor={`${id}-series`}>
            Series
          </label>
          <input
            id={`${id}-series`}
            className={fields.textInput}
            value={name}
            maxLength={200}
            placeholder="Series"
            onChange={(e) => setName(e.target.value)}
          />
          <NameSuggestions
            label="Series in your library"
            names={suggestSeries(name, known).map((s) => s.name)}
            onPick={setName}
          />
        </div>
        {series && (
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={numbered}
              onChange={(e) => setNumbered(e.target.checked)}
            />
            {count > 1
              ? `Number them ${start} to ${start + count - 1}, in the order shown`
              : `Number it ${start}`}
          </label>
        )}
      </form>
    </Dialog>
  )
}
