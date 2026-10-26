// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  backLabel,
  jumped,
  NO_JUMP,
  relocated,
  TURNS_TO_SETTLE,
  wayBack,
  type JumpOrigin,
} from './jumpBack'

const reading: JumpOrigin = {
  cfi: 'epubcfi(/6/4!/4,/2/1:0,/8/1:120)',
  fraction: 0.12,
  chapter: 'Chapter 1',
}
const elsewhere = 'epubcfi(/6/10!/4,/2/1:0,/6/1:80)'
const nextPage = 'epubcfi(/6/10!/4,/6/1:80,/12/1:40)'

describe('jumpBack', () => {
  it('offers the way back once the jump has landed elsewhere', () => {
    const jumping = jumped(NO_JUMP, reading)
    expect(wayBack(jumping)).toBeNull()
    // The page jumped from can be laid out again before the jump lands.
    const before = relocated(jumping, reading.cfi, false)
    expect(wayBack(before)).toBeNull()
    expect(wayBack(relocated(before, elsewhere, false))).toBe(reading)
  })

  it('offers nothing for a jump within the page, and forgets it on reading on', () => {
    const state = relocated(jumped(NO_JUMP, reading), reading.cfi, false)
    expect(wayBack(state)).toBeNull()
    expect(relocated(state, nextPage, true)).toEqual(NO_JUMP)
  })

  it('keeps the first place through several jumps', () => {
    const other: JumpOrigin = { cfi: elsewhere, fraction: 0.5 }
    const landed = relocated(jumped(NO_JUMP, reading), elsewhere, false)
    expect(wayBack(relocated(jumped(landed, other), nextPage, false))).toBe(reading)
  })

  it('goes once the reader has turned a few pages at the new place', () => {
    let state = relocated(jumped(NO_JUMP, reading), elsewhere, false)
    for (let i = 1; i < TURNS_TO_SETTLE; i++) state = relocated(state, nextPage, true)
    expect(wayBack(state)).toBe(reading)
    expect(relocated(state, nextPage, true)).toEqual(NO_JUMP)
  })

  it('ignores the page being laid out again', () => {
    let state = relocated(jumped(NO_JUMP, reading), elsewhere, false)
    for (let i = 0; i < 10; i++) state = relocated(state, elsewhere, false)
    expect(wayBack(state)).toBe(reading)
  })

  it('goes when the reader is back on the page they jumped from', () => {
    const state = relocated(jumped(NO_JUMP, reading), elsewhere, false)
    expect(relocated(state, 'epubcfi(/6/4!/4,/2/1:0,/8/1:120)', true)).toEqual(NO_JUMP)
  })

  it('names the chapter, or the place within the same chapter', () => {
    expect(backLabel(reading, 'Chapter 7')).toBe('Back to Chapter 1')
    expect(backLabel(reading, 'Chapter 1')).toBe('Back to 12%')
  })
})
