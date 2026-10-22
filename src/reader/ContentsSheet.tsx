import { Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { IconButton } from '../components/Button'
import { Segmented } from '../components/Fields'
import { Sheet } from '../components/Sheet'
import { formatDay, formatPercent } from '../lib/format'
import { HIGHLIGHTS, highlightColor } from '../lib/highlightColors'
import type { Annotation } from '../lib/types'
import type { TocItem } from './foliate'
import styles from './reader.module.css'

type Tab = 'contents' | 'bookmarks' | 'highlights'

interface ContentsSheetProps {
  toc: TocItem[]
  currentTocId: number | undefined
  bookmarks: Annotation[]
  highlights: Annotation[]
  onGoTo: (target: string) => void
  onDeleteBookmark: (annotation: Annotation) => void
  onClose: () => void
}

export function ContentsSheet(props: ContentsSheetProps) {
  const { toc, currentTocId, bookmarks, highlights, onGoTo } = props
  const [tab, setTab] = useState<Tab>('contents')
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (tab === 'contents') {
      list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'center' })
    }
  }, [tab])

  return (
    <Sheet title="Contents" onClose={props.onClose}>
      <div style={{ marginBottom: 14 }}>
        <Segmented
          label="Show"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'contents', label: 'Chapters' },
            {
              value: 'bookmarks',
              label: `Bookmarks${bookmarks.length ? ` ${bookmarks.length}` : ''}`,
            },
            {
              value: 'highlights',
              label: `Highlights${highlights.length ? ` ${highlights.length}` : ''}`,
            },
          ]}
        />
      </div>
      <div ref={list}>
        {tab === 'contents' &&
          (toc.length ? (
            <TocTree items={toc} depth={0} currentId={currentTocId} onGoTo={onGoTo} />
          ) : (
            <p className={styles.emptyNote}>This book has no table of contents.</p>
          ))}
        {tab === 'bookmarks' &&
          (bookmarks.length ? (
            bookmarks.map((b) => (
              <div key={b.id} className={styles.listItem}>
                <button type="button" className={styles.listItemMain} onClick={() => onGoTo(b.cfi)}>
                  <span className={styles.listMeta}>
                    {[
                      b.chapter,
                      b.fraction != null ? formatPercent(b.fraction) : null,
                      formatDay(b.createdAt),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className={styles.listText}>{b.text || 'Bookmark'}</span>
                </button>
                <IconButton label="Delete bookmark" onClick={() => props.onDeleteBookmark(b)}>
                  <Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />
                </IconButton>
              </div>
            ))
          ) : (
            <p className={styles.emptyNote}>
              No bookmarks yet. Use the bookmark button in the toolbar to mark the page you’re on.
            </p>
          ))}
        {tab === 'highlights' &&
          (highlights.length ? (
            highlights.map((h) => (
              <div key={h.id} className={styles.listItem}>
                <span
                  aria-hidden="true"
                  style={{
                    flex: 'none',
                    width: 10,
                    height: 10,
                    marginTop: 5,
                    borderRadius: 999,
                    background: HIGHLIGHTS[highlightColor(h.color)].hex,
                  }}
                />
                <button type="button" className={styles.listItemMain} onClick={() => onGoTo(h.cfi)}>
                  <span className={styles.listMeta}>
                    {[h.chapter, formatDay(h.createdAt)].filter(Boolean).join(' · ')}
                  </span>
                  <span className={styles.listText}>{h.text}</span>
                  {h.note && (
                    <span className={styles.listMeta} style={{ marginTop: 4 }}>
                      {h.note}
                    </span>
                  )}
                </button>
              </div>
            ))
          ) : (
            <p className={styles.emptyNote}>
              Select text to highlight it. Your highlights from this book show up here.
            </p>
          ))}
      </div>
    </Sheet>
  )
}

function TocTree({
  items,
  depth,
  currentId,
  onGoTo,
}: {
  items: TocItem[]
  depth: number
  currentId: number | undefined
  onGoTo: (href: string) => void
}) {
  return (
    <ul className={styles.tocList}>
      {items.map((item, i) => (
        <li key={item.id ?? `${depth}-${i}`}>
          <button
            type="button"
            className={styles.tocItem}
            style={{ paddingLeft: 12 + depth * 16 }}
            aria-current={item.id !== undefined && item.id === currentId}
            onClick={() => onGoTo(item.href)}
          >
            {item.label.trim() || 'Untitled'}
          </button>
          {item.subitems?.length ? (
            <TocTree
              items={item.subitems}
              depth={depth + 1}
              currentId={currentId}
              onGoTo={onGoTo}
            />
          ) : null}
        </li>
      ))}
    </ul>
  )
}
