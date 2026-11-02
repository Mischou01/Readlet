// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReaderFooter } from './ReaderFooter'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

beforeEach(() => {
  // 1,000px wide, so 14px is 1.4% of the book.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 1000,
    left: 0,
  } as DOMRect)
})

function footer(onSeek = vi.fn()) {
  render(
    <ReaderFooter
      chromeHidden={false}
      fraction={0.1}
      minutesLeft={null}
      sectionPages={null}
      bookmarks={[{ fraction: 0.5, label: 'The storm' }]}
      chapters={[]}
      onSeek={onSeek}
    />,
  )
  return { slider: screen.getByLabelText('Position in book') as HTMLInputElement, onSeek }
}

function drag(slider: HTMLInputElement, value: number) {
  fireEvent.pointerDown(slider)
  fireEvent.input(slider, { target: { value: String(value) } })
}

describe('ReaderFooter', () => {
  it('catches on a bookmark dragged close to, and goes to it', () => {
    const { slider, onSeek } = footer()
    drag(slider, 508)
    expect(screen.getByText(/The storm/)).toBeTruthy()
    slider.dispatchEvent(new Event('change'))
    expect(onSeek).toHaveBeenCalledWith(0.5, 0)
  })

  it('goes where it was let go away from bookmarks', () => {
    const { slider, onSeek } = footer()
    drag(slider, 300)
    expect(screen.queryByText(/The storm/)).toBeNull()
    slider.dispatchEvent(new Event('change'))
    expect(onSeek).toHaveBeenCalledWith(0.3)
  })

  it('puts the bar back when a drag is cancelled', () => {
    vi.useFakeTimers()
    const { slider, onSeek } = footer()
    drag(slider, 300)
    expect(screen.getByText('30%')).toBeTruthy()
    fireEvent.pointerCancel(slider)
    act(() => void vi.advanceTimersByTime(300))
    expect(screen.queryByText('30%')).toBeNull()
    expect(onSeek).not.toHaveBeenCalled()
  })
})
