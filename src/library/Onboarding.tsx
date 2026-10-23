import { FolderOpen, FolderLock } from 'lucide-react'
import { AuraField } from '../components/AuraField'
import { Button } from '../components/Button'
import { WindowControls } from '../components/WindowControls'
import { Logo } from '../components/Logo'
import type { ReactNode } from 'react'
import { pickLibraryFolder } from './actions'
import styles from './onboarding.module.css'

interface OnboardingProps {
  /** The configured folder that couldn't be opened. */
  missingFolder?: string | null
  /** Android: Readlet needs "All files access" first. */
  needsAccess?: boolean
  onAllowAccess?: () => void
}

/** First run, a books folder that went missing, or (Android) no permission to read it. */
export function Onboarding({ missingFolder, needsAccess, onAllowAccess }: OnboardingProps) {
  if (needsAccess) {
    return (
      <Frame>
        <h1>Let Readlet see your books</h1>
        <p>
          Readlet reads books straight from a folder on your phone and keeps your progress next to
          them. Android asks you to allow <strong>All files access</strong> for that.
        </p>
        <Button
          variant="primary"
          icon={<FolderLock size={18} strokeWidth={1.8} aria-hidden="true" />}
          onClick={onAllowAccess}
        >
          Allow access
        </Button>
        <p className={styles.note}>
          Readlet only opens your books folder, never sends files anywhere, and doesn’t change your
          books.
        </p>
      </Frame>
    )
  }
  return (
    <Frame>
      return (
      {missingFolder ? (
        <>
          <h1>Your books folder isn’t here</h1>
          <p>
            Readlet can’t find <strong data-selectable>{missingFolder}</strong>. If it’s on a drive
            that isn’t connected, connect it and restart Readlet, or choose another folder.
          </p>
        </>
      ) : (
        <>
          <h1>Welcome to Readlet</h1>
          <p>
            Readlet reads the books you already have, straight from a folder. Nothing is imported or
            moved.
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
    </Frame>
  )
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page} data-tauri-drag-region>
      <AuraField placement="top" />
      <div className={styles.windowControls}>
        <WindowControls divider={false} />
      </div>
      <main className={styles.card}>
        <Logo size={44} />
        {children}
      </main>
    </div>
  )
}
