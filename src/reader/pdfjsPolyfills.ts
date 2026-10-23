// Newer built-ins that pdf.js 5 (vendor/foliate-js/vendor/pdfjs) calls without checking for them.
// Webviews whose JavaScript engine predates them (WebKitGTK releases among them) otherwise fail
// to open any PDF. Loaded into the page and into the pdf.js worker before pdf.js itself. Each one
// is only added when it's missing, and only as far as pdf.js uses it.

function define(target: object, name: string, value: unknown) {
  if (name in target) return
  Object.defineProperty(target, name, { value, writable: true, configurable: true })
}

type Keyed = Map<unknown, unknown>

for (const proto of [Map.prototype, WeakMap.prototype]) {
  define(proto, 'getOrInsert', function (this: Keyed, key: unknown, value: unknown) {
    if (!this.has(key)) this.set(key, value)
    return this.get(key)
  })
  define(
    proto,
    'getOrInsertComputed',
    function (this: Keyed, key: unknown, compute: (key: unknown) => unknown) {
      if (!this.has(key)) this.set(key, compute(key))
      return this.get(key)
    },
  )
}

define(Promise, 'try', (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => {
  return new Promise((resolve) => resolve(fn(...args)))
})

define(Promise, 'withResolvers', () => {
  let resolve!: (value: unknown) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
})

define(URL, 'parse', (url: string | URL, base?: string | URL) => {
  try {
    return new URL(url, base)
  } catch {
    return null
  }
})

define(Uint8Array.prototype, 'toHex', function (this: Uint8Array) {
  return Array.from(this, (byte) => byte.toString(16).padStart(2, '0')).join('')
})

define(Uint8Array.prototype, 'toBase64', function (this: Uint8Array) {
  let binary = ''
  for (let i = 0; i < this.length; i += 0x8000) {
    binary += String.fromCharCode(...this.subarray(i, i + 0x8000))
  }
  return btoa(binary)
})

define(Uint8Array, 'fromBase64', (base64: string) =>
  Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
)

define(
  ArrayBuffer.prototype,
  'transferToFixedLength',
  function (this: ArrayBuffer, length = this.byteLength) {
    const copy = new Uint8Array(length)
    copy.set(new Uint8Array(this, 0, Math.min(length, this.byteLength)))
    return copy.buffer
  },
)
