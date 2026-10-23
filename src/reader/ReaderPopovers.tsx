import { AudioLines, BookOpen, Copy, PencilLine, Trash2, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import fieldStyles from '../components/fields.module.css'
import { Popover } from '../components/Popover'
import { cleanWord, lookUp, wiktionaryPage, type DefinitionGroup } from '../lib/dictionary'
import { HIGHLIGHTS } from '../lib/highlightColors'
import { HIGHLIGHT_COLORS, type Annotation, type HighlightColor } from '../lib/types'
import { usePreferences } from '../state/preferences'
import styles from './reader.module.css'

function Swatches({
  current,
  onPick,
}: {
  current?: string
  onPick: (color: HighlightColor) => void
}) {
  return (
    <>
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={styles.swatch}
          aria-label={`Highlight in ${HIGHLIGHTS[c].label.toLowerCase()}`}
          aria-pressed={current === undefined ? undefined : current === c}
          onClick={() => onPick(c)}
        >
          <span style={{ background: HIGHLIGHTS[c].hex }} />
        </button>
      ))}
    </>
  )
}

interface SelectionBarProps {
  anchor: DOMRect
  canDefine: boolean
  onHighlight: (color: HighlightColor) => void
  onNote: () => void
  onDefine: () => void
  onCopy: () => void
  onReadSelection: () => void
  onReadFromHere: () => void
  onClose: () => void
}

/** The toolbar over a text selection (Reader mockup). */
export function SelectionBar(props: SelectionBarProps) {
  return (
    <Popover
      anchor={props.anchor}
      label="Selection"
      role="toolbar"
      onClose={props.onClose}
      persistent
    >
      <div className={styles.selectionBar}>
        <Swatches onPick={props.onHighlight} />
        <span className={styles.barDivider} aria-hidden="true" />
        <button type="button" className={styles.barButton} onClick={props.onNote}>
          <PencilLine size={16} strokeWidth={1.8} aria-hidden="true" />
          Note
        </button>
        {props.canDefine && (
          <button type="button" className={styles.barButton} onClick={props.onDefine}>
            <BookOpen size={16} strokeWidth={1.8} aria-hidden="true" />
            Define
          </button>
        )}
        <button type="button" className={styles.barButton} onClick={props.onCopy}>
          <Copy size={16} strokeWidth={1.8} aria-hidden="true" />
          Copy
        </button>
        <button
          type="button"
          className={styles.barButton}
          title="Read the selected text aloud, then stop"
          onClick={props.onReadSelection}
        >
          <Volume2 size={16} strokeWidth={1.8} aria-hidden="true" />
          Read this
        </button>
        <button
          type="button"
          className={styles.barButton}
          title="Keep reading aloud from here on"
          onClick={props.onReadFromHere}
        >
          <AudioLines size={16} strokeWidth={1.8} aria-hidden="true" />
          Read from here
        </button>
      </div>
    </Popover>
  )
}

interface HighlightBarProps {
  anchor: DOMRect
  annotation: Annotation
  onColor: (color: HighlightColor) => void
  onNote: () => void
  onCopy: () => void
  onDelete: () => void
  onClose: () => void
}

/** Shown when an existing highlight is clicked. */
export function HighlightBar(props: HighlightBarProps) {
  return (
    <Popover anchor={props.anchor} label="Highlight" role="toolbar" onClose={props.onClose}>
      <div className={styles.selectionBar}>
        <Swatches current={props.annotation.color} onPick={props.onColor} />
        <span className={styles.barDivider} aria-hidden="true" />
        <button type="button" className={styles.barButton} onClick={props.onNote}>
          <PencilLine size={16} strokeWidth={1.8} aria-hidden="true" />
          {props.annotation.note ? 'Edit note' : 'Note'}
        </button>
        <button type="button" className={styles.barButton} onClick={props.onCopy}>
          <Copy size={16} strokeWidth={1.8} aria-hidden="true" />
          Copy
        </button>
        <button type="button" className={styles.barButton} onClick={props.onDelete}>
          <Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />
          Remove
        </button>
      </div>
    </Popover>
  )
}

/** A highlight's note, shown while the pointer is over the highlight. */
export function NotePreview({
  anchor,
  note,
  onClose,
}: {
  anchor: DOMRect
  note: string
  onClose: () => void
}) {
  return (
    <Popover
      anchor={anchor}
      label="Note"
      role="tooltip"
      persistent
      onClose={onClose}
      style={{ pointerEvents: 'none' }}
    >
      <div className={styles.notePreview}>
        <PencilLine size={14} strokeWidth={1.8} aria-hidden="true" />
        <p>{note}</p>
      </div>
    </Popover>
  )
}

interface NoteDialogProps {
  quote: string
  initial: string
  onSave: (note: string) => void
  onClose: () => void
}

export function NoteDialog({ quote, initial, onSave, onClose }: NoteDialogProps) {
  const [note, setNote] = useState(initial)
  return (
    <Dialog
      title={initial ? 'Edit note' : 'Add a note'}
      onClose={onClose}
      actions={
        <>
          <Button variant="quiet" size="small" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="small" onClick={() => onSave(note.trim())}>
            Save
          </Button>
        </>
      }
    >
      <p className={styles.quote}>{quote}</p>
      <label className="visually-hidden" htmlFor="note-text">
        Note
      </label>
      <textarea
        id="note-text"
        className={fieldStyles.textArea}
        style={{ marginTop: 14 }}
        value={note}
        maxLength={20_000}
        placeholder="What does this make you think of?"
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSave(note.trim())
        }}
      />
    </Dialog>
  )
}

interface BookmarkNameDialogProps {
  /** The passage the bookmark is on, as a reminder of where it is. */
  passage: string
  initial: string
  /** Offered when there's no name yet (the chapter's), selected so typing replaces it. */
  suggestion?: string
  onSave: (name: string) => void
  onClose: () => void
}

/** Names or renames a bookmark. Saving an empty name clears it. */
export function BookmarkNameDialog({
  passage,
  initial,
  suggestion,
  onSave,
  onClose,
}: BookmarkNameDialogProps) {
  const [name, setName] = useState(initial || suggestion || '')
  return (
    <Dialog
      title={initial ? 'Rename bookmark' : 'Name this bookmark'}
      onClose={onClose}
      actions={
        <>
          <Button variant="quiet" size="small" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="small" onClick={() => onSave(name.trim())}>
            Save
          </Button>
        </>
      }
    >
      {passage && <p className={styles.quote}>{passage}</p>}
      <label className="visually-hidden" htmlFor="bookmark-name">
        Bookmark name
      </label>
      <input
        id="bookmark-name"
        className={fieldStyles.textInput}
        style={{ marginTop: 14 }}
        value={name}
        maxLength={200}
        placeholder="Bookmark name"
        autoComplete="off"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onSave(name.trim())
          }
        }}
      />
    </Dialog>
  )
}

interface DefinitionPopoverProps {
  anchor: DOMRect
  selection: string
  language: string | null
  onOpenExternal: (url: string) => void
  onClose: () => void
}

type LookupState =
  | { status: 'ask' }
  | { status: 'loading' }
  | { status: 'done'; groups: DefinitionGroup[] }
  | { status: 'error'; message: string }

/** Wiktionary definitions. The first lookup asks before anything leaves the computer. */
export function DefinitionPopover({
  anchor,
  selection,
  language,
  onOpenExternal,
  onClose,
}: DefinitionPopoverProps) {
  const word = cleanWord(selection)
  const allowed = usePreferences((s) => s.prefs.onlineDictionary)
  const update = usePreferences((s) => s.update)
  const [state, setState] = useState<LookupState>(() =>
    allowed ? { status: 'loading' } : { status: 'ask' },
  )
  const started = useRef(false)

  useEffect(() => {
    if (state.status !== 'loading' || started.current) return
    started.current = true
    const controller = new AbortController()
    lookUp(word, language, controller.signal).then(
      (groups) => setState({ status: 'done', groups }),
      (e: unknown) => {
        if (!controller.signal.aborted) {
          setState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
        }
      },
    )
    return () => controller.abort()
  }, [state.status, word, language])

  return (
    <Popover anchor={anchor} placement="below" label={`Definition of ${word}`} onClose={onClose}>
      <div className={styles.panel}>
        <h2>{word}</h2>
        {state.status === 'ask' && (
          <>
            <p style={{ marginTop: 8 }}>
              Look this word up on Wiktionary? Readlet will send “{word}” to Wikimedia. Nothing else
              leaves your computer.
            </p>
            <div className={styles.panelActions}>
              <Button variant="quiet" size="small" onClick={onClose}>
                Not now
              </Button>
              <Button size="small" onClick={() => setState({ status: 'loading' })}>
                Just this once
              </Button>
              <Button
                variant="primary"
                size="small"
                onClick={() => {
                  update({ onlineDictionary: true })
                  setState({ status: 'loading' })
                }}
              >
                Always look up
              </Button>
            </div>
          </>
        )}
        {state.status === 'loading' && (
          <p style={{ marginTop: 8, color: 'var(--haze)' }}>Looking it up…</p>
        )}
        {state.status === 'error' && (
          <p style={{ marginTop: 8, color: 'var(--haze)' }}>
            Couldn’t reach Wiktionary ({state.message}). Check your connection and try again.
          </p>
        )}
        {state.status === 'done' &&
          (state.groups.length ? (
            state.groups.map((g, i) => (
              <div key={i} className={styles.definitionGroup}>
                {g.partOfSpeech && <h3>{g.partOfSpeech}</h3>}
                <ol>
                  {g.definitions.map((d, j) => (
                    <li key={j} data-selectable>
                      {d}
                    </li>
                  ))}
                </ol>
              </div>
            ))
          ) : (
            <p style={{ marginTop: 8, color: 'var(--haze)' }}>
              Wiktionary has no entry for this word.
            </p>
          ))}
        {state.status !== 'ask' && (
          <div className={styles.panelActions}>
            <Button
              variant="quiet"
              size="small"
              onClick={() => onOpenExternal(wiktionaryPage(word))}
            >
              Open in Wiktionary
            </Button>
          </div>
        )}
      </div>
    </Popover>
  )
}

/** A footnote rendered by foliate-js in its own small view. */
export function FootnotePopover({
  anchor,
  element,
  onClose,
}: {
  anchor: DOMRect
  element: HTMLElement
  onClose: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = host.current
    if (!el) return
    el.replaceChildren(element)
    return () => el.replaceChildren()
  }, [element])
  return (
    <Popover anchor={anchor} placement="below" label="Footnote" onClose={onClose}>
      <div ref={host} className={styles.footnote} />
    </Popover>
  )
}
