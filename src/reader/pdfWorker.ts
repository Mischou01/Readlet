// The pdf.js worker, started by foliate.ts so the built-ins pdf.js expects are in place first.
// Imports run in order, so the polyfills are installed before the worker's code runs.

import './pdfjsPolyfills'
import 'foliate-js/vendor/pdfjs/pdf.worker.mjs'
