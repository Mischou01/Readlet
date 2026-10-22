// Reading sessions and goals, loaded from every device's files.

import { create } from 'zustand'
import { api, toAppError } from '../lib/ipc'
import type { AppError, Profile, Session, YearlyGoal } from '../lib/types'

export const DEFAULT_DAILY_MINUTES = 30
export const DEFAULT_YEARLY_GOAL: YearlyGoal = { unit: 'books', target: 24 }

interface StatsState {
  sessions: Session[]
  profile: Profile
  loaded: boolean
  error: AppError | null
  load: () => Promise<void>
  refreshSessions: () => Promise<void>
  refreshProfile: () => Promise<void>
  /** Adds (or replaces) a session recorded on this device. */
  putSession: (session: Session) => void
  setDailyGoal: (minutes: number) => Promise<void>
  setYearlyGoal: (goal: YearlyGoal) => Promise<void>
}

/** Sessions from the start of last year, enough for this year's stats and a comparison. */
function since(): number {
  return new Date(new Date().getFullYear() - 1, 0, 1).getTime()
}

export const useStats = create<StatsState>((set, get) => ({
  sessions: [],
  profile: { dailyMinutes: null, yearlyGoal: null },
  loaded: false,
  error: null,
  load: async () => {
    try {
      const [sessions, profile] = await Promise.all([api.listSessions(since()), api.getProfile()])
      set({ sessions, profile, loaded: true, error: null })
    } catch (e) {
      set({ error: toAppError(e), loaded: true })
    }
  },
  refreshSessions: async () => set({ sessions: await api.listSessions(since()) }),
  refreshProfile: async () => set({ profile: await api.getProfile() }),
  putSession: (session) =>
    set({ sessions: [...get().sessions.filter((s) => s.id !== session.id), session] }),
  setDailyGoal: async (minutes) => set({ profile: await api.setDailyGoal(minutes) }),
  setYearlyGoal: async (goal) => set({ profile: await api.setYearlyGoal(goal) }),
}))

export function useDailyGoal(): number {
  return useStats((s) => s.profile.dailyMinutes?.value ?? DEFAULT_DAILY_MINUTES)
}

export function useYearlyGoal(): YearlyGoal {
  return useStats((s) => s.profile.yearlyGoal?.value ?? DEFAULT_YEARLY_GOAL)
}
