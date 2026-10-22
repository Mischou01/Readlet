import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect } from 'react'
import { useApp, type OpeningCover as Opening } from '../state/app'
import { usePreferences } from '../state/preferences'
import { useSystemColorScheme } from '../theme/aura'
import styles from './opening.module.css'
import { resolveReadingTheme } from './themes'

const EASE = [0.22, 1, 0.36, 1] as const
/** If the reader never reports back (it failed to mount, say), don't cover the window forever. */
const GIVE_UP_MS = 10_000

/**
 * The "open book" moment (docs/PLAN.md §5): the cover you clicked grows into the page and fades
 * into the reading theme's paper, then dissolves once the book is on screen. It lives above the
 * views so it carries on while the library gives way to the reader.
 */
export function OpeningCoverLayer() {
  const opening = useApp((s) => s.opening)
  return (
    <AnimatePresence>
      {opening && <OpeningCover key={opening.fingerprint} opening={opening} />}
    </AnimatePresence>
  )
}

function OpeningCover({ opening }: { opening: Opening }) {
  const reduceMotion = useReducedMotion()
  const themeId = usePreferences((s) => s.prefs.reader.theme)
  const page = resolveReadingTheme(themeId, useSystemColorScheme()).bg

  useEffect(() => {
    const timer = setTimeout(() => {
      if (useApp.getState().opening === opening) useApp.getState().setOpening(null)
    }, GIVE_UP_MS)
    return () => clearTimeout(timer)
  }, [opening])

  const { x, y, width, height } = opening.rect
  const full = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight, borderRadius: 0 }
  return (
    <motion.div
      className={styles.layer}
      aria-hidden="true"
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      <motion.div
        className={styles.cover}
        initial={reduceMotion ? full : { x, y, width, height, borderRadius: 8 }}
        animate={full}
        transition={{ duration: 0.55, ease: EASE }}
        style={{ background: opening.background ?? undefined }}
      >
        {opening.image && <img src={opening.image} alt="" className={styles.image} />}
        <motion.div
          className={styles.page}
          style={{ background: page }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: reduceMotion ? 0 : 0.28, duration: 0.32, ease: 'easeOut' }}
        />
      </motion.div>
    </motion.div>
  )
}
