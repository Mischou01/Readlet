// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TtsEvent } from '../lib/ipc'
import type { BookViewHandle } from './BookView'
import { useReadAloud } from './useReadAloud'

// A stand-in for Speech Dispatcher: it records what it's asked to say and lets the test send events.
const tts = vi.hoisted(() => ({
  spoken: [] as string[],
  next: 1,
  emit: null as ((event: TtsEvent) => void) | null,
}))

vi.mock('../lib/ipc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/ipc')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      ttsSpeak: vi.fn(async (ssml: string) => {
        tts.spoken.push(ssml)
        return tts.next++
      }),
      ttsStop: vi.fn(async () => {}),
      ttsVoices: vi.fn(async () => []),
    },
    events: {
      ...actual.events,
      onTts: vi.fn(async (handler: (event: TtsEvent) => void) => {
        tts.emit = handler
        return () => {}
      }),
    },
  }
})

const { api } = await import('../lib/ipc')

afterEach(cleanup)
beforeEach(() => {
  tts.spoken = []
  tts.next = 1
  vi.mocked(api.ttsStop).mockClear()
})

function setUp() {
  const doc = new DOMParser().parseFromString(
    '<html><body><p>One fish. Two fish. Red fish.</p><p>Not this.</p></body></html>',
    'text/html',
  )
  const range = doc.createRange()
  const text = doc.querySelector('p')?.firstChild as Text
  range.setStart(text, 0)
  range.setEnd(text, text.data.length)
  const markSpeaking = vi.fn()
  const handle = { current: { markSpeaking, view: () => null } as unknown as BookViewHandle }
  const onEnded = vi.fn()
  const hook = renderHook(() =>
    useReadAloud({ handle, active: true, language: 'en', accent: '#336699', onEnded }),
  )
  return { hook, range, markSpeaking, onEnded }
}

/** Lets pending promises (the mocked IPC calls) settle. */
const settle = () => act(async () => {})

const send = (event: TtsEvent) => act(() => tts.emit?.(event))

describe('reading a selected passage aloud', () => {
  it('says only the passage, highlights each sentence and stops at its end', async () => {
    const { hook, range, markSpeaking, onEnded } = setUp()
    await settle()
    act(() => hook.result.current.readPassage(range))
    await settle()
    expect(tts.spoken).toHaveLength(1)
    expect(tts.spoken[0]).toContain('Red fish.')
    expect(tts.spoken[0]).not.toContain('Not this')
    expect(hook.result.current.status).toBe('playing')

    send({ kind: 'mark', message: 1, mark: '1' })
    expect(String(markSpeaking.mock.lastCall?.[0])).toBe('Two fish.')

    send({ kind: 'end', message: 1 })
    expect(onEnded).toHaveBeenCalledTimes(1)
    expect(hook.result.current.status).toBe('idle')
    expect(tts.spoken).toHaveLength(1)
  })

  it('skips back to the start of the passage and past its end to stop', async () => {
    const { hook, range, onEnded } = setUp()
    await settle()
    act(() => hook.result.current.readPassage(range))
    await settle()
    send({ kind: 'mark', message: 1, mark: '0' })
    act(() => hook.result.current.next())
    await settle()
    expect(tts.spoken[1]).toMatch(/^<speak[^>]*><mark name="1"\/>Two fish\./)
    act(() => hook.result.current.previous())
    await settle()
    expect(tts.spoken[2]).toContain('One fish.')
    send({ kind: 'mark', message: 3, mark: '2' })
    act(() => hook.result.current.next())
    await settle()
    expect(onEnded).toHaveBeenCalledTimes(1)
    expect(tts.spoken).toHaveLength(3)
  })
})

describe('pausing', () => {
  it('stops speaking at once and picks up at the sentence it was on', async () => {
    const { hook, range, onEnded } = setUp()
    await settle()
    act(() => hook.result.current.readPassage(range))
    await settle()
    send({ kind: 'mark', message: 1, mark: '1' })

    act(() => hook.result.current.toggle())
    await settle()
    expect(hook.result.current.status).toBe('paused')
    expect(api.ttsStop).toHaveBeenCalledTimes(1)
    // What Speech Dispatcher reports about the cancelled message changes nothing.
    send({ kind: 'end', message: 1 })
    expect(onEnded).not.toHaveBeenCalled()
    expect(hook.result.current.status).toBe('paused')

    act(() => hook.result.current.toggle())
    await settle()
    expect(hook.result.current.status).toBe('playing')
    expect(tts.spoken).toHaveLength(2)
    expect(tts.spoken[1]).toContain('Two fish.')
    expect(tts.spoken[1]).not.toContain('One fish.')
  })

  it('keeps quiet when paused before Speech Dispatcher has taken the passage', async () => {
    const { hook, range, onEnded } = setUp()
    await settle()
    act(() => {
      hook.result.current.readPassage(range)
    })
    act(() => hook.result.current.toggle())
    await settle()
    expect(hook.result.current.status).toBe('paused')
    // Once for the pause, once more for the message that arrived after it.
    expect(api.ttsStop).toHaveBeenCalledTimes(2)
    send({ kind: 'end', message: 1 })
    expect(onEnded).not.toHaveBeenCalled()
  })
})
