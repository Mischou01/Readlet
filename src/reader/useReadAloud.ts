// Read-aloud (docs/PLAN.md §6): foliate-js turns each paragraph into SSML with a mark before
// every sentence; the Rust core speaks it through Speech Dispatcher and reports each mark, which
// highlights the sentence and turns pages as needed. At the end of a chapter it moves on.

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { api, events, toAppError, type TtsEvent, type Voice } from '../lib/ipc'
import { usePreferences } from '../state/preferences'
import { useToasts } from '../state/toasts'
import type { BookViewHandle } from './BookView'
import { markNames, ssmlFromMark } from './ssml'
import { withAlpha } from './themes'

export type ReadAloudStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'
export type SleepTimer = 'off' | 15 | 30 | 'chapter'

export const SPEEDS = [0.8, 1, 1.2, 1.5, 1.75, 2] as const
export const SLEEP_TIMERS: SleepTimer[] = ['off', 15, 30, 'chapter']

export interface ReadAloud {
  status: ReadAloudStatus
  error: string | null
  speed: number
  voice: string | null
  voices: Voice[]
  sleep: SleepTimer
  start: (from?: Range) => void
  toggle: () => void
  stop: () => void
  previous: () => void
  next: () => void
  cycleSpeed: () => void
  setVoice: (voice: string | null) => void
  cycleSleep: () => void
}

interface Options {
  handle: RefObject<BookViewHandle | null>
  active: boolean
  language: string | null
  accent: string
  onEnded: () => void
}

export function useReadAloud({ handle, active, language, accent, onEnded }: Options): ReadAloud {
  const speed = usePreferences((s) => s.prefs.readAloud.rate)
  const voice = usePreferences((s) => s.prefs.readAloud.voice)
  const update = usePreferences((s) => s.update)
  const [status, setStatus] = useState<ReadAloudStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [voices, setVoices] = useState<Voice[]>([])
  const [sleep, setSleep] = useState<SleepTimer>('off')

  const message = useRef<number | null>(null)
  /** The paragraph being spoken, as fetched from tts.js (it may start mid-paragraph). */
  const paragraph = useRef<string>('')
  const mark = useRef<string | null>(null)
  const stopped = useRef(true)
  const settings = useRef({ speed, voice, language, accent, sleep, onEnded })
  useEffect(() => {
    settings.current = { speed, voice, language, accent, sleep, onEnded }
  })

  const view = useCallback(() => handle.current?.view() ?? null, [handle])

  const finish = useCallback(
    (reason?: string) => {
      stopped.current = true
      message.current = null
      handle.current?.markSpeaking(null, '')
      setStatus('idle')
      void api.ttsStop().catch(() => {})
      if (reason) useToasts.getState().show({ message: reason })
      settings.current.onEnded()
    },
    [handle],
  )

  const fail = useCallback(
    (e: unknown) => {
      stopped.current = true
      message.current = null
      handle.current?.markSpeaking(null, '')
      setError(toAppError(e).message)
      setStatus('error')
    },
    [handle],
  )

  const speak = useCallback(async (ssml: string, whole: boolean) => {
    if (stopped.current) return
    if (whole) paragraph.current = ssml
    mark.current = null
    const { speed, voice, language } = settings.current
    setStatus((s) => (s === 'paused' ? s : 'playing'))
    message.current = await api.ttsSpeak(ssml, speed, voice, language)
  }, [])

  const ensureTts = useCallback(async () => {
    const v = view()
    if (!v) throw new Error('the book isn’t open yet')
    const highlight = (range: Range) =>
      handle.current?.markSpeaking(range, withAlpha(settings.current.accent, 0.24))
    await v.initTTS('sentence', highlight)
    if (!v.tts) throw new Error('this book can’t be read aloud')
    return v.tts
  }, [handle, view])

  /** Next paragraph; at the end of a chapter, the next chapter (skipping empty ones). */
  const advance = useCallback(async () => {
    for (;;) {
      const tts = await ensureTts()
      const ssml = tts.next()
      if (ssml) return speak(ssml, true)
      if (settings.current.sleep === 'chapter') {
        return finish('Read-aloud stopped at the end of the chapter')
      }
      const v = view()
      const before = v?.renderer.getContents()[0]?.index
      await (v?.renderer as unknown as { nextSection?: () => Promise<void> })?.nextSection?.()
      const after = v?.renderer.getContents()[0]?.index
      if (after === undefined || after === before) return finish('That’s the end of the book')
      const first = (await ensureTts()).start()
      if (first) return speak(first, true)
    }
  }, [ensureTts, speak, finish, view])

  // Events from Speech Dispatcher.
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let disposed = false
    void events
      .onTts((event: TtsEvent) => {
        if (stopped.current || event.message !== message.current) return
        if (event.kind === 'mark' && event.mark != null) {
          mark.current = event.mark
          view()?.tts?.setMark(event.mark)
        } else if (event.kind === 'end') {
          advance().catch(fail)
        }
      })
      .then((fn) => (disposed ? fn() : (unlisten = fn)))
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [advance, fail, view])

  // Stop speaking when read-aloud is turned off or the reader closes.
  useEffect(() => {
    if (active) return
    if (!stopped.current) {
      stopped.current = true
      message.current = null
      void api.ttsStop().catch(() => {})
      handle.current?.markSpeaking(null, '')
      setStatus('idle')
    }
  }, [active, handle])
  useEffect(
    () => () => {
      if (!stopped.current) void api.ttsStop().catch(() => {})
    },
    [],
  )

  // Voices, once read-aloud is first used.
  useEffect(() => {
    if (!active || voices.length) return
    api.ttsVoices().then(setVoices, () => {})
  }, [active, voices.length])

  // Sleep timer in minutes.
  useEffect(() => {
    if (typeof sleep !== 'number' || status !== 'playing') return
    const timer = setTimeout(
      () => finish(`Sleep timer: stopped after ${sleep} minutes`),
      sleep * 60_000,
    )
    return () => clearTimeout(timer)
  }, [sleep, status, finish])

  const start = useCallback(
    (from?: Range) => {
      stopped.current = false
      setError(null)
      setStatus('loading')
      void (async () => {
        const tts = await ensureTts()
        const range = from ?? view()?.lastLocation?.range
        const ssml = range ? tts.from(range) : tts.start()
        if (ssml) await speak(ssml, true)
        else await advance()
      })().catch(fail)
    },
    [ensureTts, speak, advance, fail, view],
  )

  const toggle = useCallback(() => {
    if (status === 'playing') {
      setStatus('paused')
      api.ttsPause().catch(fail)
    } else if (status === 'paused') {
      setStatus('playing')
      api.ttsResume().catch(fail)
    } else {
      start()
    }
  }, [status, start, fail])

  const jump = useCallback(
    (direction: 1 | -1) => {
      void (async () => {
        const tts = await ensureTts()
        const names = markNames(paragraph.current)
        const current = mark.current != null ? names.indexOf(mark.current) : -1
        const target = names[current + direction]
        const within =
          target != null && current >= 0 ? ssmlFromMark(paragraph.current, target) : null
        stopped.current = false
        if (within) return speak(within, false)
        const ssml = direction > 0 ? tts.next() : tts.prev()
        if (ssml) return speak(ssml, true)
        if (direction > 0) return advance()
      })().catch(fail)
    },
    [ensureTts, speak, advance, fail],
  )

  return {
    status,
    error,
    speed,
    voice,
    voices,
    sleep,
    start,
    toggle,
    stop: () => {
      if (!stopped.current) finish()
    },
    previous: () => jump(-1),
    next: () => jump(1),
    cycleSpeed: () => {
      const i = SPEEDS.findIndex((s) => s === speed)
      const nextSpeed = SPEEDS[(i + 1) % SPEEDS.length] ?? 1
      update({ readAloud: { rate: nextSpeed } })
      // Speech Dispatcher applies a new rate to the next message: restart the current sentence.
      if (status === 'playing' && mark.current != null) {
        const ssml = ssmlFromMark(paragraph.current, mark.current)
        settings.current.speed = nextSpeed
        if (ssml) speak(ssml, false).catch(fail)
      }
    },
    setVoice: (name) => update({ readAloud: { voice: name } }),
    cycleSleep: () =>
      setSleep((s) => SLEEP_TIMERS[(SLEEP_TIMERS.indexOf(s) + 1) % SLEEP_TIMERS.length] ?? 'off'),
  }
}
