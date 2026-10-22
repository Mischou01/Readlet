import { SlidersVertical } from 'lucide-react'
import { useMemo, useState, type CSSProperties } from 'react'
import { AppHeader } from '../components/AppHeader'
import { AuraField } from '../components/AuraField'
import { IconButton } from '../components/Button'
import { Cover } from '../components/Cover'
import { dayKey, formatMinutes, pluralize } from '../lib/format'
import { useElementWidth, useToday } from '../lib/hooks'
import type { YearlyGoal } from '../lib/types'
import type { LibraryBook } from '../library/model'
import { useApp } from '../state/app'
import { useLibraryBooks } from '../state/library'
import { useDailyGoal, useStats, useYearlyGoal } from '../state/stats'
import { accentColor, useAuraFor, useColorScheme, type ColorScheme } from '../theme/aura'
import { GoalDialog } from './GoalDialog'
import {
  averageMinutesPerReadingDay,
  currentStreak,
  dayTotals,
  favouriteTimeOfDay,
  inYear,
  longestStreak,
  readingDays,
  topBooks,
  totalMinutes,
  weekDays,
  wordsPerMinute,
  yearCalendar,
  type BookShare,
  type CalendarDay,
  type DayTotal,
} from './stats'
import styles from './stats.module.css'

const MONTHS = Array.from({ length: 12 }, (_, m) =>
  new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(2026, m, 1)),
)
const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const fullDay = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
})

/** Organic pebble outlines, picked per day so the calendar doesn't look like a grid of dots. */
const PEBBLES = [
  '46% 54% 50% 50% / 52% 48% 52% 48%',
  '52% 48% 46% 54% / 48% 54% 46% 52%',
  '50% 50% 54% 46% / 46% 52% 48% 54%',
  '48% 52% 52% 48% / 54% 46% 50% 50%',
]
/** Books named in the legend and the per-book list; the rest are grouped. */
const NAMED_BOOKS = 4

/** Calendar cells shrink to fit the year on narrower windows, down to this size. */
const MAX_CELL = 22
const MIN_CELL = 12
const CELL_GAP = 2
const LABEL_WIDTH = 40

/** Pebbles grow with the minutes read, up to an hour and a half. */
function pebbleSize(minutes: number, cell: number): number {
  return Math.round((7 + 13 * Math.sqrt(Math.min(minutes, 90) / 90)) * (cell / MAX_CELL))
}

function hoursPhrase(minutes: number): string {
  if (minutes < 120) return pluralize(Math.round(minutes), 'minute')
  return pluralize(Math.round(minutes / 60), 'hour')
}

function headline(minutes: number, goal: YearlyGoal, finished: number): string {
  if (minutes < 1 && finished === 0) return 'Your reading year starts with the next page.'
  const time = `You’ve read for ${hoursPhrase(minutes)} this year`
  if (goal.unit === 'books') {
    return `${time} and finished ${finished} of the ${pluralize(goal.target, 'book')} you set out to read.`
  }
  const share = Math.round((minutes / goal.target) * 100)
  return `${time}, ${share}% of the ${hoursPhrase(goal.target)} you set out to read.`
}

export function StatsView() {
  const sessions = useStats((s) => s.sessions)
  const loaded = useStats((s) => s.loaded)
  const dailyGoal = useDailyGoal()
  const yearlyGoal = useYearlyGoal()
  const books = useLibraryBooks()
  const scheme = useColorScheme()
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const today = useToday()
  const year = today.getFullYear()
  const [goalOpen, setGoalOpen] = useState(false)

  const byFingerprint = useMemo(
    () => new Map(books.map((b) => [b.fingerprint, b] as const)),
    [books],
  )
  const stats = useMemo(() => {
    const thisYear = inYear(sessions, year)
    const lastYear = inYear(sessions, year - 1)
    const totals = dayTotals(sessions)
    return {
      totals,
      minutes: totalMinutes(thisYear),
      streak: currentStreak(totals, today),
      longest: longestStreak(totals, year, today),
      wpm: wordsPerMinute(thisYear),
      wpmLastYear: wordsPerMinute(lastYear),
      average: averageMinutesPerReadingDay(totals, year),
      days: readingDays(totals, year),
      favourite: favouriteTimeOfDay(thisYear),
      shares: topBooks(thisYear, NAMED_BOOKS),
      calendar: yearCalendar(totals, year, today),
    }
  }, [sessions, year, today])
  const finished = books.filter(
    (b) => b.status === 'finished' && new Date(b.statusAt).getFullYear() === year,
  ).length

  /** The book the calendar highlights; defaults to the one read most recently. */
  const [picked, setPicked] = useState<string | 'all' | null>(null)
  const recent = useMemo(() => {
    const latest = [...sessions].sort((a, b) => b.end - a.end)[0]
    return latest && stats.shares.some((s) => s.book === latest.book) ? latest.book : 'all'
  }, [sessions, stats.shares])
  const focus = picked ?? recent
  const focusBook = focus === 'all' ? null : (byFingerprint.get(focus) ?? null)
  useAuraFor(focusBook?.entry.palette)

  const goalValue = yearlyGoal.unit === 'books' ? finished : stats.minutes
  const goalLabel =
    yearlyGoal.unit === 'books'
      ? `of ${pluralize(yearlyGoal.target, 'book')}`
      : `of ${formatMinutes(yearlyGoal.target)}`

  const actions = (
    <IconButton glass label="Settings" onClick={() => setSettingsOpen(true)}>
      <SlidersVertical size={19} strokeWidth={1.8} aria-hidden="true" />
    </IconButton>
  )

  return (
    <div className={styles.page}>
      <AuraField placement="top" />
      <AppHeader section="stats" actions={actions} />
      <main className={styles.main}>
        <section aria-label="Summary" className={styles.summary}>
          <div className={styles.summaryText}>
            <p className={styles.eyebrow}>{year} so far</p>
            <h1 className={styles.headline}>
              {loaded ? headline(stats.minutes, yearlyGoal, finished) : ' '}
            </h1>
            <div className={styles.figures}>
              <div>
                <div className={styles.pebbleRow} aria-hidden="true">
                  {stats.streak === 0 ? (
                    <span className={styles.pebble} data-off="" />
                  ) : (
                    Array.from({ length: Math.min(stats.streak, 14) }, (_, i) => (
                      <span
                        key={i}
                        className={styles.pebble}
                        style={{ borderRadius: PEBBLES[i % PEBBLES.length] }}
                      />
                    ))
                  )}
                </div>
                <div className={styles.figureLabel}>
                  {stats.streak > 0 ? `${stats.streak}-day streak` : 'No streak right now'}
                </div>
                <div className={styles.figureHint}>{streakHint(stats.streak, stats.longest)}</div>
              </div>
              <Figure
                value={stats.wpm ?? '–'}
                label="Words a minute"
                hint={wpmHint(stats.wpm, stats.wpmLastYear)}
              />
              <Figure
                value={stats.average ?? '–'}
                label="Minutes on a reading day"
                hint={
                  stats.favourite
                    ? `Mostly in the ${stats.favourite}`
                    : stats.days
                      ? `Across ${pluralize(stats.days, 'reading day')}`
                      : 'No reading days yet'
                }
              />
            </div>
          </div>
          <GoalRing
            value={goalValue}
            target={yearlyGoal.target}
            label={goalLabel}
            display={yearlyGoal.unit === 'books' ? String(finished) : formatHours(stats.minutes)}
            onChange={() => setGoalOpen(true)}
          />
        </section>

        <YearSection
          year={year}
          stats={stats}
          focus={focus}
          onFocus={setPicked}
          books={byFingerprint}
          scheme={scheme}
        />

        <div className={styles.columns}>
          <WeekSection totals={stats.totals} today={today} goal={dailyGoal} />
          <BooksSection shares={stats.shares} books={byFingerprint} scheme={scheme} />
        </div>
      </main>
      {goalOpen && <GoalDialog onClose={() => setGoalOpen(false)} />}
    </div>
  )
}

function formatHours(minutes: number): string {
  return minutes < 60 ? `${Math.round(minutes)}m` : `${Math.round(minutes / 60)}h`
}

function streakHint(streak: number, longest: number): string {
  if (longest > streak) return `Your longest this year is ${pluralize(longest, 'day')}`
  if (streak > 1) return 'Your longest this year'
  if (streak === 1) return 'Read tomorrow to make it two'
  return 'Read a little every day to start one'
}

function wpmHint(wpm: number | null, lastYear: number | null): string {
  if (wpm == null) return 'Shown after a few sessions'
  if (lastYear == null || Math.abs(wpm - lastYear) < 3) return 'Your pace this year'
  return `${wpm > lastYear ? 'Up' : 'Down'} from ${lastYear} last year`
}

function Figure({ value, label, hint }: { value: number | string; label: string; hint: string }) {
  return (
    <div>
      <div className={styles.figureValue}>{value}</div>
      <div className={styles.figureLabel}>{label}</div>
      <div className={styles.figureHint}>{hint}</div>
    </div>
  )
}

function GoalRing({
  value,
  target,
  label,
  display,
  onChange,
}: {
  value: number
  target: number
  label: string
  display: string
  onChange: () => void
}) {
  const r = 94
  const circumference = 2 * Math.PI * r
  const filled = Math.max(0, Math.min(1, value / target)) * circumference
  return (
    <div className={styles.ring}>
      <svg
        width="220"
        height="220"
        viewBox="0 0 220 220"
        role="img"
        aria-label={`Yearly goal: ${display} ${label}`}
      >
        <circle cx="110" cy="110" r={r} fill="none" stroke="var(--track)" strokeWidth="14" />
        {filled > 0 && (
          <circle
            cx="110"
            cy="110"
            r={r}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference}`}
            transform="rotate(-90 110 110)"
            className={styles.ringFill}
          />
        )}
      </svg>
      <div className={styles.ringText}>
        <span className={styles.ringValue}>{display}</span>
        <span className={styles.ringLabel}>{label}</span>
        <button type="button" className={styles.ringButton} onClick={onChange}>
          Change goal
        </button>
      </div>
    </div>
  )
}

function bookColor(book: LibraryBook | undefined, scheme: ColorScheme): string {
  return book?.entry.palette ? accentColor(book.entry.palette, scheme) : 'var(--haze)'
}

function bookName(fingerprint: string | null, books: Map<string, LibraryBook>): string {
  if (fingerprint === null) return 'Other books'
  return books.get(fingerprint)?.title ?? 'A book no longer in your library'
}

function YearSection({
  year,
  stats,
  focus,
  onFocus,
  books,
  scheme,
}: {
  year: number
  stats: {
    calendar: ReturnType<typeof yearCalendar>
    days: number
    minutes: number
    shares: BookShare[]
  }
  focus: string
  onFocus: (book: string) => void
  books: Map<string, LibraryBook>
  scheme: ColorScheme
}) {
  const named = stats.shares.filter((s): s is BookShare & { book: string } => s.book !== null)
  const legend = [
    { id: 'all', name: 'All books', color: 'var(--haze)' },
    ...named.map((s) => ({
      id: s.book,
      name: bookName(s.book, books),
      color: bookColor(books.get(s.book), scheme),
    })),
  ]
  const focusColor = legend.find((l) => l.id === focus)?.color ?? 'var(--haze)'

  const [measure, width] = useElementWidth<HTMLDivElement>()
  const weeks = stats.calendar.weeks.length
  const fit = Math.floor((width - LABEL_WIDTH) / weeks) - CELL_GAP
  const cell = width ? Math.max(MIN_CELL, Math.min(MAX_CELL, fit)) : MAX_CELL

  const pebble = (day: CalendarDay | null, index: number) => {
    if (!day) return <span key={index} className={styles.cell} />
    const label = fullDay.format(day.date)
    if (day.future || day.minutes < 1) {
      return (
        <span
          key={day.key}
          className={styles.cell}
          data-today={day.today ? '' : undefined}
          title={day.future ? undefined : `${label}: no reading`}
        >
          <span className={styles.dot} data-future={day.future ? '' : undefined} />
        </span>
      )
    }
    const size = pebbleSize(day.minutes, cell)
    const highlighted = focus === 'all' || day.book === focus
    const style: CSSProperties = {
      width: size,
      height: size,
      borderRadius: PEBBLES[day.date.getDate() % PEBBLES.length],
      background: highlighted ? focusColor : undefined,
    }
    return (
      <span
        key={day.key}
        className={styles.cell}
        data-today={day.today ? '' : undefined}
        title={`${label}: ${formatMinutes(day.minutes)}${day.book ? `, ${bookName(day.book, books)}` : ''}`}
      >
        <span
          className={styles.dayPebble}
          data-muted={highlighted ? undefined : ''}
          style={style}
        />
      </span>
    )
  }

  return (
    <section aria-labelledby="year-heading" className={styles.year}>
      <div className={styles.sectionHeader}>
        <h2 id="year-heading" className={styles.sectionTitle}>
          Every day you read
        </h2>
        {named.length > 0 && (
          <div role="radiogroup" aria-label="Show a book" className={styles.legend}>
            {legend.map((l) => (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={l.id === focus}
                className={styles.legendItem}
                onClick={() => onFocus(l.id)}
              >
                <span className={styles.legendPebble} style={{ background: l.color }} />
                <span className={styles.legendName}>{l.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <p className={styles.sectionHint}>
        Each pebble is a day. Bigger pebbles mean more minutes. Hover a pebble to see the day.
      </p>
      <div className={styles.calendarScroll} ref={measure}>
        <div
          ref={scrollToToday}
          role="img"
          aria-label={`Reading days in ${year}: ${pluralize(stats.days, 'day')}, ${hoursPhrase(stats.minutes)} in total`}
          className={styles.calendar}
          style={{ '--cell': `${cell}px` } as CSSProperties}
        >
          {stats.calendar.months.map((m) => (
            <span
              key={m.month}
              className={styles.month}
              style={{ left: LABEL_WIDTH + m.column * (cell + CELL_GAP) }}
              aria-hidden="true"
            >
              {MONTHS[m.month]}
            </span>
          ))}
          <span
            className={styles.weekday}
            style={{ top: 26 + 0 * (cell + CELL_GAP), lineHeight: `${cell}px` }}
            aria-hidden="true"
          >
            {weekdayShort.format(new Date(2026, 0, 5))}
          </span>
          <span
            className={styles.weekday}
            style={{ top: 26 + 2 * (cell + CELL_GAP), lineHeight: `${cell}px` }}
            aria-hidden="true"
          >
            {weekdayShort.format(new Date(2026, 0, 7))}
          </span>
          <span
            className={styles.weekday}
            style={{ top: 26 + 4 * (cell + CELL_GAP), lineHeight: `${cell}px` }}
            aria-hidden="true"
          >
            {weekdayShort.format(new Date(2026, 0, 9))}
          </span>
          {stats.calendar.weeks.map((week, w) => (
            <div key={w} className={styles.week}>
              {week.map(pebble)}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/** Where the year doesn't fit even with small cells, it scrolls; start with today in view. */
function scrollToToday(calendar: HTMLDivElement | null) {
  const scroller = calendar?.parentElement
  const today = calendar?.querySelector<HTMLElement>('[data-today]')
  if (!scroller || !today) return
  scroller.scrollLeft = Math.max(0, today.offsetLeft - scroller.clientWidth + 160)
}

function WeekSection({
  totals,
  today,
  goal,
}: {
  totals: Map<string, DayTotal>
  today: Date
  goal: number
}) {
  const todayKey = today.getTime()
  const days = weekDays(today).map((date) => {
    const minutes = totals.get(dayKey(date.getTime()))?.minutes ?? 0
    return {
      date,
      minutes,
      isToday: date.getTime() === todayKey,
      future: date.getTime() > todayKey,
    }
  })
  const done = days.filter((d) => !d.future).reduce((sum, d) => sum + d.minutes, 0)
  const todayMinutes = Math.floor(days.find((d) => d.isToday)?.minutes ?? 0)
  const left = Math.max(0, goal - todayMinutes)
  const scale = Math.max(goal * 2, ...days.map((d) => d.minutes))
  const plot = 160
  const barHeight = (minutes: number) => Math.round((Math.min(minutes, scale) / scale) * plot)

  return (
    <section aria-labelledby="week-heading" className={styles.column}>
      <h2 id="week-heading" className={styles.sectionTitle}>
        This week
      </h2>
      <p className={styles.sectionHint}>
        {pluralize(Math.round(done), 'minute')} so far,{' '}
        {left > 0 ? `${left} to go for today` : 'today’s goal is done'}
      </p>
      <div className={styles.weekChart}>
        <div
          className={styles.goalLine}
          style={{ bottom: 24 + barHeight(goal) }}
          aria-hidden="true"
        >
          <span>Goal, {formatMinutes(goal)}</span>
        </div>
        <div className={styles.baseline} aria-hidden="true" />
        <ol className={styles.bars}>
          {days.map((d) => {
            const name = weekdayShort.format(d.date)
            const tip = d.future ? `${name}: still ahead` : `${name}: ${formatMinutes(d.minutes)}`
            return (
              <li key={d.date.getTime()} className={styles.barColumn} title={tip} aria-label={tip}>
                {d.isToday && <span className={styles.barValue}>{formatMinutes(d.minutes)}</span>}
                <span
                  className={styles.bar}
                  data-today={d.isToday ? '' : undefined}
                  style={{ height: d.future ? 0 : barHeight(d.minutes) }}
                />
                <span className={styles.barDay} data-today={d.isToday ? '' : undefined}>
                  {name}
                </span>
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}

function BooksSection({
  shares,
  books,
  scheme,
}: {
  shares: BookShare[]
  books: Map<string, LibraryBook>
  scheme: ColorScheme
}) {
  const max = Math.max(1, ...shares.map((s) => s.minutes))
  return (
    <section aria-labelledby="books-heading" className={styles.column}>
      <h2 id="books-heading" className={styles.sectionTitle}>
        Time with each book
      </h2>
      <p className={styles.sectionHint}>This year, as a share of your reading time</p>
      {shares.length === 0 ? (
        <p className={styles.nothing}>Books you read this year will show up here.</p>
      ) : (
        <ul className={styles.bookList}>
          {shares.map((s) => {
            const book = s.book ? books.get(s.book) : undefined
            return (
              <li key={s.book ?? 'other'} className={styles.bookRow}>
                {book ? (
                  <Cover entry={book.entry} title={book.title} authors={book.authors} width={24} />
                ) : (
                  <span className={styles.otherCover} aria-hidden="true" />
                )}
                <span className={styles.bookName}>{bookName(s.book, books)}</span>
                <span className={styles.bookTrack} aria-hidden="true">
                  <span
                    style={{
                      width: `${Math.round((s.minutes / max) * 100)}%`,
                      background: s.book ? bookColor(book, scheme) : 'var(--haze)',
                    }}
                  />
                </span>
                <span className={styles.bookTime}>{formatMinutes(s.minutes)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
