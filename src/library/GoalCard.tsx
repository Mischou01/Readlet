import { BarChart3, Flame } from 'lucide-react'
import { useMemo } from 'react'
import { ProgressRing } from '../components/Progress'
import { pluralize } from '../lib/format'
import { useToday } from '../lib/hooks'
import { useApp } from '../state/app'
import { readPosition } from '../state/positions'
import { usePreferences } from '../state/preferences'
import { useDailyGoal, useStats } from '../state/stats'
import { currentStreak, dayTotals, minutesOn } from '../stats/stats'
import styles from './library.module.css'
import type { LibraryBook } from './model'

/** Today's minutes against the daily goal, and the current streak. */
export function GoalCard({ current }: { current: LibraryBook | null }) {
  const sessions = useStats((s) => s.sessions)
  const goal = useDailyGoal()
  const bytesPerMinute = usePreferences((s) => s.prefs.bytesPerMinute)
  const navigate = useApp((s) => s.navigate)

  const day = useToday()
  const { today, streak } = useMemo(() => {
    const totals = dayTotals(sessions)
    return { today: Math.floor(minutesOn(totals, day)), streak: currentStreak(totals, day) }
  }, [sessions, day])

  const remaining = Math.max(0, goal - today)
  const chapterMinutes = current
    ? (readPosition(current.fingerprint)?.bytesLeftInSection ?? Infinity) / bytesPerMinute
    : Infinity
  const hint =
    remaining === 0
      ? 'Today’s goal is done'
      : chapterMinutes >= remaining && Number.isFinite(chapterMinutes)
        ? 'One more chapter gets you there'
        : `${pluralize(remaining, 'minute')} to go`

  return (
    <div className={styles.goal}>
      <ProgressRing
        value={today / goal}
        size={48}
        stroke={5}
        label={`${Math.round((today / goal) * 100)} percent of today’s goal`}
      />
      <div className={styles.goalText}>
        <strong>
          {today} of {goal} minutes today
        </strong>
        <span className={styles.muted} style={{ display: 'block' }}>
          {hint}
        </span>
      </div>
      <button type="button" className={styles.streak} onClick={() => navigate({ name: 'stats' })}>
        {streak > 0 ? (
          <>
            <Flame size={16} strokeWidth={1.8} aria-hidden="true" />
            {pluralize(streak, 'day')}
          </>
        ) : (
          <>
            <BarChart3 size={16} strokeWidth={1.8} aria-hidden="true" />
            Stats
          </>
        )}
      </button>
    </div>
  )
}
