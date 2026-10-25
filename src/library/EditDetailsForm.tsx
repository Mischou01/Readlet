import { Globe, ImagePlus } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '../components/Button'
import { Cover } from '../components/Cover'
import { FieldLabel } from '../components/Fields'
import fields from '../components/fields.module.css'
import { Sheet } from '../components/Sheet'
import { api, toAppError } from '../lib/ipc'
import { bookAuthors, bookTitle } from '../lib/text'
import type { BookDetailsPatch, BookEntry } from '../lib/types'
import { openLibraryCover } from '../lib/urls'
import { useLibrary } from '../state/library'
import { showError, useToasts } from '../state/toasts'
import { detailsForm, detailsPatch, parseSeriesIndex, type DetailsForm } from './details'
import styles from './details.module.css'
import { FindDetails } from './FindDetails'

/** A cover chosen in the form, saved with the rest of it. */
type PendingCover =
  | { kind: 'file'; bytes: Uint8Array; preview: string }
  | { kind: 'online'; id: number }
  | { kind: 'none' }

/** Puts back edits a reset removed: the values the edited fields had. The cover isn't among
 * them: its file stays, but the record no longer points at it. */
function editsOf(entry: BookEntry): BookDetailsPatch {
  return Object.fromEntries(
    entry.edited
      .filter((field) => field !== 'cover')
      .map((field) => [field, entry[field as keyof BookEntry] ?? null]),
  )
}

function saveCover(fingerprint: string, cover: PendingCover): Promise<BookEntry> {
  switch (cover.kind) {
    case 'file':
      return api.chooseBookCover(fingerprint, cover.bytes)
    case 'online':
      return api.chooseBookCoverOnline(fingerprint, cover.id)
    case 'none':
      return api.chooseBookCover(fingerprint, new Uint8Array())
  }
}

/**
 * The book's details as a form, with a page for finding them online. Only what's changed here is
 * saved, and only into the reading data in `.readlet/` (so it syncs); the book's file is never
 * touched.
 */
export function EditDetails({ entry, onDone }: { entry: BookEntry; onDone: () => void }) {
  const [initial] = useState(() => detailsForm(entry))
  const [form, setForm] = useState(initial)
  const [cover, setCover] = useState<PendingCover | null>(null)
  const [finding, setFinding] = useState(false)
  const [saving, setSaving] = useState(false)
  const id = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const indexInvalid = Number.isNaN(parseSeriesIndex(form.seriesIndex))
  const patch = detailsPatch(initial, form)
  const dirty = Object.keys(patch).length > 0 || cover !== null

  useEffect(
    () => () => {
      if (cover?.kind === 'file') URL.revokeObjectURL(cover.preview)
    },
    [cover],
  )

  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    if (indexInvalid || saving) return
    if (!dirty) return onDone()
    setSaving(true)
    try {
      const { putBook } = useLibrary.getState()
      if (Object.keys(patch).length) putBook(await api.setBookDetails(entry.fingerprint, patch))
      if (cover) putBook(await saveCover(entry.fingerprint, cover))
      onDone()
    } catch (err) {
      showError(`Couldn’t save the details: ${toAppError(err).message}`)
      setSaving(false)
    }
  }

  const reset = async () => {
    const edits = editsOf(entry)
    try {
      const { putBook } = useLibrary.getState()
      putBook(await api.resetBookDetails(entry.fingerprint))
      onDone()
      useToasts.getState().show({
        message: 'Back to the book’s own details',
        action: {
          label: 'Undo',
          run: () =>
            void api
              .setBookDetails(entry.fingerprint, edits)
              .then(putBook, (err: unknown) => showError(toAppError(err).message)),
        },
      })
    } catch (err) {
      showError(`Couldn’t reset the details: ${toAppError(err).message}`)
    }
  }

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    setCover({ kind: 'file', bytes, preview: URL.createObjectURL(file) })
  }

  const field = (
    name: keyof DetailsForm,
    label: string,
    options: {
      multiline?: boolean
      hint?: ReactNode
      inputMode?: 'decimal'
      invalid?: boolean
    } = {},
  ) => {
    const Control = options.multiline ? 'textarea' : 'input'
    return (
      <div>
        <FieldLabel id={`${id}-${name}`}>{label}</FieldLabel>
        <Control
          className={
            options.multiline
              ? `${fields.textArea} ${name === 'authors' ? styles.short : ''}`
              : fields.textInput
          }
          aria-labelledby={`${id}-${name}`}
          aria-describedby={options.hint ? `${id}-${name}-hint` : undefined}
          aria-invalid={options.invalid || undefined}
          inputMode={options.inputMode}
          rows={options.multiline ? (name === 'authors' ? 2 : 6) : undefined}
          value={form[name]}
          onChange={(e) => setForm((f) => ({ ...f, [name]: e.target.value }))}
        />
        {options.hint && (
          <p className={styles.hint} id={`${id}-${name}-hint`}>
            {options.hint}
          </p>
        )}
      </div>
    )
  }

  const preview =
    cover?.kind === 'file'
      ? cover.preview
      : cover?.kind === 'online'
        ? openLibraryCover(cover.id)
        : undefined
  const showsCover = cover ? cover.kind !== 'none' : entry.coverVersion != null

  return (
    <Sheet
      title={finding ? 'Find details online' : 'Edit details'}
      onClose={finding ? () => setFinding(false) : onDone}
      style={{ top: 82 }}
    >
      {finding ? (
        <FindDetails
          entry={entry}
          form={form}
          hasCover={showsCover}
          onUse={(values, coverId) => {
            setForm((f) => ({ ...f, ...values }))
            if (coverId != null) setCover({ kind: 'online', id: coverId })
            setFinding(false)
          }}
        />
      ) : (
        <form className={styles.form} onSubmit={(e) => void save(e)}>
          <div className={styles.coverRow}>
            <Cover
              key={preview ?? cover?.kind ?? 'own'}
              entry={cover?.kind === 'none' ? { ...entry, coverVersion: null } : entry}
              title={form.title.trim() || bookTitle(entry)}
              authors={bookAuthors(entry)}
              width={76}
              src={preview}
            />
            <div className={styles.coverButtons}>
              <Button
                size="small"
                icon={<ImagePlus size={16} strokeWidth={1.8} aria-hidden="true" />}
                onClick={() => fileInput.current?.click()}
              >
                Choose a cover…
              </Button>
              {showsCover && (
                <Button size="small" variant="quiet" onClick={() => setCover({ kind: 'none' })}>
                  No cover
                </Button>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  void pickFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </div>
          </div>
          <div>
            <Button
              size="small"
              icon={<Globe size={16} strokeWidth={1.8} aria-hidden="true" />}
              onClick={() => setFinding(true)}
            >
              Find details online
            </Button>
            <p className={styles.hint}>Looks the book up on Open Library.</p>
          </div>
          {field('title', 'Title')}
          {field('authors', 'Authors', { multiline: true, hint: 'One per line' })}
          <div className={styles.pair}>
            {field('series', 'Series')}
            {field('seriesIndex', 'Number', { inputMode: 'decimal', invalid: indexInvalid })}
          </div>
          {field('description', 'Description', { multiline: true })}
          <div className={styles.pair}>
            {field('publisher', 'Publisher')}
            {field('published', 'Published')}
          </div>
          <div className={styles.pair}>
            {field('identifier', 'ISBN or identifier')}
            {field('language', 'Language', { hint: 'A code, like en or fr' })}
          </div>
          <p className={styles.hint}>
            Your changes sync with your books folder. The book’s file stays as it is.
          </p>
          <div className={styles.formActions}>
            {entry.edited.length > 0 && (
              <Button size="small" variant="quiet" onClick={() => void reset()}>
                Use the book’s own details
              </Button>
            )}
            <span className={styles.spacer} />
            <Button size="small" variant="quiet" onClick={onDone}>
              Cancel
            </Button>
            <Button size="small" variant="primary" type="submit" disabled={indexInvalid || saving}>
              Save
            </Button>
          </div>
        </form>
      )}
    </Sheet>
  )
}
