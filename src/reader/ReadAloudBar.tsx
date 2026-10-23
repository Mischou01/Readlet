import { ChevronDown, Moon, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react'
import { Cover } from '../components/Cover'
import { MenuButton, type MenuEntry } from '../components/Menu'
import { formatTimeLeft } from '../lib/format'
import { bookAuthors } from '../lib/text'
import type { BookEntry } from '../lib/types'
import styles from './readAloud.module.css'
import type { ReadAloud, SleepTimer } from './useReadAloud'

const SLEEP_LABELS: Record<string, string> = {
  off: 'No sleep timer',
  '15': '15 minutes',
  '30': '30 minutes',
  chapter: 'End of chapter',
}

function sleepLabel(sleep: SleepTimer): string {
  return SLEEP_LABELS[String(sleep)] ?? 'No sleep timer'
}

/** For the narrow bar on phones. */
const SHORT_SLEEP_LABELS: Record<string, string> = {
  off: 'Timer',
  '15': '15 min',
  '30': '30 min',
  chapter: 'Chapter',
}

interface ReadAloudBarProps {
  readAloud: ReadAloud
  entry: BookEntry
  title: string
  chapter: string | undefined
  minutesLeft: number | null
}

/** "1×", "1.2×", "1.75×". */
function formatSpeed(speed: number): string {
  return `${Number(speed.toFixed(2))}×`
}

/** The read-aloud controls (ReadAloud mockup): chapter, transport, speed, voice and sleep timer. */
export function ReadAloudBar({ readAloud, entry, title, chapter, minutesLeft }: ReadAloudBarProps) {
  const { status, speed, voice, voices } = readAloud
  const lang = (entry.language ?? 'en').split('-')[0]?.toLowerCase() ?? 'en'
  const matching = voices.filter((v) => v.language.toLowerCase().startsWith(lang))
  const voiceItems: MenuEntry[] = [
    {
      id: 'default',
      label: 'Default voice',
      checked: voice === null,
      onSelect: () => readAloud.setVoice(null),
    },
    ...(matching.length ? matching : voices).slice(0, 40).map((v) => ({
      id: v.name,
      label: v.language ? `${v.name} (${v.language})` : v.name,
      checked: v.name === voice,
      onSelect: () => readAloud.setVoice(v.name),
    })),
  ]

  if (status === 'error') {
    return (
      <div className={styles.bar} role="alert">
        <span className={styles.message}>{readAloud.error}</span>
        <button
          type="button"
          className={styles.icon}
          aria-label="Close read-aloud"
          onClick={readAloud.stop}
        >
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    )
  }

  const playing = status === 'playing' || status === 'loading'
  // Speech runs at roughly the speed of careful reading aloud; scale the estimate with the speed.
  const left = minutesLeft != null ? minutesLeft * (1.4 / speed) : null
  return (
    <div className={styles.bar} role="region" aria-label="Read-aloud controls">
      <Cover entry={entry} title={title} authors={bookAuthors(entry)} width={36} />
      <div className={styles.where}>
        <span className={styles.chapter}>{chapter ?? title}</span>
        <span className={styles.left}>{left != null ? formatTimeLeft(left, 'chapter') : ' '}</span>
      </div>
      <div className={styles.transport}>
        <button
          type="button"
          className={styles.icon}
          aria-label="Previous sentence"
          onClick={readAloud.previous}
        >
          <SkipBack size={20} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.play}
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={readAloud.toggle}
        >
          {playing ? (
            <Pause size={20} fill="currentColor" strokeWidth={0} aria-hidden="true" />
          ) : (
            <Play size={20} fill="currentColor" strokeWidth={0} aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className={styles.icon}
          aria-label="Next sentence"
          onClick={readAloud.next}
        >
          <SkipForward size={20} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      <span className={styles.divider} aria-hidden="true" />
      <div className={styles.options}>
        <button
          type="button"
          className={styles.speed}
          aria-label={`Speed ${formatSpeed(speed)}, change speed`}
          onClick={readAloud.cycleSpeed}
        >
          {formatSpeed(speed)}
        </button>
        <MenuButton label="Voice" items={voiceItems} className={styles.text} align="end">
          <span className={styles.avatar} aria-hidden="true">
            {(voice ?? 'D').charAt(0).toUpperCase()}
          </span>
          <span className={styles.voiceName}>{voice ?? 'Default voice'}</span>
          <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
        </MenuButton>
        <button
          type="button"
          className={styles.text}
          aria-label={`Sleep timer: ${sleepLabel(readAloud.sleep)}`}
          onClick={readAloud.cycleSleep}
        >
          <Moon size={17} strokeWidth={1.8} aria-hidden="true" />
          <span className={styles.long}>{sleepLabel(readAloud.sleep)}</span>
          <span className={styles.short} aria-hidden="true">
            {SHORT_SLEEP_LABELS[String(readAloud.sleep)]}
          </span>
        </button>
      </div>
      <button
        type="button"
        className={`${styles.icon} ${styles.close}`}
        aria-label="Stop reading aloud"
        onClick={readAloud.stop}
      >
        <X size={18} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  )
}
