// Short-lived status messages ("Highlight added", errors) shown at the bottom of the window.

import { create } from 'zustand'

export interface ToastAction {
  label: string
  run: () => void
}

export interface Toast {
  id: number
  message: string
  tone: 'info' | 'error'
  /** A colour dot shown before the message (e.g. the highlight colour). */
  swatch?: string
  action?: ToastAction
}

interface ToastState {
  toasts: Toast[]
  show: (
    toast: Omit<Toast, 'id' | 'tone'> & { tone?: Toast['tone']; durationMs?: number },
  ) => number
  dismiss: (id: number) => void
}

let nextId = 1

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  show: ({ durationMs, tone = 'info', ...toast }) => {
    const id = nextId++
    // One toast at a time keeps the bottom of the page calm.
    set({ toasts: [{ ...toast, tone, id }] })
    setTimeout(() => get().dismiss(id), durationMs ?? (tone === 'error' ? 8000 : 5000))
    return id
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export function showError(message: string) {
  useToasts.getState().show({ message, tone: 'error' })
}
