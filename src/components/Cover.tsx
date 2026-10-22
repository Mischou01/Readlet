import { Lock } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { generatedCoverBackground } from '../lib/coverArt'
import type { BookEntry } from '../lib/types'
import { coverUrl } from '../lib/urls'
import { FALLBACK_PALETTE } from '../theme/aura'
import styles from './Cover.module.css'

interface CoverProps {
  entry: BookEntry
  title: string
  authors: string[]
  width: number
  large?: boolean
  className?: string
  style?: CSSProperties
}

/** A book cover at a 2:3 ratio: the real one if the book has it, a generated one otherwise. */
export function Cover({ entry, title, authors, width, large, className, style }: CoverProps) {
  const [failed, setFailed] = useState(false)
  const hasImage = entry.coverVersion != null && !failed
  const background = hasImage
    ? undefined
    : generatedCoverBackground(entry.fingerprint, entry.palette ?? FALLBACK_PALETTE)
  return (
    <span
      className={[styles.cover, large ? styles.large : '', className ?? ''].join(' ')}
      style={{ width, height: Math.round(width * 1.5), background, ...style }}
      aria-hidden="true"
    >
      {hasImage ? (
        <img
          className={styles.image}
          src={coverUrl(entry.fingerprint, entry.coverVersion ?? 0)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <span className={styles.title}>{title}</span>
          {authors[0] && <span className={styles.author}>{authors[0]}</span>}
        </>
      )}
      <span className={styles.spine} />
      {entry.drm && (
        <span className={styles.lock} title="Protected by DRM">
          <Lock size={13} />
        </span>
      )}
    </span>
  )
}
