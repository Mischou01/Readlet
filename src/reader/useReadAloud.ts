// Read-aloud (docs/PLAN.md §6): foliate-js turns each paragraph into SSML with a mark before
// every sentence; the Rust core speaks it through Speech Dispatcher and reports each mark, which
// highlights the sentence and turns pages as needed. At the end of a chapter it moves on. A selected
// passage is read on its own instead (passage.ts), and stops at its end.
//
// Pausing cancels the speech and resuming starts the sentence again: Speech Dispatcher's own PAUSE
// may keep talking until the synthesizer reaches a point it can resume from, which can be the end
// of the paragraph.

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useLatest } from '../lib/hooks'
import {
  api,
  events,
  subscribeAll,
  toAppError,
  type RemoteAction,
  type TtsEvent,
  type Voice,
} from '../lib/ipc'
import { usePreferences } from '../state/preferences'
import { useToasts } from '../state/toasts'
import type { BookViewHandle } from './BookView'
import { passageFromRange } from './passage'
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
  /** Reads just the text in `range`, then stops. */
  readPassage: (range: Range) => void
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
  /** What's being read, for the system's media controls (the lock screen on Android). */
  book: { fingerprint: string; title: string; chapter: string | null }
  onEnded: () => void
}

/**
 * The paragraph at `range`, as SSML. tts.js throws when nothing readable follows the range (on a
 * page that is only an image, such as a cover); then there's nothing here and reading moves on.
 */
function speakableFrom(tts: { from: (range: Range) => string | undefined }, range: Range) {
  try {
    return tts.from(range)
  } catch (e) {
    if (e instanceof TypeError) return undefined
    throw e
  }
}

export function useReadAloud({
  handle,
  active,
  language,
  accent,
  book,
  onEnded,
}: Options): ReadAloud {
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
  const paused = useRef(false)
  /** Counts speak requests, so one still waiting for its message id knows it's been overtaken. */
  const turn = useRef(0)
  /** While reading a selected passage: its sentences by mark name (else tts.js has them). */
  const passage = useRef<Map<string, Range> | null>(null)
  const settings = useRef({ speed, voice, language, accent, sleep, onEnded })
  useEffect(() => {
    settings.current = { speed, voice, language, accent, sleep, onEnded }
  })

  const view = useCallback(() => handle.current?.view() ?? null, [handle])

  /** Forgets the message being spoken, so its remaining events are ignored. */
  const quiet = useCallback(() => {
    turn.current += 1
    message.current = null
    paused.current = false
    passage.current = null
  }, [])

  const finish = useCallback(
    (reason?: string) => {
      stopped.current = true
      quiet()
      handle.current?.markSpeaking(null, '')
      setStatus('idle')
      void api.ttsStop().catch(() => {})
      if (reason) useToasts.getState().show({ message: reason })
      settings.current.onEnded()
    },
    [handle, quiet],
  )

  const fail = useCallback(
    (e: unknown) => {
      stopped.current = true
      quiet()
      handle.current?.markSpeaking(null, '')
      setError(toAppError(e).message)
      setStatus('error')
    },
    [handle, quiet],
  )

  /** Speaks `ssml`; `whole` if it's a new paragraph (or passage) rather than part of the current one. */
  const speak = useCallback(async (ssml: string, whole: boolean) => {
    if (stopped.current || paused.current) return
    if (whole) paragraph.current = ssml
    mark.current = null
    const { speed, voice, language } = settings.current
    setStatus('playing')
    const mine = (turn.current += 1)
    const id = await api.ttsSpeak(ssml, speed, voice, language)
    if (mine === turn.current) message.current = id
    // Paused or stopped while Speech Dispatcher was taking it: it mustn't play.
    else if (stopped.current || paused.current) await api.ttsStop()
  }, [])

  const highlight = useCallback(
    (range: Range) => handle.current?.markSpeaking(range, withAlpha(settings.current.accent, 0.24)),
    [handle],
  )

  const ensureTts = useCallback(async () => {
    const v = view()
    if (!v) throw new Error('the book isn’t open yet')
    await v.initTTS('sentence', highlight)
    if (!v.tts) throw new Error('this book can’t be read aloud')
    return v.tts
  }, [highlight, view])

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
          if (!passage.current) view()?.tts?.setMark(event.mark)
          else {
            const sentence = passage.current.get(event.mark)
            if (sentence) highlight(sentence)
          }
        } else if (event.kind === 'end') {
          if (passage.current) finish()
          else advance().catch(fail)
        } else if (event.kind === 'error') {
          void api.ttsStop().catch(() => {})
          fail(new Error(event.error ?? 'Read-aloud stopped'))
        }
      })
      .then((fn) => (disposed ? fn() : (unlisten = fn)))
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [advance, fail, finish, highlight, view])

  // Stop speaking when read-aloud is turned off or the reader closes.
  useEffect(() => {
    if (active) return
    if (!stopped.current) {
      stopped.current = true
      quiet()
      void api.ttsStop().catch(() => {})
      handle.current?.markSpeaking(null, '')
      setStatus('idle')
    }
  }, [active, handle, quiet])
  useEffect(
    () => () => {
      if (!stopped.current) void api.ttsStop().catch(() => {})
    },
    [],
  )

  // The system's media controls (Android's notification and lock screen) follow along; they also
  // keep reading going with the screen off.
  const playing = status === 'playing' || status === 'loading'
  const showSession = active && status !== 'idle' && status !== 'error'
  const { fingerprint, title, chapter } = book
  useEffect(() => {
    if (!showSession) return
    api
      .ttsSession({ title, chapter, fingerprint, playing })
      .catch((e) => console.warn('updating the media controls failed', e))
  }, [showSession, title, chapter, fingerprint, playing])
  useEffect(() => {
    if (!showSession) return
    return () => void api.ttsSession(null).catch(() => {})
  }, [showSession])

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
      quiet()
      stopped.current = false
      paragraph.current = ''
      mark.current = null
      setError(null)
      setStatus('loading')
      void (async () => {
        const tts = await ensureTts()
        const range = from ?? view()?.lastLocation?.range
        const ssml = range ? speakableFrom(tts, range) : tts.start()
        if (ssml) await speak(ssml, true)
        else await advance()
      })().catch(fail)
    },
    [quiet, ensureTts, speak, advance, fail, view],
  )

  const readPassage = useCallback(
    (range: Range) => {
      // Worked out now: the selection the range came from is about to be cleared.
      const selected = passageFromRange(range, settings.current.language)
      quiet()
      if (!selected) return finish()
      stopped.current = false
      passage.current = selected.sentences
      setError(null)
      setStatus('loading')
      speak(selected.ssml, true).catch(fail)
    },
    [quiet, finish, speak, fail],
  )

  const pause = useCallback(() => {
    // The sentence stays marked, to show where reading will pick up.
    const reading = passage.current
    quiet()
    passage.current = reading
    paused.current = true
    setStatus('paused')
    api.ttsStop().catch(fail)
  }, [quiet, fail])

  const resume = useCallback(() => {
    paused.current = false
    if (!paragraph.current) return start()
    const from = mark.current != null ? ssmlFromMark(paragraph.current, mark.current) : null
    speak(from ?? paragraph.current, false).catch(fail)
  }, [start, speak, fail])

  const toggle = useCallback(() => {
    if (status === 'playing' || status === 'loading') pause()
    else if (status === 'paused') resume()
    else start()
  }, [status, pause, resume, start])

  const jump = useCallback(
    (direction: 1 | -1) => {
      void (async () => {
        const names = markNames(paragraph.current)
        const current = mark.current != null ? names.indexOf(mark.current) : -1
        const target = names[current + direction]
        const within =
          target != null && current >= 0 ? ssmlFromMark(paragraph.current, target) : null
        stopped.current = false
        paused.current = false
        if (within) return speak(within, false)
        if (passage.current) {
          // Past the end of a selected passage there's nothing more; before it, its start.
          return direction > 0 ? finish() : speak(paragraph.current, false)
        }
        const tts = await ensureTts()
        const ssml = direction > 0 ? tts.next() : tts.prev()
        if (ssml) return speak(ssml, true)
        if (direction > 0) return advance()
      })().catch(fail)
    },
    [ensureTts, speak, advance, finish, fail],
  )

  // Media controls used outside the app: the lock screen, the notification, a headset button.
  const remote = useLatest((action: RemoteAction) => {
    if (stopped.current && action !== 'play') return
    switch (action) {
      case 'play':
        if (status === 'paused') resume()
        else if (status === 'idle' && active) start()
        break
      case 'pause':
        if (status === 'playing' || status === 'loading') pause()
        break
      case 'toggle':
        toggle()
        break
      case 'next':
        jump(1)
        break
      case 'previous':
        jump(-1)
        break
      case 'stop':
        finish()
        break
    }
  })
  useEffect(() => subscribeAll([events.onTtsRemote((action) => remote.current(action))]), [remote])

  return {
    status,
    error,
    speed,
    voice,
    voices,
    sleep,
    start,
    readPassage,
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
