// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { rangeBetween, useBookSelection } from './selection'

const order = ['a', 'b', 'c', 'd', 'e']

describe('rangeBetween', () => {
  it('covers both ends in display order, whichever way round', () => {
    expect(rangeBetween(order, 'b', 'd')).toEqual(['b', 'c', 'd'])
    expect(rangeBetween(order, 'd', 'b')).toEqual(['b', 'c', 'd'])
    expect(rangeBetween(order, 'c', 'c')).toEqual(['c'])
  })

  it('is empty when either end is no longer shown', () => {
    expect(rangeBetween(order, 'x', 'b')).toEqual([])
    expect(rangeBetween(order, 'b', 'x')).toEqual([])
  })
})

describe('useBookSelection', () => {
  it('toggles books and extends ranges from the last one clicked', () => {
    const { result } = renderHook(() => useBookSelection(order))
    expect(result.current.selecting).toBe(false)

    act(() => result.current.click('b'))
    expect(result.current.selecting).toBe(true)
    expect(result.current.selected).toEqual(['b'])

    act(() => result.current.click('d', { range: true }))
    expect(result.current.selected).toEqual(['b', 'c', 'd'])

    act(() => result.current.click('c'))
    expect(result.current.selected).toEqual(['b', 'd'])

    act(() => result.current.exit())
    expect(result.current.selecting).toBe(false)
    expect(result.current.selected).toEqual([])
  })

  it('acts only on books that are on screen, in display order', () => {
    let visible = order
    const { result, rerender } = renderHook(() => useBookSelection(visible))
    act(() => result.current.selectAll())
    expect(result.current.selected).toEqual(order)

    visible = ['e', 'a']
    rerender()
    expect(result.current.selected).toEqual(['e', 'a'])
    expect(result.current.has('c')).toBe(true)
  })

  it('leaves selection on Escape and selects everything on Ctrl+A', () => {
    const { result } = renderHook(() => useBookSelection(order))
    act(() => result.current.start())
    expect(result.current.selected).toEqual([])

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }))
    })
    expect(result.current.selected).toEqual(order)

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(result.current.selecting).toBe(false)
  })
})
