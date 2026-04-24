import type { AnchorWithPreview } from './commentAnchor'

// Minimal hast shape — we avoid pulling @types/hast as a direct dep by
// narrowing to the properties this plugin actually touches.
interface HastElement {
  type: 'element'
  tagName: string
  properties?: Record<string, unknown>
  children?: HastChild[]
}
interface HastTextish {
  type: 'text' | 'comment' | 'raw' | 'doctype'
}
type HastChild = HastElement | HastTextish
interface HastRoot {
  type: 'root'
  children: HastChild[]
}

/**
 * rehype plugin that attaches `data-anchor-id` to block-level HTML elements.
 *
 * We don't re-derive anchor ids from the hast tree — we receive the pre-
 * computed list from `extractAnchors(markdown)` and assign them in document
 * order. Walking rules must stay 1:1 with `commentAnchor.walkBlocks`:
 *
 *   - h1…h6, p, pre, li, blockquote, hr, table → each anchored; don't descend
 *   - blockquote DOES descend (its inner paragraphs are separately anchored)
 *   - ul / ol → not anchored; descend (looking for li)
 *
 * The plugin is safe to feed into `rehype-sanitize` because we only add a
 * plain string attribute; the sanitize SCHEMA must whitelist `data-anchor-id`
 * on these tags for the attribute to survive the subsequent sanitize pass.
 */

type Options = { anchors: AnchorWithPreview[] }

const ANCHOR_TAGS: ReadonlySet<string> = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'pre',
  'li',
  'blockquote',
  'hr',
  'table',
])

const DESCEND_BUT_SKIP: ReadonlySet<string> = new Set([
  'ul',
  'ol',
  'blockquote',
])

function isElement(node: HastChild): node is HastElement {
  return node.type === 'element'
}

export function rehypeAnchorIds(options: Options): (tree: HastRoot) => void {
  const { anchors } = options
  return (tree) => {
    let cursor = 0
    const walk = (node: HastRoot | HastElement): void => {
      const children = node.children ?? []
      for (const child of children) {
        if (!isElement(child)) continue
        const tag = child.tagName
        if (ANCHOR_TAGS.has(tag)) {
          const a = anchors[cursor]
          cursor += 1
          if (a) {
            child.properties = child.properties ?? {}
            child.properties['dataAnchorId'] = a.anchorId
          }
          if (tag === 'blockquote') walk(child)
          // other anchored tags: don't descend — they're leaf blocks for
          // anchoring purposes, matching commentAnchor.walkBlocks.
        } else if (DESCEND_BUT_SKIP.has(tag)) {
          walk(child)
        }
        // Everything else (span, a, em, strong, code-inline, etc.) is inline
        // and doesn't get its own anchor.
      }
    }
    walk(tree)
  }
}
