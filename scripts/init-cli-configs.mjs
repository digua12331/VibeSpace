#!/usr/bin/env node
/**
 * One-shot CLI: copy the aimon templates into a project directory.
 *
 * Usage:
 *   node scripts/init-cli-configs.mjs <projectPath> [--claude] [--codex] [--both] [--force] [--no-local]
 *
 * Defaults: --both  --local (creates settings.local.json from example)
 */
import { statSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { copyClaudeTemplate, copyCodexTemplate, TEMPLATES_ROOT } from './lib/cli-configs-core.mjs'

function parseArgs(argv) {
  const out = { target: null, claude: false, codex: false, force: false, initLocal: true }
  const flags = new Set()
  const positional = []
  for (const a of argv) {
    if (a.startsWith('--')) flags.add(a)
    else positional.push(a)
  }
  out.target = positional[0] ?? null
  const both = flags.has('--both') || (!flags.has('--claude') && !flags.has('--codex'))
  out.claude = both || flags.has('--claude')
  out.codex = both || flags.has('--codex')
  out.force = flags.has('--force')
  if (flags.has('--no-local')) out.initLocal = false
  return out
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.target) {
    console.error('usage: init-cli-configs.mjs <projectPath> [--claude|--codex|--both] [--force] [--no-local]')
    process.exit(2)
  }
  const target = resolve(args.target)
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    console.error(`not a directory: ${target}`)
    process.exit(2)
  }
  console.log(`aimon init-cli-configs`)
  console.log(`  templates: ${TEMPLATES_ROOT}`)
  console.log(`  target   : ${target}`)
  console.log(`  variants : ${[args.claude && 'claude', args.codex && 'codex'].filter(Boolean).join(', ')}`)
  console.log(`  force    : ${args.force}`)

  const changed = []
  if (args.claude) {
    changed.push(...copyClaudeTemplate(target, { force: args.force, initLocal: args.initLocal }))
  }
  if (args.codex) {
    changed.push(...copyCodexTemplate(target, { force: args.force }))
  }
  if (changed.length === 0) {
    console.log('no files written (nothing to copy or all targets already exist; use --force to overwrite).')
  } else {
    console.log(`wrote ${changed.length} file(s):`)
    for (const p of changed) console.log('  + ' + p)
  }
}

main()
