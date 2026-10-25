import { openUrl } from '@tauri-apps/plugin-opener'
import { Cloud, ExternalLink, RefreshCw } from 'lucide-react'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { Button } from '../components/Button'
import { FieldLabel } from '../components/Fields'
import fields from '../components/fields.module.css'
import { formatSince } from '../lib/format'
import { api, toAppError } from '../lib/ipc'
import { useApp } from '../state/app'
import { useSync } from '../state/sync'
import { showError, useToasts } from '../state/toasts'
import styles from './settings.module.css'

/** Where Infomaniak's Manager lists API tokens (src-tauri/src/sync/kdrive.rs). */
const TOKEN_PAGE = 'https://manager.infomaniak.com/v3/ng/accounts/token/list'

/**
 * Syncing reading data through kDrive: connecting it, how it's going, and this device's name,
 * which the others show ("Picked up where Pixel 8 left off").
 */
export function SyncSection() {
  const status = useSync((s) => s.status)
  const [connecting, setConnecting] = useState(false)
  const now = useNow(30_000)

  const disconnect = async () => {
    try {
      useSync.getState().set(await api.disconnectSync())
      useToasts.getState().show({
        message: 'Sync is off. Your reading data stays in kDrive and on this device.',
      })
    } catch (e) {
      showError(`Couldn’t turn sync off: ${toAppError(e).message}`)
    }
  }

  const syncNow = async () => {
    try {
      useSync.getState().set(await api.syncNow())
    } catch (e) {
      showError(toAppError(e).message)
    }
  }

  const connected = status?.service != null
  return (
    <section>
      <FieldLabel>Sync</FieldLabel>
      {connected && !connecting ? (
        <>
          <p className={styles.path}>
            {status.service} › {status.folder}
          </p>
          <p className={styles.hint} role={status.error ? 'alert' : 'status'}>
            {status.syncing
              ? 'Syncing…'
              : (status.error ??
                (status.lastSyncedAt
                  ? `Last synced ${formatSince(status.lastSyncedAt, now)}`
                  : 'Not synced yet'))}
          </p>
          <div className={styles.row}>
            {status.needsReconnect ? (
              <Button size="small" variant="primary" onClick={() => setConnecting(true)}>
                Connect again…
              </Button>
            ) : (
              <Button
                size="small"
                icon={<RefreshCw size={16} strokeWidth={1.8} aria-hidden="true" />}
                disabled={status.syncing}
                onClick={() => void syncNow()}
              >
                Sync now
              </Button>
            )}
            <Button size="small" variant="quiet" onClick={() => void disconnect()}>
              Turn off
            </Button>
          </div>
        </>
      ) : connecting ? (
        <ConnectKDrive onDone={() => setConnecting(false)} />
      ) : (
        <>
          <p className={styles.hint}>
            Keep your place, highlights, notes and reading time the same on all your devices,
            through a folder in your kDrive. Only reading data is sent: your books stay where they
            are.
          </p>
          <div className={styles.row}>
            <Button
              size="small"
              icon={<Cloud size={16} strokeWidth={1.8} aria-hidden="true" />}
              onClick={() => setConnecting(true)}
            >
              Connect kDrive…
            </Button>
          </div>
        </>
      )}
      <DeviceName />
    </section>
  )
}

/** The current time, ticking every `ms` while mounted, for "5 min ago". */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [ms])
  return now
}

function ConnectKDrive({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState('')
  const [drive, setDrive] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = useId()

  const connect = async (e: FormEvent) => {
    e.preventDefault()
    if (!token.trim() || !drive.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      useSync.getState().set(await api.connectKDrive(token, drive))
      onDone()
      useToasts.getState().show({ message: 'Connected. Your reading data is syncing.' })
    } catch (err) {
      setError(toAppError(err).message)
      setBusy(false)
    }
  }

  return (
    <form className={styles.connect} onSubmit={(e) => void connect(e)}>
      <ol className={styles.steps}>
        <li>
          In Infomaniak’s Manager, make an API token with the “drive” scope (Profile › Developer ›
          API tokens).{' '}
          <button
            type="button"
            className={styles.link}
            onClick={() =>
              void openUrl(TOKEN_PAGE).catch((e: unknown) => showError(toAppError(e).message))
            }
          >
            Open the token page
            <ExternalLink size={13} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </li>
        <li>
          <label htmlFor={`${id}-token`}>Paste the token here:</label>
          <input
            id={`${id}-token`}
            className={fields.textInput}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </li>
        <li>
          <label htmlFor={`${id}-drive`}>
            Open kDrive in the browser and paste its address, or type the drive’s number:
          </label>
          <input
            id={`${id}-drive`}
            className={fields.textInput}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://ksuite.infomaniak.com/kdrive/app/drive/123456"
            value={drive}
            onChange={(e) => setDrive(e.target.value)}
          />
        </li>
      </ol>
      <p className={styles.hint}>
        Readlet makes a “Readlet” folder in your private kDrive folder. The token stays in this
        device’s keyring.
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.row}>
        <Button size="small" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="small"
          variant="primary"
          type="submit"
          disabled={busy || !token.trim() || !drive.trim()}
        >
          {busy ? 'Connecting…' : 'Connect'}
        </Button>
      </div>
    </form>
  )
}

/** This device's name, as the others show it. */
function DeviceName() {
  const name = useApp((s) => s.info?.deviceName ?? '')
  const [editing, setEditing] = useState<string | null>(null)
  const id = useId()

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (editing === null || !editing.trim()) return
    try {
      useApp.getState().setInfo(await api.setDeviceName(editing))
      setEditing(null)
    } catch (err) {
      showError(toAppError(err).message)
    }
  }

  if (editing !== null) {
    return (
      <form className={styles.inline} onSubmit={(e) => void save(e)}>
        <label className="visually-hidden" htmlFor={`${id}-name`}>
          This device’s name
        </label>
        <input
          id={`${id}-name`}
          className={fields.textInput}
          value={editing}
          maxLength={60}
          autoFocus
          onChange={(e) => setEditing(e.target.value)}
          onKeyDown={(e) => {
            // Leaves the name as it was, rather than closing the settings.
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              setEditing(null)
            }
          }}
        />
        <Button size="small" variant="primary" type="submit" disabled={!editing.trim()}>
          Save
        </Button>
      </form>
    )
  }
  return (
    <p className={styles.hint}>
      Your other devices call this one <strong>{name}</strong>.{' '}
      <button type="button" className={styles.link} onClick={() => setEditing(name)}>
        Rename
      </button>
    </p>
  )
}
