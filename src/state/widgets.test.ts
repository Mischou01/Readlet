import { describe, expect, it } from 'vitest'
import { book, session } from '../test/fixtures'
import { FALLBACK_PALETTE } from '../theme/aura'
import type { PositionInfo } from './positions'
import { SHELF_SIZE, widgetSnapshot, type SnapshotInput } from './widgets'

const today = new Date(2026, 9, 26)

const reading = (fp: string, lastReadAt: number, fraction = 0.3) =>
  book(
    { fingerprint: fp, title: `Book ${fp}`, authors: ['A. Writer'] },
    {
      status: { value: 'reading', updatedAt: 1 },
      progress: {
        cfi: 'epubcfi(/6/2!/4/2/1:0)',
        fraction,
        label: 'Chapter 2',
        updatedAt: lastReadAt,
      },
    },
  )

function input(overrides: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    books: [],
    sessions: [],
    dailyGoal: 30,
    bytesPerMinute: 1600,
    today,
    position: () => null,
    ...overrides,
  }
}

describe('widgetSnapshot', () => {
  it('shows the book read last, and the shelf most recent first', () => {
    const snapshot = widgetSnapshot(
      input({ books: [reading('a', 100), reading('b', 300), reading('c', 200)] }),
    )
    expect(snapshot.current?.fingerprint).toBe('b')
    expect(snapshot.shelf.map((b) => b.fingerprint)).toEqual(['b', 'c', 'a'])
    expect(snapshot.current).toMatchObject({
      title: 'Book b',
      author: 'A. Writer',
      chapter: 'Chapter 2',
      fraction: 0.3,
      minutesLeft: null,
      palette: FALLBACK_PALETTE,
    })
  })

  it('leaves finished and unread books off the shelf, and keeps it to its size', () => {
    const finished = book({ fingerprint: 'f' }, { status: { value: 'finished', updatedAt: 1 } })
    const many = Array.from({ length: SHELF_SIZE + 2 }, (_, i) => reading(`r${i}`, i))
    const snapshot = widgetSnapshot(
      input({ books: [finished, book({ fingerprint: 'u' }), ...many] }),
    )
    expect(snapshot.shelf).toHaveLength(SHELF_SIZE)
    expect(snapshot.shelf.some((b) => b.fingerprint === 'f' || b.fingerprint === 'u')).toBe(false)
  })

  it('works out the time left in the chapter at the reader’s pace', () => {
    const where: PositionInfo = {
      section: 2,
      sections: 10,
      bytesLeftInSection: 16_000,
      bytesLeftInBook: 300_000,
      updatedAt: 1,
    }
    const snapshot = widgetSnapshot(
      input({ books: [reading('a', 100)], position: (fp) => (fp === 'a' ? where : null) }),
    )
    expect(snapshot.current?.minutesLeft).toBeCloseTo(10)
  })

  it('counts today’s minutes against the goal, with the streak', () => {
    const at = (day: number, hour: number) => new Date(2026, 9, day, hour)
    const sessions = [session(at(24, 9), 20), session(at(25, 9), 15), session(at(26, 8), 12)]
    const snapshot = widgetSnapshot(input({ sessions }))
    expect(snapshot.day).toBe('2026-10-26')
    expect(snapshot.goal).toEqual({ minutes: 12, target: 30, streak: 3, readToday: true })
  })

  it('has nothing to show for an empty library', () => {
    const snapshot = widgetSnapshot(input())
    expect(snapshot.current).toBeNull()
    expect(snapshot.shelf).toEqual([])
    expect(snapshot.goal).toEqual({ minutes: 0, target: 30, streak: 0, readToday: false })
  })
})
