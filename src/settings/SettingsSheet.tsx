import { FolderOpen, RefreshCw } from 'lucide-react'
import { Button } from '../components/Button'
import { FieldLabel, Segmented, Switch } from '../components/Fields'
import { Sheet } from '../components/Sheet'
import { api } from '../lib/ipc'
import { pickLibraryFolder } from '../library/actions'
import { useApp } from '../state/app'
import { useLibrary } from '../state/library'
import { usePreferences, type Appearance } from '../state/preferences'
import { useToasts } from '../state/toasts'
import styles from './settings.module.css'

const APPEARANCES: { value: Appearance; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export function SettingsSheet() {
  const info = useApp((s) => s.info)
  const close = () => useApp.getState().setSettingsOpen(false)
  const prefs = usePreferences((s) => s.prefs)
  const update = usePreferences((s) => s.update)
  const bookCount = useLibrary((s) => Object.keys(s.books).length)

  return (
    <Sheet title="Settings" onClose={close} style={{ top: 82 }}>
      <div className={styles.sections}>
        <section>
          <FieldLabel>Appearance</FieldLabel>
          <Segmented
            label="Appearance"
            value={prefs.appearance}
            options={APPEARANCES}
            onChange={(appearance) => update({ appearance })}
          />
          <Switch
            label="Reduce transparency"
            hint="Solid surfaces instead of frosted glass"
            checked={prefs.reduceTransparency}
            onChange={(reduceTransparency) => update({ reduceTransparency })}
          />
        </section>

        <section>
          <FieldLabel>Books folder</FieldLabel>
          <p className={styles.path} data-selectable>
            {info?.libraryRoot}
          </p>
          <p className={styles.hint}>
            {bookCount.toLocaleString()} books. Readlet watches this folder for changes.
          </p>
          <div className={styles.row}>
            <Button
              size="small"
              icon={<FolderOpen size={16} strokeWidth={1.8} aria-hidden="true" />}
              onClick={() => void pickLibraryFolder()}
            >
              Change…
            </Button>
            <Button
              size="small"
              variant="quiet"
              icon={<RefreshCw size={16} strokeWidth={1.8} aria-hidden="true" />}
              onClick={() => {
                useLibrary.getState().setScanning(true)
                void api.rescanLibrary()
                useToasts.getState().show({ message: 'Looking for new books' })
              }}
            >
              Rescan
            </Button>
          </div>
        </section>

        <section>
          <FieldLabel>Dictionary</FieldLabel>
          <Switch
            label="Look up words on Wiktionary"
            hint="Sends the word you look up to Wikimedia. Nothing else leaves this computer."
            checked={prefs.onlineDictionary === true}
            onChange={(onlineDictionary) => update({ onlineDictionary })}
          />
        </section>

        <section className={styles.about}>
          <FieldLabel>About</FieldLabel>
          <p>
            Readlet {info?.version} on {info?.deviceName}. Free software under the GNU GPL, version
            3 or later. Books are rendered by foliate-js.
          </p>
        </section>
      </div>
    </Sheet>
  )
}
