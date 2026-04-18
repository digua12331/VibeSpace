/**
 * Core logic for per-project CLI config management.
 * Pure JS so it can be used by both the standalone init script and the server
 * (via an ESM import). No runtime deps.
 *
 * Responsibilities:
 *   - Locate templates and catalog (relative to repo root).
 *   - Copy template trees into a project directory.
 *   - Read/write per-project claude `settings.local.json` with catalog diff,
 *     preserving unknown entries.
 *   - Read/write per-project codex `config.toml` (minimal known-schema writer,
 *     preserves unmanaged lines verbatim).
 */

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
// lib/ → scripts/ → repo root
export const REPO_ROOT = resolve(__dirname, '..', '..')
export const TEMPLATES_ROOT = resolve(REPO_ROOT, 'templates', 'cli-configs')
export const CATALOG_PATH = resolve(TEMPLATES_ROOT, 'permission-catalog.json')

export function loadCatalog() {
  const raw = readFileSync(CATALOG_PATH, 'utf8')
  return JSON.parse(raw)
}

// --------------------------- template copy ---------------------------

function copyTreeSafe(srcDir, dstDir, { force = false } = {}) {
  const changed = []
  if (!existsSync(srcDir)) return changed
  mkdirSync(dstDir, { recursive: true })
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, entry.name)
    const dst = join(dstDir, entry.name)
    if (entry.isDirectory()) {
      changed.push(...copyTreeSafe(src, dst, { force }))
    } else if (entry.isFile()) {
      if (entry.name === '.gitkeep') continue
      if (existsSync(dst) && !force) continue
      copyFileSync(src, dst)
      changed.push(dst)
    }
  }
  return changed
}

export function copyClaudeTemplate(projectPath, { force = false, initLocal = true } = {}) {
  const src = join(TEMPLATES_ROOT, 'claude')
  const dst = join(projectPath, '.claude')
  const changed = copyTreeSafe(src, dst, { force })
  if (initLocal) {
    const example = join(src, 'settings.local.json.example')
    const target = join(dst, 'settings.local.json')
    if (existsSync(example) && (!existsSync(target) || force)) {
      copyFileSync(example, target)
      changed.push(target)
    }
  }
  return changed
}

export function copyCodexTemplate(projectPath, { force = false } = {}) {
  const src = join(TEMPLATES_ROOT, 'codex')
  const dst = join(projectPath, '.codex')
  return copyTreeSafe(src, dst, { force })
}

// --------------------------- claude settings.local.json ---------------------------

const CLAUDE_TRISTATE = ['allow', 'ask', 'deny']
const TRISTATE_OFF = 'off'

export function claudeSettingsLocalPath(projectPath) {
  return join(projectPath, '.claude', 'settings.local.json')
}

export function readClaudeLocal(projectPath) {
  const p = claudeSettingsLocalPath(projectPath)
  if (!existsSync(p)) return { permissions: { allow: [], ask: [], deny: [] } }
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'))
    if (!parsed.permissions) parsed.permissions = { allow: [], ask: [], deny: [] }
    for (const k of CLAUDE_TRISTATE) {
      if (!Array.isArray(parsed.permissions[k])) parsed.permissions[k] = []
    }
    return parsed
  } catch {
    return { permissions: { allow: [], ask: [], deny: [] } }
  }
}

// Shared (team) settings.json — read-only in our UI. Returns normalized
// permissions arrays; returns null if file missing; throws on parse error.
export function claudeSettingsSharedPath(projectPath) {
  return join(projectPath, '.claude', 'settings.json')
}

export function readClaudeShared(projectPath) {
  const p = claudeSettingsSharedPath(projectPath)
  if (!existsSync(p)) return null
  const raw = readFileSync(p, 'utf8')
  const parsed = JSON.parse(raw) // let the caller see the throw
  const perm = parsed.permissions ?? {}
  const out = { allow: [], ask: [], deny: [] }
  for (const k of CLAUDE_TRISTATE) {
    if (Array.isArray(perm[k])) out[k] = perm[k].slice()
  }
  return out
}

/**
 * File-system probe for a project:
 *   - folder presence for .claude and .codex
 *   - file presence + size for settings.json / settings.local.json / config.toml
 *   - parse error messages if the JSON/TOML is malformed
 */
export function probeProjectCliFiles(projectPath) {
  const claudeDir = join(projectPath, '.claude')
  const codexDir = join(projectPath, '.codex')
  const settingsPath = claudeSettingsSharedPath(projectPath)
  const localPath = claudeSettingsLocalPath(projectPath)
  const codexPath = codexConfigPath(projectPath)

  const probe = (p) => {
    if (!existsSync(p)) return { exists: false }
    try {
      const st = statSync(p)
      return { exists: true, size: st.size, mtimeMs: st.mtimeMs }
    } catch (e) {
      return { exists: true, error: String(e && e.message || e) }
    }
  }

  const out = {
    claudeDir: { exists: existsSync(claudeDir) && isDir(claudeDir) },
    codexDir: { exists: existsSync(codexDir) && isDir(codexDir) },
    claudeSettings: probe(settingsPath),
    claudeLocal: probe(localPath),
    codexConfig: probe(codexPath),
  }

  // JSON parse checks
  for (const key of ['claudeSettings', 'claudeLocal']) {
    const info = out[key]
    if (info.exists) {
      try {
        JSON.parse(readFileSync(key === 'claudeSettings' ? settingsPath : localPath, 'utf8'))
      } catch (e) {
        info.parseError = String(e && e.message || e)
      }
    }
  }

  return out
}

function isDir(p) {
  try { return statSync(p).isDirectory() } catch { return false }
}

/** Expand a catalog item value (string | string[]) to a list of raw permission entries. */
function expandValue(v) {
  return Array.isArray(v) ? v.slice() : [v]
}

/**
 * Claude Code accepts several equivalent Bash glob forms:
 *   - `Bash(pnpm:*)` — colon-glob (newer docs)
 *   - `Bash(pnpm *)` — space-glob (older)
 *   - `Bash(pnpm)`   — exact command
 * The first two are semantically equivalent. Return every canonical string
 * that should be treated as matching the given one. Non-Bash values pass through.
 */
function equivalentForms(v) {
  const forms = new Set([v])
  const m = typeof v === 'string' && v.match(/^Bash\((.*)\)$/)
  if (m) {
    const inner = m[1]
    // colon-glob ↔ space-glob
    if (inner.endsWith(':*')) {
      forms.add('Bash(' + inner.slice(0, -2) + ' *)')
    } else if (inner.endsWith(' *')) {
      forms.add('Bash(' + inner.slice(0, -2) + ':*)')
    }
  }
  return [...forms]
}

export function catalogKnownClaudeValues(catalog) {
  const set = new Set()
  for (const g of catalog.claude.groups) {
    for (const it of g.items) {
      for (const v of expandValue(it.value)) {
        for (const form of equivalentForms(v)) set.add(form)
      }
    }
  }
  return set
}

/** Compute the per-item tristate for the UI, plus a list of custom entries. */
export function diffClaudeAgainstCatalog(catalog, localSettings) {
  const known = catalogKnownClaudeValues(catalog)
  const perm = localSettings.permissions ?? {}
  const selections = {} // id -> 'allow' | 'ask' | 'deny' | 'off'
  for (const g of catalog.claude.groups) {
    for (const it of g.items) {
      const values = expandValue(it.value)
      let state = TRISTATE_OFF
      for (const which of CLAUDE_TRISTATE) {
        const arr = perm[which] ?? []
        // Each catalog value counts as "present" if any of its equivalent forms
        // is in the array. All must be present for the item to be selected.
        const allPresent = values.every((v) =>
          equivalentForms(v).some((f) => arr.includes(f)),
        )
        if (allPresent) { state = which; break }
      }
      selections[it.id] = state
    }
  }
  const custom = { allow: [], ask: [], deny: [] }
  for (const which of CLAUDE_TRISTATE) {
    for (const v of perm[which] ?? []) {
      if (!known.has(v)) custom[which].push(v)
    }
  }
  return { selections, custom }
}

/**
 * Merge new UI selections back into the file, preserving:
 *   - any top-level keys (hooks, env, model, …)
 *   - any `allow/ask/deny` entries not in the catalog (user's custom rules)
 *
 * Selections is { [itemId]: 'allow'|'ask'|'deny'|'off' }.
 * `customOverride` (optional) replaces the custom portion entirely.
 */
export function writeClaudeLocal(projectPath, catalog, selections, customOverride) {
  const p = claudeSettingsLocalPath(projectPath)
  const existing = readClaudeLocal(projectPath)
  const known = catalogKnownClaudeValues(catalog)

  const nextArrays = { allow: [], ask: [], deny: [] }

  // 1) preserve unknown (custom) entries
  if (customOverride) {
    for (const w of CLAUDE_TRISTATE) nextArrays[w] = (customOverride[w] ?? []).slice()
  } else {
    for (const w of CLAUDE_TRISTATE) {
      for (const v of existing.permissions?.[w] ?? []) {
        if (!known.has(v)) nextArrays[w].push(v)
      }
    }
  }

  // 2) apply catalog selections. When writing, emit only the canonical form
  //    (catalog `value`) and strip any equivalent forms from all three arrays
  //    so toggling an item doesn't leave a duplicate behind.
  const byId = {}
  for (const g of catalog.claude.groups) for (const it of g.items) byId[it.id] = it
  for (const [itemId, state] of Object.entries(selections ?? {})) {
    if (!CLAUDE_TRISTATE.includes(state) && state !== TRISTATE_OFF) continue
    const it = byId[itemId]
    if (!it) continue
    const canonicals = expandValue(it.value)
    // Remove every equivalent form from every tristate bucket first.
    for (const canon of canonicals) {
      const forms = new Set(equivalentForms(canon))
      for (const w of CLAUDE_TRISTATE) {
        nextArrays[w] = nextArrays[w].filter((x) => !forms.has(x))
      }
    }
    if (state === TRISTATE_OFF) continue
    for (const canon of canonicals) {
      if (!nextArrays[state].includes(canon)) nextArrays[state].push(canon)
    }
  }

  const next = { ...existing }
  next.permissions = { ...(existing.permissions ?? {}), ...nextArrays }

  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(next, null, 2) + '\n', 'utf8')
  return p
}

// --------------------------- codex config.toml ---------------------------

export function codexConfigPath(projectPath) {
  return join(projectPath, '.codex', 'config.toml')
}

/**
 * Minimal TOML read for our known schema. Returns:
 *   { managed: { path: value, ... }, preservedLines: string[] }
 * Unknown key=value lines and unknown sections are preserved verbatim.
 */
function parseCodexToml(text, managedPaths) {
  const lines = text.split(/\r?\n/)
  const managedSet = new Set(managedPaths)
  const managed = {}
  const preserved = []
  let section = ''
  let inArray = false
  let arrayKey = ''
  let arrayBuf = ''

  const flushArray = () => {
    if (!inArray) return
    const path = section ? `${section}.${arrayKey}` : arrayKey
    if (managedSet.has(path)) {
      managed[path] = parseTomlStringArray(arrayBuf)
    } else {
      preserved.push(...arrayBuf.split('\n'))
    }
    inArray = false
    arrayKey = ''
    arrayBuf = ''
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\uFEFF/g, '')
    if (inArray) {
      arrayBuf += '\n' + line
      if (line.includes(']')) flushArray()
      continue
    }
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) { preserved.push(line); continue }
    const sec = trimmed.match(/^\[([^\]]+)\]$/)
    if (sec) {
      section = sec[1].trim()
      preserved.push(line)
      continue
    }
    const kv = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*(.*)$/)
    if (!kv) { preserved.push(line); continue }
    const key = kv[1]
    const rest = kv[2]
    const path = section ? `${section}.${key}` : key
    if (rest.trimStart().startsWith('[') && !rest.trimStart().includes(']')) {
      // multi-line array start
      inArray = true
      arrayKey = key
      arrayBuf = rest
      continue
    }
    if (managedSet.has(path)) {
      managed[path] = parseTomlScalarOrArray(rest)
    } else {
      preserved.push(line)
    }
  }
  flushArray()
  return { managed, preserved }
}

function parseTomlScalarOrArray(s) {
  const t = s.trim().replace(/\s*#.*$/, '').trim()
  if (t === 'true') return true
  if (t === 'false') return false
  if (t.startsWith('[') && t.endsWith(']')) return parseTomlStringArray(t)
  const m = t.match(/^"((?:[^"\\]|\\.)*)"$/) || t.match(/^'([^']*)'$/)
  if (m) return m[1]
  if (/^-?\d+$/.test(t)) return Number(t)
  if (/^-?\d*\.\d+$/.test(t)) return Number(t)
  return t
}

function parseTomlStringArray(blob) {
  const inner = blob.replace(/^\s*\[/, '').replace(/\][\s#]*.*$/s, '')
  const out = []
  for (const raw of inner.split(',')) {
    const t = raw.trim().replace(/\s*#.*$/, '').trim()
    if (!t) continue
    const m = t.match(/^"((?:[^"\\]|\\.)*)"$/) || t.match(/^'([^']*)'$/)
    if (m) out.push(m[1])
    else if (t) out.push(t)
  }
  return out
}

function tomlQuoteString(v) {
  return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

function tomlScalar(v) {
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return String(v)
  return tomlQuoteString(v)
}

function tomlStringArray(arr) {
  if (!arr.length) return '[]'
  return '[\n' + arr.map((x) => '  ' + tomlQuoteString(x)).join(',\n') + '\n]'
}

function managedPathsFromCatalog(catalog) {
  return catalog.codex.fields.map((f) => f.path)
}

export function readCodexConfig(projectPath, catalog) {
  const p = codexConfigPath(projectPath)
  const managedPaths = managedPathsFromCatalog(catalog)
  if (!existsSync(p)) {
    return { values: {}, managedPaths, raw: '' }
  }
  const text = readFileSync(p, 'utf8')
  const { managed } = parseCodexToml(text, managedPaths)
  return { values: managed, managedPaths, raw: text }
}

/**
 * Build value-by-path map from UI-friendly object (nested keys → dot paths).
 * Accepts either dot-path keyed object or nested-object; we accept dot-path.
 */
export function writeCodexConfig(projectPath, catalog, valuesByPath) {
  const p = codexConfigPath(projectPath)
  const managedPaths = managedPathsFromCatalog(catalog)
  const existing = existsSync(p) ? readFileSync(p, 'utf8') : ''
  const { preserved } = parseCodexToml(existing, managedPaths)

  // Group managed by section
  const fieldByPath = Object.fromEntries(catalog.codex.fields.map((f) => [f.path, f]))
  const sections = {} // sectionName → [{key, rendered}]
  const orderTopLevel = []
  const orderBySection = {}

  for (const f of catalog.codex.fields) {
    const full = f.path
    const lastDot = full.lastIndexOf('.')
    const section = lastDot < 0 ? '' : full.slice(0, lastDot)
    const key = lastDot < 0 ? full : full.slice(lastDot + 1)
    if (section === '') orderTopLevel.push(key)
    else (orderBySection[section] ||= []).push(key)
  }

  const outLines = []
  outLines.push('# Codex CLI project config — managed by aimon UI')
  outLines.push('')

  // top-level
  for (const key of orderTopLevel) {
    const v = valuesByPath[key]
    if (v === undefined || v === null || v === '') continue
    const f = fieldByPath[key]
    outLines.push(`${key} = ${renderValueForField(f, v)}`)
  }
  if (orderTopLevel.some((k) => valuesByPath[k] !== undefined && valuesByPath[k] !== null && valuesByPath[k] !== '')) {
    outLines.push('')
  }

  // sections
  for (const [section, keys] of Object.entries(orderBySection)) {
    const anyPresent = keys.some((k) => {
      const v = valuesByPath[`${section}.${k}`]
      return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)
    })
    if (!anyPresent) continue
    outLines.push(`[${section}]`)
    for (const key of keys) {
      const full = `${section}.${key}`
      const v = valuesByPath[full]
      if (v === undefined || v === null || v === '') continue
      if (Array.isArray(v) && v.length === 0) continue
      const f = fieldByPath[full]
      outLines.push(`${key} = ${renderValueForField(f, v)}`)
    }
    outLines.push('')
  }

  // preserved (unknown) lines appended at the end
  const preservedTrimmed = preserved.join('\n').trim()
  if (preservedTrimmed) {
    outLines.push('# --- preserved (not managed by aimon UI) ---')
    outLines.push(preservedTrimmed)
    outLines.push('')
  }

  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, outLines.join('\n'), 'utf8')
  return p
}

function renderValueForField(field, v) {
  if (!field) return tomlScalar(v)
  if (field.kind === 'bool') return v ? 'true' : 'false'
  if (field.kind === 'stringList') return tomlStringArray(Array.isArray(v) ? v : [])
  if (field.kind === 'single') return tomlQuoteString(String(v))
  return tomlScalar(v)
}
