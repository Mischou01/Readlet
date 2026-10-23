import { getCurrentWebview } from '@tauri-apps/api/webview'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Button } from './components/Button'
import { Dialog } from './components/Dialog'
import { Toasts } from './components/Toasts'
import { HighlightsView } from './highlights/HighlightsView'
import { api, events, subscribeAll, toAppError } from './lib/ipc'
import { fitAndroidScreen } from './lib/platform'
import { handleWindowShortcut } from './lib/window'
import { addBookFiles } from './library/actions'
import { indexPendingBooks } from './library/indexer'
import { LibraryView } from './library/LibraryView'
import { Onboarding } from './library/Onboarding'
import { OpeningCoverLayer } from './reader/OpeningCover'
import { ReaderView } from './reader/ReaderView'
import { SettingsSheet } from './settings/SettingsSheet'
import { useApp } from './state/app'
import { useLibrary } from './state/library'
import { useStats } from './state/stats'
import { showError } from './state/toasts'
import { StatsView } from './stats/StatsView'
import { useDocumentTheme } from './theme/aura'
import styles from './App.module.css'

export function App() {
  const status = useApp((s) => s.status)
  const info = useApp((s) => s.info)
  const error = useApp((s) => s.error)
  useDocumentTheme()

  useEffect(() => {
    void useApp.getState().init()
  }, [])

  const platform = info?.platform
  useEffect(() => (platform === 'android' ? fitAndroidScreen() : undefined), [platform])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => void handleWindowShortcut(e)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (status === 'loading') return <div className={styles.splash} />
  if (status === 'error' || !info) {
    return (
      <div className={styles.fatal} role="alert">
        <h1>Readlet couldn’t start</h1>
        <p data-selectable>{error?.message}</p>
      </div>
    )
  }
  if (!info.libraryRoot) {
    return (
      <>
        <Onboarding missingFolder={info.missingLibraryRoot} />
        <Toasts />
      </>
    )
  }
  return <Shell libraryRoot={info.libraryRoot} />
}

/** The app once a library is open: keeps data in step with the core and shows the views. */
function Shell({ libraryRoot }: { libraryRoot: string }) {
  const view = useApp((s) => s.view)
  const settingsOpen = useApp((s) => s.settingsOpen)
  const notice = useApp((s) => s.notice)
  const dropping = useDropToAdd()

  useEffect(() => {
    const library = useLibrary.getState()
    void library.load().then(() => {
      void indexPendingBooks()
      // The scan started at launch may have finished before we subscribed; scan again so the
      // UI hears about it (unchanged files cost nothing).
      library.setScanning(true)
      api.rescanLibrary().catch((e) => {
        library.setScanning(false)
        showError(`Couldn’t read your books folder: ${toAppError(e).message}`)
      })
    })
    void useStats.getState().load()
    return subscribeAll([
      events.onLibraryChanged(async (report) => {
        await useLibrary.getState().scanFinished(report)
        void indexPendingBooks()
      }),
      events.onScanFailed((e) => {
        useLibrary.getState().setScanning(false)
        showError(`Couldn’t read your books folder: ${e.message}`)
      }),
      events.onStoreChanged(async (changes) => {
        try {
          const { refreshRecords, refreshShelves } = useLibrary.getState()
          const stats = useStats.getState()
          await Promise.all([
            changes.books.length ? refreshRecords(changes.books) : null,
            changes.shelves ? refreshShelves() : null,
            changes.sessions ? stats.refreshSessions() : null,
            changes.profile ? stats.refreshProfile() : null,
          ])
        } catch (e) {
          console.warn('reloading synced data failed', toAppError(e))
        }
      }),
    ])
  }, [libraryRoot])

  return (
    <div className={styles.shell}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={view.name === 'reader' ? `reader-${view.fingerprint}` : view.name}
          className={styles.view}
        >
          {view.name === 'library' && <LibraryView />}
          {view.name === 'highlights' && <HighlightsView initialBook={view.book} />}
          {view.name === 'stats' && <StatsView />}
          {view.name === 'reader' && (
            <ReaderView
              fingerprint={view.fingerprint}
              target={view.target}
              readAloud={view.readAloud}
            />
          )}
          {/* Views cross-fade through the background colour. A curtain fades rather than the view
              itself, because frosted glass inside a fading element pops when the fade ends. */}
          <motion.div
            className={styles.curtain}
            aria-hidden="true"
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 1 }}
            transition={{ duration: 0.18 }}
          />
        </motion.div>
      </AnimatePresence>
      <OpeningCoverLayer />
      <AnimatePresence>
        {settingsOpen && view.name !== 'reader' && <SettingsSheet />}
      </AnimatePresence>
      {notice && (
        <Dialog
          title={notice.title}
          description={notice.message}
          onClose={() => useApp.getState().setNotice(null)}
          actions={
            <Button
              variant="primary"
              size="small"
              onClick={() => useApp.getState().setNotice(null)}
            >
              OK
            </Button>
          }
        />
      )}
      {dropping && (
        <div className={styles.drop} aria-hidden="true">
          <div>Drop to add to your library</div>
        </div>
      )}
      <Toasts />
    </div>
  )
}

/** Files dropped anywhere on the window are copied into the library. */
function useDropToAdd(): boolean {
  const [over, setOver] = useState(false)
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let disposed = false
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const { payload } = event
        if (payload.type === 'enter' || payload.type === 'over') setOver(true)
        else if (payload.type === 'leave') setOver(false)
        else if (payload.type === 'drop') {
          setOver(false)
          void addBookFiles(payload.paths)
        }
      })
      .then((fn) => (disposed ? fn() : (unlisten = fn)))
      .catch((e) => console.warn('drag and drop unavailable', e))
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])
  return over
}
