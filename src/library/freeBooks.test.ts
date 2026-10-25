import { describe, expect, it } from 'vitest'
import { book } from '../test/fixtures'
import { inLibrary, storeLinks } from './freeBooks'

describe('inLibrary', () => {
  const library = [book({ title: 'Pride and Prejudice', authors: ['Jane Austen'] })]

  it('matches by title and author, ignoring punctuation and case', () => {
    expect(inLibrary({ id: 1, title: 'Pride & prejudice', author: 'Jane Austen' }, library)).toBe(
      true,
    )
    expect(inLibrary({ id: 2, title: 'Pride and Prejudice', author: null }, library)).toBe(true)
  })

  it('tells apart other books and other authors', () => {
    expect(inLibrary({ id: 3, title: 'Emma', author: 'Jane Austen' }, library)).toBe(false)
    expect(
      inLibrary({ id: 4, title: 'Pride and Prejudice', author: 'Seth Grahame-Smith' }, library),
    ).toBe(false)
  })
})

describe('storeLinks', () => {
  it('puts the search in the links that take one', () => {
    const kobo = storeLinks(' Iron Gold ').find((s) => s.name === 'Kobo')
    expect(kobo?.url).toBe('https://www.kobo.com/search?query=Iron%20Gold')
  })
})
