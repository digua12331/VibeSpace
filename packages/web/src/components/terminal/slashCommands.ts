// Hard-coded slash command list per agent. Shown in the floating input's
// autocomplete menu when the user types `/` at the start of the input or
// right after whitespace.
//
// Sources:
// - claude: Claude Code /help "general" screenshot (4 items) + high-confidence
//   defaults from training data. Will drift over time — refresh via a manual
//   review every quarter if needed.
// - gemini: extracted 37 top-level commands from Gemini CLI /help output
//   provided by the user (subcommands intentionally omitted — user types
//   them after a space).
// - codex: user did not supply /help output yet; 3 common commands as a
//   placeholder. Tracked in dev/issues.md.
// - shell / cmd / pwsh: `/` is a path separator, not a command prefix —
//   leaving the list empty disables the popup for these agents.
// - opencode / qoder / kilo: no reliable command source, empty for now.

const SLASH_COMMANDS: Record<string, readonly string[]> = {
  claude: [
    '/help', '/clear', '/model', '/compact', '/cost', '/init',
    '/config', '/permissions', '/hooks', '/mcp',
    '/powerup', '/keybindings', '/feedback', '/btw',
  ],
  codex: ['/help', '/clear', '/model'],
  gemini: [
    '/about', '/agents', '/auth', '/bug', '/chat', '/clear',
    '/commands', '/compress', '/copy', '/docs', '/directory', '/editor',
    '/extensions', '/help', '/footer', '/shortcuts', '/hooks', '/rewind',
    '/ide', '/init', '/mcp', '/memory', '/model', '/permissions',
    '/plan', '/policies', '/privacy', '/quit', '/resume', '/stats',
    '/theme', '/tools', '/skills', '/settings', '/tasks', '/vim',
    '/setup-github', '/terminal-setup',
  ],
  opencode: [],
  qoder: [],
  kilo: [],
  shell: [],
  cmd: [],
  pwsh: [],
}

export function getSlashCommands(agent: string): readonly string[] {
  return SLASH_COMMANDS[agent] ?? []
}
