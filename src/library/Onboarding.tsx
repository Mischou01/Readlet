import { FolderOpen } from 'lucide-react'
import { AuraField } from '../components/AuraField'
import { Button } from '../components/Button'
import { WindowControls } from '../components/WindowControls'
import { Logo } from '../components/Logo'
import { pickLibraryFolder } from './actions'
import styles from './onboarding.module.css'

/** First run, or the books folder went missing: choose a folder. */
export function Onboarding({ missingFolder }: { missingFolder?: string | null }) {
  return (
    <div className={styles.page} data-tauri-drag-region>
      <AuraField placement="top" />
      <div className={styles.windowControls}>
        <WindowControls />
      </div>
      <main className={styles.card}>
        <Logo size={44} />
        {missingFolder ? (
          <>
            <h1>Your books folder isn’t here</h1>
            <p>
              Readlet can’t find <strong data-selectable>{missingFolder}</strong>. If it’s on a
              drive that isn’t connected, connect it and restart Readlet, or choose another folder.
            </p>
          </>
        ) : (
          <>
            <h1>Welcome to Readlet</h1>
            <p>
              Readlet reads the books you already have, straight from a folder. Nothing is imported
              or moved.
            </p>
          </>
        )}
        <Button
          variant="primary"
          icon={<FolderOpen size={18} strokeWidth={1.8} aria-hidden="true" />}
          onClick={() => void pickLibraryFolder()}
        >
          Choose your books folder
        </Button>
        <p className={styles.note}>
          Your progress, highlights and reading stats are saved in a hidden <code>.readlet</code>{' '}
          folder inside it, so they travel with your books if you sync the folder with Syncthing or
          Nextcloud.
        </p>
      </main>
    </div>
  )
}
