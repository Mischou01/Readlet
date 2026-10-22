import { describe, expect, it } from 'vitest'
import { bookCsp, injectCsp } from './csp'

const ORIGIN = 'tauri://localhost'

describe('bookCsp', () => {
  it('blocks scripts, forms, frames and remote resources', () => {
    const csp = bookCsp(ORIGIN)
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("script-src 'none'")
    expect(csp).toContain("form-action 'none'")
    expect(csp).toContain(`img-src blob: data: ${ORIGIN}`)
    expect(csp).not.toMatch(/https?:/)
  })
})

describe('injectCsp', () => {
  const meta = (markup: string) =>
    markup.match(/<meta http-equiv="Content-Security-Policy"/g)?.length

  it('adds the policy at the start of the head', () => {
    const out = injectCsp('<html><head lang="en"><title>x</title></head><body/></html>', ORIGIN)
    expect(out).toMatch(/^<html><head lang="en"><meta http-equiv="Content-Security-Policy"/)
    expect(meta(out)).toBe(1)
  })

  it('does not mistake <header> for <head>', () => {
    const out = injectCsp('<html><body><header>x</header></body></html>', ORIGIN)
    expect(out.startsWith('<html><head><meta')).toBe(true)
  })

  it('handles documents without html or head', () => {
    expect(injectCsp('<p>x</p>', ORIGIN).startsWith('<meta')).toBe(true)
  })
})
