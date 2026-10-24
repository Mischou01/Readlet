// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The back gesture as Tauri reports it on Android: one listener, called on each press.
const back = vi.hoisted(() => ({ press: null as (() => void) | null }))
vi.mock('@tauri-apps/api/app', () => ({
  onBackButtonPress: vi.fn(async (handler: () => void) => {
    back.press = handler
    return { unregister: vi.fn(async () => {}) }
  }),
}))

vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (Linux; Android 16; Pixel 8)' })
const { isAndroid, isBackGesture, useBackGesture } = await import('./platform')

afterEach(cleanup)

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the Android back gesture', () => {
  it('works like Escape, and goes back only when nothing on screen takes it', async () => {
    expect(isAndroid).toBe(true)
    const onUnhandled = vi.fn()
    renderHook(() => useBackGesture(onUnhandled))
    await settle()

    // A sheet is open: its Escape handler closes it, so the app doesn't go back.
    const seen: boolean[] = []
    const closeSheet = (e: KeyboardEvent) => {
      seen.push(isBackGesture(e))
      if (e.key === 'Escape') e.preventDefault()
    }
    window.addEventListener('keydown', closeSheet)
    back.press?.()
    window.removeEventListener('keydown', closeSheet)
    expect(seen).toEqual([true])
    expect(onUnhandled).not.toHaveBeenCalled()

    // Nothing open: back to the previous view (or out of the app).
    back.press?.()
    expect(onUnhandled).toHaveBeenCalledTimes(1)
  })

  it('is told apart from a real Escape key', () => {
    expect(isBackGesture(new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(false)
  })
})
