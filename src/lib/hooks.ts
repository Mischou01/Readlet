import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** A ref that always holds the latest value, for callbacks used inside long-lived effects. */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  })
  return ref
}

/** Calls `handler` on Escape, unless something inside already handled the key. */
export function useEscape(handler: () => void, enabled = true) {
  const latest = useLatest(handler)
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        latest.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, latest])
}

/** Runs `fn` after `delay` ms of quiet; the returned function restarts the timer. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, delay: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const debounced = (...args: A) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
  debounced.cancel = () => clearTimeout(timer)
  return debounced
}

function msUntilTomorrow(): number {
  const tomorrow = new Date()
  tomorrow.setHours(24, 0, 0, 0)
  return tomorrow.getTime() - Date.now()
}

/** Today's date (as midnight), updated when the day changes while the app is open. */
export function useToday(): Date {
  const [today, setToday] = useState(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  })
  useEffect(() => {
    const timer = setTimeout(() => {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      setToday(d)
    }, msUntilTomorrow() + 1000)
    return () => clearTimeout(timer)
  }, [today])
  return today
}
