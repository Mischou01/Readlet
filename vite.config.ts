/// <reference types="vitest/config" />
import { cp } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))
const foliateDir = `${root}vendor/foliate-js`
const host = process.env.TAURI_DEV_HOST

/**
 * foliate-js's PDF adapter loads the pdf.js worker, CSS, CMaps and standard fonts relative to its
 * own module URL. Bundled chunks live in `dist/assets/`, so copy those files next to them.
 */
function copyPdfjsAssets(): Plugin {
  const files = [
    'pdf.worker.mjs',
    'text_layer_builder.css',
    'annotation_layer_builder.css',
    'cmaps',
    'standard_fonts',
  ]
  return {
    name: 'readlet:copy-pdfjs-assets',
    apply: 'build',
    async writeBundle(options) {
      const outDir = options.dir ?? `${root}dist`
      await Promise.all(
        files.map((file) =>
          cp(`${foliateDir}/vendor/pdfjs/${file}`, `${outDir}/assets/vendor/pdfjs/${file}`, {
            recursive: true,
          }),
        ),
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), copyPdfjsAssets()],
  resolve: {
    alias: [{ find: /^foliate-js\/(.*)$/, replacement: `${foliateDir}/$1` }],
  },
  // Tauri expects a fixed port and its own console output.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    // WebKitGTK and WKWebView are Safari-class engines; WebView2 is Chromium.
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome120' : 'safari16',
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    chunkSizeWarningLimit: 2048,
  },
  test: {
    // Pure logic by default; a test that needs a DOM opts in with `// @vitest-environment jsdom`.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
})
