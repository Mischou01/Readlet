import { useId, useState, type FormEvent } from 'react'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import { FieldLabel, Segmented } from '../components/Fields'
import fields from '../components/fields.module.css'
import { toAppError } from '../lib/ipc'
import type { GoalUnit } from '../lib/types'
import { useDailyGoal, useStats, useYearlyGoal } from '../state/stats'
import { showError } from '../state/toasts'

const UNITS = [
  { value: 'books', label: 'Books' },
  { value: 'minutes', label: 'Hours' },
] as const

/** Parses a whole number within `[min, max]`, or returns `null`. */
function wholeNumber(text: string, min: number, max: number): number | null {
  if (!/^\s*\d+\s*$/.test(text)) return null
  const value = Number(text)
  return value >= min && value <= max ? value : null
}

/** Changes the daily minutes goal and the goal for the year. */
export function GoalDialog({ onClose }: { onClose: () => void }) {
  const daily = useDailyGoal()
  const yearly = useYearlyGoal()
  const [unit, setUnit] = useState<GoalUnit>(yearly.unit)
  const [dailyText, setDailyText] = useState(String(daily))
  const [yearlyText, setYearlyText] = useState(
    String(yearly.unit === 'minutes' ? Math.round(yearly.target / 60) : yearly.target),
  )
  const [saving, setSaving] = useState(false)
  const dailyId = useId()
  const yearlyId = useId()

  const dailyValue = wholeNumber(dailyText, 1, 24 * 60)
  const yearlyValue = wholeNumber(yearlyText, 1, unit === 'books' ? 10_000 : 8_760)
  const valid = dailyValue !== null && yearlyValue !== null

  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    if (dailyValue === null || yearlyValue === null) return
    setSaving(true)
    const target = unit === 'minutes' ? yearlyValue * 60 : yearlyValue
    try {
      const stats = useStats.getState()
      if (dailyValue !== daily) await stats.setDailyGoal(dailyValue)
      if (unit !== yearly.unit || target !== yearly.target) {
        await stats.setYearlyGoal({ unit, target })
      }
      onClose()
    } catch (err) {
      showError(`Couldn’t save your goals: ${toAppError(err).message}`)
      setSaving(false)
    }
  }

  return (
    <Dialog
      title="Reading goals"
      description="Goals sync with your books folder, so every device shares them."
      onClose={onClose}
      actions={
        <>
          <Button size="small" variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="small"
            variant="primary"
            disabled={!valid || saving}
            onClick={() => void save()}
          >
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => void save(e)} style={{ marginTop: 20, display: 'grid', gap: 20 }}>
        <div>
          <FieldLabel id={dailyId}>Minutes a day</FieldLabel>
          <input
            className={fields.textInput}
            aria-labelledby={dailyId}
            inputMode="numeric"
            value={dailyText}
            aria-invalid={dailyValue === null}
            onChange={(e) => setDailyText(e.target.value)}
          />
        </div>
        <div>
          <FieldLabel id={yearlyId}>This year</FieldLabel>
          <Segmented
            label="Count the yearly goal in"
            value={unit}
            options={UNITS}
            onChange={setUnit}
          />
          <input
            className={fields.textInput}
            style={{ marginTop: 10 }}
            aria-labelledby={yearlyId}
            aria-describedby={`${yearlyId}-unit`}
            inputMode="numeric"
            value={yearlyText}
            aria-invalid={yearlyValue === null}
            onChange={(e) => setYearlyText(e.target.value)}
          />
          <span id={`${yearlyId}-unit`} hidden>
            {unit === 'books' ? 'books' : 'hours'}
          </span>
        </div>
        {/* Enter in a field submits. */}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
