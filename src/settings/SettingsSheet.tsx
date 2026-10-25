import { FolderOpen, RefreshCw } from 'lucide-react'
import { Button } from '../components/Button'
import { FieldLabel, Segmented, Switch } from '../components/Fields'
import { Sheet } from '../components/Sheet'
import { isAndroid } from '../lib/platform'
import { pickLibraryFolder } from '../library/actions'
import { useApp } from '../state/app'
import { useLibrary } from '../state/library'
import {
  SCREEN_ON_MINUTES,
  usePreferences,
  type Appearance,
  type ScreenOnMinutes,
} from '../state/preferences'
import styles from './settings.module.css'
import { SyncSection } from './SyncSection'

const APPEARANCES: { value: Appearance; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const SCREEN_ON_OPTIONS = SCREEN_ON_MINUTES.map((m) => ({
  value: String(m),
  label: m === 0 ? 'System' : `${m} min`,
}))

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
            {bookCount.toLocaleString()} books.{' '}
            {isAndroid
              ? 'Readlet looks for changes whenever you open it.'
              : 'Readlet watches this folder for changes.'}
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
              onClick={() => useLibrary.getState().rescan()}
            >
              Rescan
            </Button>
          </div>
        </section>

        <SyncSection />

        {isAndroid && (
          <section>
            <FieldLabel>Reading</FieldLabel>
            <p className={styles.subhead}>Keep the screen on</p>
            <Segmented
              label="Keep the screen on while reading"
              value={String(prefs.reader.screenOnMinutes)}
              options={SCREEN_ON_OPTIONS}
              onChange={(v) =>
                update({ reader: { screenOnMinutes: Number(v) as ScreenOnMinutes } })
              }
            />
            <p className={styles.hint}>
              {prefs.reader.screenOnMinutes === 0
                ? 'The screen turns off after the phone’s usual timeout.'
                : `The screen stays on until ${prefs.reader.screenOnMinutes} minutes after your last page turn or tap.`}
            </p>
            <Switch
              label="Turn pages with the volume keys"
              hint="Volume down goes forward, volume up goes back. While reading aloud, they change the volume."
              checked={prefs.reader.volumeKeys}
              onChange={(volumeKeys) => update({ reader: { volumeKeys } })}
            />
          </section>
        )}

        <section>
          <FieldLabel>Dictionary</FieldLabel>
          <Switch
            label="Look up words on Wiktionary"
            hint="Sends the word you look up to Wikimedia. Finding a book’s details sends its title, author or ISBN to Open Library, and only when you ask."
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
