import { fromMarkdown } from 'mdast-util-from-markdown'
import { toString as mdToString } from 'mdast-util-to-string'
import type { CommentAnchor } from './types'

/**
 * Anchor generation for markdown comments. Walks the mdast root and emits a
 * stable anchor per block-level node. Two goals:
 *   1. Stable across *nearby* edits: adding a paragraph up-top shouldn't
 *      invalidate every comment below. We achieve this by primary-matching
 *      on contentHash (same text → same anchor).
 *   2. Graceful degradation: if content changed but block position didn't,
 *      fall back to (blockType, index). Comments fall into "orphan" bucket
 *      only when both signals fail.
 *
 * We intentionally do NOT try to be clever (fuzzy / Levenshtein / CRDT) —
 * the single-user MVP can tolerate occasional orphaning.
 */

/** mdast node types we surface as comment-able blocks. Keep in docIteration order. */
const BLOCK_TYPES: ReadonlySet<string> = new Set([
  'heading',
  'paragraph',
  'code',
  'blockquote',
  'listItem',
  'thematicBreak',
  'table',
])

export interface AnchorWithPreview extends CommentAnchor {}

interface MinimalMdastNode {
  type: string
  depth?: number
  children?: MinimalMdastNode[]
}

/**
 * Ordered 32-bit FNV-1a. Short, cheap, good enough for "did this block's text
 * change?" — not a crypto primitive. Output is 8 lowercase hex digits.
 */
export function hashText(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // Force unsigned and pad to 8 hex chars.
  return (h >>> 0).toString(16).padStart(8, '0')
}

function blockTypeFor(node: MinimalMdastNode): string {
  if (node.type === 'heading') return `h${node.depth ?? 1}`
  if (node.type === 'listItem') return 'li'
  if (node.type === 'blockquote') return 'blockquote'
  if (node.type === 'code') return 'code'
  if (node.type === 'thematicBreak') return 'hr'
  if (node.type === 'table') return 'table'
  return 'p' // paragraph and anything else that slipped through
}

function truncatePreview(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  return trimmed.length > 80 ? trimmed.slice(0, 80) + '…' : trimmed
}

/**
 * Flatten the mdast tree into a list of comment-able blocks in document order.
 * Nested blocks (list items inside lists, paragraphs inside blockquotes) are
 * each emitted once — the parent emits itself (e.g. `blockquote`) AND its
 * block children bubble up too. This matches what a reader would intuitively
 * call "a block they want to leave a comment on."
 */
function walkBlocks(root: MinimalMdastNode): MinimalMdastNode[] {
  const out: MinimalMdastNode[] = []
  function visit(node: MinimalMdastNode, isRoot: boolean): void {
    if (!isRoot && BLOCK_TYPES.has(node.type)) {
      out.push(node)
    }
    // Descend into container-ish nodes so nested blocks (list items, blockquote
    // paragraphs) are still addressable.
    if (node.type === 'list' || node.type === 'blockquote' || isRoot) {
      for (const c of node.children ?? []) visit(c, false)
    }
  }
  visit(root, true)
  return out
}

export function extractAnchors(markdown: string): AnchorWithPreview[] {
  let tree: MinimalMdastNode
  try {
    // mdast-util-from-markdown returns a typed Root but we only need the
    // minimal shape above — casting avoids pulling @types/mdast here.
    tree = fromMarkdown(markdown) as unknown as MinimalMdastNode
  } catch {
    return []
  }
  const blocks = walkBlocks(tree)
  const anchors: AnchorWithPreview[] = []
  const typeCounters = new Map<string, number>()
  for (const b of blocks) {
    const blockType = blockTypeFor(b)
    const idx = typeCounters.get(blockType) ?? 0
    typeCounters.set(blockType, idx + 1)
    const text = mdToString(b as never)
    const contentHash = hashText(text)
    const textPreview = truncatePreview(text)
    anchors.push({
      anchorId: `${blockType}-${idx}-${contentHash}`,
      blockType,
      index: idx,
      contentHash,
      textPreview,
    })
  }
  return anchors
}

/**
 * Match a stored anchor against the current set of anchors.
 *
 * - Primary: same contentHash (even if the block moved)
 * - Fallback: same (blockType, index) (content edited but structural position
 *   is stable)
 * - Else: null → caller should render as orphan
 */
export function matchAnchor(
  stored: CommentAnchor,
  fresh: AnchorWithPreview[],
): AnchorWithPreview | null {
  const byHash = fresh.find((a) => a.contentHash === stored.contentHash)
  if (byHash) return byHash
  const byPos = fresh.find(
    (a) => a.blockType === stored.blockType && a.index === stored.index,
  )
  if (byPos) return byPos
  return null
}
