import { describe, expect, it } from 'vitest'
import { book, highlight } from '../test/fixtures'
import { allHighlights, resurfaceOrder } from './resurface'

const DAY = 86_400_000
const now = Date.UTC(2026, 9, 22, 12)

const b = book(
  {},
  {
    annotations: [
      highlight({ id: 'old', createdAt: now - 60 * DAY }),
      highlight({ id: 'older', createdAt: now - 90 * DAY }),
      highlight({ id: 'fresh', createdAt: now - DAY }),
    ],
  },
)

describe('resurfaceOrder', () => {
  it('puts highlights from the last week last', () => {
    const order = resurfaceOrder(allHighlights([b]), [], '2026-10-22', now)
    expect(order.at(-1)?.annotation.id).toBe('fresh')
  })

  it('favours highlights not shown recently', () => {
    const log = [
      { highlight: 'old', day: '2026-10-21' },
      { highlight: 'older', day: '2026-09-01' },
    ]
    const order = resurfaceOrder(allHighlights([b]), log, '2026-10-22', now)
    expect(order.map((h) => h.annotation.id)).toEqual(['older', 'old', 'fresh'])
  })

  it('keeps the same order all day', () => {
    const first = resurfaceOrder(allHighlights([b]), [], '2026-10-22', now)
    const logged = [{ highlight: first[0]!.annotation.id, day: '2026-10-22' }]
    const later = resurfaceOrder(allHighlights([b]), logged, '2026-10-22', now)
    expect(later.map((h) => h.annotation.id)).toEqual(first.map((h) => h.annotation.id))
  })
})
