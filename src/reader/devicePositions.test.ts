import { describe, expect, it } from 'vitest'
import type { DevicePosition } from '../lib/types'
import { distance, pickedUpFrom, placeOf, positionKey, readOnElsewhere } from './devicePositions'

const at = (name: string, own: boolean, fraction: number, updatedAt: number): DevicePosition => ({
  device: { id: name.toLowerCase(), name },
  own,
  progress: { cfi: `epubcfi(/6/${Math.round(fraction * 100)})`, fraction, updatedAt },
})

describe('opening a book another device read on in', () => {
  it('says where it picked up, with the way back', () => {
    const phone = at('Phone', false, 0.47, 20)
    const laptop = at('Laptop', true, 0.41, 10)
    expect(pickedUpFrom([phone, laptop])).toEqual({ from: phone, back: laptop.progress })
  })

  it('says nothing when this device was last, or the places match', () => {
    expect(pickedUpFrom([at('Laptop', true, 0.5, 20), at('Phone', false, 0.6, 10)])).toBeNull()
    expect(pickedUpFrom([at('Phone', false, 0.501, 20), at('Laptop', true, 0.5, 10)])).toBeNull()
    expect(pickedUpFrom([])).toBeNull()
  })

  it('has no way back for a book never read here', () => {
    expect(pickedUpFrom([at('Phone', false, 0.3, 5)])?.back).toBeNull()
  })
})

describe('another device reading on while the book is open', () => {
  const positions = [at('Phone', false, 0.53, 50), at('Laptop', true, 0.47, 30)]

  it('tells once about a place read after the last page turn here', () => {
    const now = { fraction: 0.47, movedAt: 40 }
    const other = readOnElsewhere(positions, now, new Set())
    expect(other?.device.name).toBe('Phone')
    expect(readOnElsewhere(positions, now, new Set([positionKey(other!)]))).toBeNull()
  })

  it('stays quiet about older places and the same place', () => {
    expect(readOnElsewhere(positions, { fraction: 0.47, movedAt: 60 }, new Set())).toBeNull()
    expect(readOnElsewhere(positions, { fraction: 0.531, movedAt: 40 }, new Set())).toBeNull()
  })

  it('describes the place and the distance', () => {
    expect(placeOf({ cfi: '', fraction: 0.47, label: 'Chapter 9', updatedAt: 0 })).toBe(
      'Chapter 9 · 47%',
    )
    expect(distance(0.41, 0.47)).toBe('6% ahead')
    expect(distance(0.47, 0.45)).toBe('2% behind')
  })
})
