import { useState } from 'react'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import floating from '../components/floating.module.css'
import { pluralize } from '../lib/format'
import { isAndroid } from '../lib/platform'
import { bookTitle } from '../lib/text'
import { useApp, type PendingDelete } from '../state/app'
import { useLibrary } from '../state/library'
import { deleteBooks } from './actions'

/**
 * Asks before deleting books. On the desktop they go to the trash; Android has none, so there the
 * dialog says plainly that it can't be undone. Either way the reading data stays.
 */
export function DeleteBooksDialog({ fingerprints, onDeleted }: PendingDelete) {
  const books = useLibrary((s) => s.books)
  const [busy, setBusy] = useState(false)
  const close = () => useApp.getState().confirmDelete(null)
  // Fixed when asked, so the question doesn't change as the books disappear.
  const [present] = useState(() => fingerprints.filter((fp) => books[fp]))
  const only = present.length === 1 ? books[present[0] ?? ''] : undefined
  const title = only
    ? `Delete “${bookTitle(only)}”?`
    : `Delete ${pluralize(present.length, 'book')}?`
  const files = only ? 'The file' : 'The files'
  const description = isAndroid
    ? `${files} will be deleted from your books folder. This can’t be undone.`
    : `${files} will be moved to the trash, where you can restore ${only ? 'it' : 'them'}.`

  return (
    <Dialog
      title={title}
      description={description}
      onClose={close}
      actions={
        <>
          <Button variant="quiet" size="small" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="small"
            disabled={busy || present.length === 0}
            onClick={() => {
              setBusy(true)
              void deleteBooks(present).then((ok) => {
                close()
                if (ok) onDeleted?.()
              })
            }}
          >
            {isAndroid ? 'Delete' : 'Move to trash'}
          </Button>
        </>
      }
    >
      <p className={floating.dialogDescription} style={{ marginTop: 10 }}>
        Your progress, highlights and notes stay, and come back if you add{' '}
        {only ? 'the book' : 'these books'} again. If the folder syncs to your other devices,{' '}
        {only ? 'it’s' : 'they’re'} removed there too.
      </p>
    </Dialog>
  )
}
