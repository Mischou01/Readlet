// Where the reader's other devices are in the open book: when the book opens at a place another
// device left it, and when another device reads on while it's open. Each device's position is
// kept apart (`get_positions`), so these can name the device. The decisions are pure (tested in
// devicePositions.test.ts); the hook shows them as toasts.

import { useEffect, useRef } from 'react'
import { formatPercent } from '../lib/format'
import { api, events, subscribeAll, toAppError } from '../lib/ipc'
import type { DevicePosition, Progress } from '../lib/types'
import { syncConnected } from '../state/sync'
import { useToasts } from '../state/toasts'

/** Positions closer than this (about a page in a long book) count as the same place. */
const SAME_PLACE = 0.003
const TOAST_MS = 12_000

/** The book opened where another device left it; `back` is where this one was, if it read it. */
export interface PickedUp {
  from: DevicePosition
  back: Progress | null
}

/** On opening: the newest position is another device's, somewhere else than this one's. */
export function pickedUpFrom(positions: DevicePosition[]): PickedUp | null {
  const [newest] = positions
  if (!newest || newest.own) return null
  const own = positions.find((p) => p.own)?.progress ?? null
  if (own && Math.abs(own.fraction - newest.progress.fraction) < SAME_PLACE) return null
  return { from: newest, back: own }
}

/**
 * While reading: another device read this book after this one last turned a page (`movedAt`),
 * and is somewhere else than `fraction`. `seen` holds the positions already told about.
 */
export function readOnElsewhere(
  positions: DevicePosition[],
  current: { fraction: number; movedAt: number },
  seen: ReadonlySet<string>,
): DevicePosition | null {
  const other = positions.find((p) => !p.own)
  if (!other) return null
  const { progress } = other
  const news = progress.updatedAt > current.movedAt && !seen.has(positionKey(other))
  return news && Math.abs(progress.fraction - current.fraction) >= SAME_PLACE ? other : null
}

export function positionKey(position: DevicePosition): string {
  return `${position.device.id}:${position.progress.updatedAt}`
}

/** "Chapter 9 · 47%" */
export function placeOf(progress: Progress): string {
  const percent = formatPercent(progress.fraction)
  return progress.label ? `${progress.label} · ${percent}` : percent
}

/** "6% ahead", "2% behind" */
export function distance(from: number, to: number): string {
  return `${formatPercent(Math.abs(to - from))} ${to > from ? 'ahead' : 'behind'}`
}

interface DevicePositionsOptions {
  fingerprint: string
  /** The book is on screen at its first position. */
  shown: boolean
  /** Opened at a chosen place (a highlight, say) rather than where reading left off. */
  target?: string
  /** Where the reader is now, and when they last moved. */
  current: () => { fraction: number; movedAt: number }
  goTo: (cfi: string) => void
}

/** Tells the reader where their other devices are in the book, as toasts with a way there. */
export function useDevicePositions({
  fingerprint,
  shown,
  target,
  current,
  goTo,
}: DevicePositionsOptions) {
  // Read as the book opens, before this device saves a position of its own over its last one.
  const atOpen = useRef<Promise<DevicePosition[]> | null>(null)
  const seen = useRef(new Set<string>())
  const latest = useRef({ current, goTo })
  useEffect(() => {
    latest.current = { current, goTo }
  })

  useEffect(() => {
    atOpen.current = api.getPositions(fingerprint).catch((e: unknown) => {
      console.warn('reading the devices’ positions failed', toAppError(e))
      return []
    })
    // Ask for the other devices' news now: the book may have been read on since the last pass.
    if (syncConnected()) void api.syncSoon().catch(() => {})
  }, [fingerprint])

  useEffect(() => {
    if (!shown || target) return
    let cancelled = false
    void atOpen.current?.then((positions) => {
      const picked = pickedUpFrom(positions)
      if (cancelled || !picked) return
      for (const p of positions) seen.current.add(positionKey(p))
      const { from, back } = picked
      useToasts.getState().show({
        message: `Picked up where ${from.device.name} left off`,
        durationMs: TOAST_MS,
        action: back
          ? {
              label: `Back to ${formatPercent(back.fraction)}`,
              run: () => latest.current.goTo(back.cfi),
            }
          : undefined,
      })
    })
    return () => {
      cancelled = true
    }
  }, [shown, target])

  useEffect(() => {
    if (!shown) return
    return subscribeAll([
      events.onStoreChanged((changes) => {
        if (!changes.books.includes(fingerprint)) return
        void api.getPositions(fingerprint).then(
          (positions) => {
            const now = latest.current.current()
            const other = readOnElsewhere(positions, now, seen.current)
            if (!other) return
            seen.current.add(positionKey(other))
            useToasts.getState().show({
              message: `${other.device.name} is at ${placeOf(other.progress)}, ${distance(now.fraction, other.progress.fraction)}`,
              durationMs: TOAST_MS,
              action: { label: 'Go there', run: () => latest.current.goTo(other.progress.cfi) },
            })
          },
          () => {},
        )
      }),
    ])
  }, [shown, fingerprint])
}
