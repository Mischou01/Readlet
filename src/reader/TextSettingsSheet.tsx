import { Check, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { FieldLabel, Segmented, Switch } from '../components/Fields'
import { Sheet } from '../components/Sheet'
import { usePhoneLayout } from '../lib/platform'
import {
  FONT_SIZES,
  usePreferences,
  type LineSpacing,
  type Margins,
  type ReadingFont,
  type ReadingThemeId,
} from '../state/preferences'
import { FONT_STACKS } from './readingStyles'
import styles from './reader.module.css'
import { READING_THEMES } from './themes'

const THEME_OPTIONS: { id: ReadingThemeId; name: string; swatch: string; ink: string }[] = [
  ...Object.values(READING_THEMES).map((t) => ({
    id: t.id,
    name: t.name,
    swatch: t.bg,
    ink: t.ink,
  })),
  {
    id: 'system',
    name: 'Auto',
    swatch: `linear-gradient(135deg, ${READING_THEMES.paper.bg} 50%, ${READING_THEMES.dusk.bg} 50%)`,
    ink: '#8C8697',
  },
]

const FONTS: { id: ReadingFont; name: string; stack: string }[] = [
  { id: 'literata', name: 'Literata', stack: FONT_STACKS.literata },
  { id: 'newsreader', name: 'Newsreader', stack: FONT_STACKS.newsreader },
  { id: 'atkinson', name: 'Atkinson Hyperlegible Next', stack: FONT_STACKS.atkinson },
  { id: 'publisher', name: 'Book’s own font', stack: 'Georgia, "Times New Roman", serif' },
]

const SPACINGS: { value: LineSpacing; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'airy', label: 'Airy' },
]

const MARGINS: { value: Margins; label: string }[] = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'medium', label: 'Medium' },
  { value: 'wide', label: 'Wide' },
]

export function TextSettingsSheet({
  onClose,
  fixedLayout,
}: {
  onClose: () => void
  fixedLayout: boolean
}) {
  const reader = usePreferences((s) => s.prefs.reader)
  const update = usePreferences((s) => s.update)
  const phone = usePhoneLayout()
  // On a phone the sheet opens short, with what's changed most, so the page shows above it.
  const [more, setMore] = useState(!phone)
  const sizeIndex = Math.max(0, FONT_SIZES.indexOf(reader.fontSize))
  const setSize = (i: number) => {
    const size = FONT_SIZES[Math.min(FONT_SIZES.length - 1, Math.max(0, i))]
    if (size) update({ reader: { fontSize: size } })
  }

  return (
    <Sheet title="Text" onClose={onClose}>
      <div className={styles.sheetSection}>
        <FieldLabel id="theme-label">Theme</FieldLabel>
        <div className={styles.themes} role="radiogroup" aria-labelledby="theme-label">
          {THEME_OPTIONS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={reader.theme === t.id}
              className={styles.themeButton}
              onClick={() => update({ reader: { theme: t.id } })}
            >
              <span
                className={styles.themeSwatch}
                style={{ background: t.swatch, color: t.ink }}
                aria-hidden="true"
              >
                Aa
              </span>
              {t.name}
            </button>
          ))}
        </div>
      </div>

      {fixedLayout ? (
        <p className={styles.emptyNote}>
          This book has a fixed layout, so its fonts and spacing can’t be changed. The theme still
          applies to the space around the pages.
        </p>
      ) : (
        <>
          <div className={styles.sheetSection}>
            <div className={styles.labelRow}>
              <FieldLabel id="size-label">Size</FieldLabel>
              <span>{reader.fontSize}px</span>
            </div>
            <div className={styles.sizeRow}>
              <button
                type="button"
                className={styles.sizeButton}
                style={{ fontSize: 14 }}
                aria-label="Smaller text"
                disabled={sizeIndex === 0}
                onClick={() => setSize(sizeIndex - 1)}
              >
                A
              </button>
              <input
                className={styles.slider}
                type="range"
                min={0}
                max={FONT_SIZES.length - 1}
                step={1}
                value={sizeIndex}
                aria-labelledby="size-label"
                aria-valuetext={`${reader.fontSize} pixels`}
                onChange={(e) => setSize(Number(e.target.value))}
              />
              <button
                type="button"
                className={styles.sizeButton}
                style={{ fontSize: 21 }}
                aria-label="Larger text"
                disabled={sizeIndex === FONT_SIZES.length - 1}
                onClick={() => setSize(sizeIndex + 1)}
              >
                A
              </button>
            </div>
          </div>

          <div className={styles.sheetSection}>
            <FieldLabel>Line spacing</FieldLabel>
            <Segmented
              label="Line spacing"
              value={reader.spacing}
              options={SPACINGS}
              onChange={(spacing) => update({ reader: { spacing } })}
            />
          </div>

          {more ? (
            <>
              <div className={styles.sheetSection}>
                <FieldLabel id="font-label">Font</FieldLabel>
                <div className={styles.fontList} role="radiogroup" aria-labelledby="font-label">
                  {FONTS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      role="radio"
                      aria-checked={reader.font === f.id}
                      className={styles.fontOption}
                      onClick={() => update({ reader: { font: f.id } })}
                    >
                      <span style={{ fontFamily: f.stack }}>{f.name}</span>
                      {reader.font === f.id && (
                        <Check size={16} strokeWidth={2.2} aria-hidden="true" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.sheetSection}>
                <FieldLabel>Margins</FieldLabel>
                <Segmented
                  label="Margins"
                  value={reader.margins}
                  options={MARGINS}
                  onChange={(margins) => update({ reader: { margins } })}
                />
              </div>

              <div className={styles.sheetSection} style={{ gap: 2 }}>
                <Switch
                  label="Justify and hyphenate"
                  checked={reader.justify}
                  onChange={(justify) => update({ reader: { justify } })}
                />
                <Switch
                  label="Scroll instead of turning pages"
                  checked={reader.scrolled}
                  onChange={(scrolled) => update({ reader: { scrolled } })}
                />
                {/* A phone is never wide enough. */}
                {!phone && (
                  <Switch
                    label="Two pages on wide windows"
                    checked={reader.spread}
                    onChange={(spread) => update({ reader: { spread } })}
                  />
                )}
                <Switch
                  label="Slide when turning pages"
                  checked={reader.animatePages}
                  onChange={(animatePages) => update({ reader: { animatePages } })}
                />
              </div>
            </>
          ) : (
            <button type="button" className={styles.moreButton} onClick={() => setMore(true)}>
              More options
              <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
            </button>
          )}
        </>
      )}
    </Sheet>
  )
}
