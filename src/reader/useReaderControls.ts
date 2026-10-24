// Android's controls while reading (docs/PLAN.md §12): the screen stays on for a while after the
// last page turn or tap, rather than dimming mid-page, and the volume keys can turn pages. Both
// are handed back to the system when the reader closes. The desktop has neither.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLatest } from '../lib/hooks'
import { api, events, subscribeAll } from '../lib/ipc'
import { isAndroid } from '../lib/platform'

interface ReaderControlsOptions {
  /** How long the screen stays on after the last activity; 0 leaves it to the system. */
  screenOnMinutes: number
  volumeKeys: boolean
  onPageKey: (direction: 'next' | 'previous') => void
}

// Calls go through a queue so they reach the phone in the order they were made.
let queue: Promise<void> = Promise.resolve()
function setControls(keepScreenOn: boolean, volumeKeys: boolean) {
  queue = queue
    .then(() => api.setReaderControls({ keepScreenOn, volumeKeys }))
    .catch((e: unknown) => console.warn('setting the reading controls failed', e))
}

/** Returns `poke`, to call on every page turn, tap or key press: it keeps the screen on. */
export function useReaderControls({
  screenOnMinutes,
  volumeKeys,
  onPageKey,
}: ReaderControlsOptions): { poke: () => void } {
  // Opening the book counts as activity.
  const [awake, setAwake] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const sleepLater = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setAwake(false), screenOnMinutes * 60_000)
  }, [screenOnMinutes])
  useEffect(sleepLater, [sleepLater])

  const poke = useCallback(() => {
    if (!isAndroid || screenOnMinutes <= 0) return
    setAwake(true)
    sleepLater()
  }, [screenOnMinutes, sleepLater])

  const keepScreenOn = awake && screenOnMinutes > 0
  useEffect(() => {
    if (isAndroid) setControls(keepScreenOn, volumeKeys)
  }, [keepScreenOn, volumeKeys])

  useEffect(
    () => () => {
      clearTimeout(timer.current)
      if (isAndroid) setControls(false, false)
    },
    [],
  )

  const pageKey = useLatest(onPageKey)
  useEffect(() => {
    if (!isAndroid) return
    return subscribeAll([events.onPageKey((direction) => pageKey.current(direction))])
  }, [pageKey])

  return { poke }
}
