import { Lock, LockOpen, Minus, Plus } from 'lucide-react'
import { IconButton } from '../components/Button'
import styles from './reader.module.css'
import { MAX_ZOOM, stepZoom, zoomLabel, type PageZoom } from './zoom'

interface ZoomBarProps {
  zoom: PageZoom
  /** The pages' size as a factor of the fit-page size. */
  factor: number
  /** The pages are bigger than the view, so locking it means something. */
  zoomed: boolean
  locked: boolean
  hidden: boolean
  onZoom: (zoom: PageZoom) => void
  onLock: (locked: boolean) => void
  onHover: (hovering: boolean) => void
}

/**
 * Zoom for page-based books (PDF, comics): out, fit (page or width), in, and once zoomed, a lock
 * that keeps the view from sliding sideways or being pinched by accident.
 */
export function ZoomBar({
  zoom,
  factor,
  zoomed,
  locked,
  hidden,
  onZoom,
  onLock,
  onHover,
}: ZoomBarProps) {
  const fitLabel = zoom === 'fit-page' ? 'Fit the width' : 'Fit the page'
  return (
    <div
      role="toolbar"
      aria-label="Zoom"
      className={styles.zoomBar}
      data-hidden={hidden || undefined}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      // Keep focus off the buttons, so the arrow keys and space still turn pages.
      onMouseDown={(e) => {
        if ((e.target as Element).closest('button')) e.preventDefault()
      }}
    >
      <IconButton
        label="Zoom out"
        disabled={zoom === 'fit-page'}
        onClick={() => onZoom(stepZoom(factor, -1))}
      >
        <Minus size={18} strokeWidth={1.9} aria-hidden="true" />
      </IconButton>
      <button
        type="button"
        className={styles.zoomLevel}
        title={fitLabel}
        aria-label={`${zoomLabel(zoom, factor)}. ${fitLabel}`}
        onClick={() => onZoom(zoom === 'fit-page' ? 'fit-width' : 'fit-page')}
      >
        {zoomLabel(zoom, factor)}
      </button>
      <IconButton
        label="Zoom in"
        disabled={factor >= MAX_ZOOM - 0.01}
        onClick={() => onZoom(stepZoom(factor, 1))}
      >
        <Plus size={18} strokeWidth={1.9} aria-hidden="true" />
      </IconButton>
      {zoomed && (
        <IconButton
          label={locked ? 'Unlock the view' : 'Lock the view'}
          title={
            locked
              ? 'Unlock the view'
              : 'Lock the view: no sideways sliding or pinching while you read down the page'
          }
          aria-pressed={locked}
          className={styles.zoomLock}
          onClick={() => onLock(!locked)}
        >
          {locked ? (
            <Lock size={17} strokeWidth={1.9} aria-hidden="true" />
          ) : (
            <LockOpen size={17} strokeWidth={1.9} aria-hidden="true" />
          )}
        </IconButton>
      )}
    </div>
  )
}
