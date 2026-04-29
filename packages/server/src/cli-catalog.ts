// Single source of truth for installable AI CLIs. The web installer dialog,
// PTY spawn lookup, and the launch menu all read from this catalog so adding
// a new CLI only needs an entry here.

export type CliPlatform = "win32" | "darwin" | "linux" | "all";

/**
 * What this entry represents:
 *   - `agent`     (default): a TUI/REPL that VibeSpace spawns as a session via PTY
 *                  (claude / codex / gemini / ...). Shows in StartSessionMenu.
 *   - `mcp-tool`: a tool that other agents call into via MCP. Shows in the
 *                  installer dialog (📦) only — never in the launch menu, since
 *                  it is not a chat REPL. Wiring to specific agents is done by
 *                  mcp-bridge.ts at session start.
 */
export type CliKind = "agent" | "mcp-tool";

export interface CliEntry {
  /** Stable id; also used as the agent name passed to PTY spawn. */
  id: string;
  label: string;
  /** Executable names to probe on PATH; first hit wins. */
  bin: string[];
  /** Defaults to 'agent' when omitted. See CliKind for behaviour differences. */
  kind?: CliKind;
  /** Optional spawn args for the launched PTY (e.g. `-NoLogo`). */
  spawnArgs?: string[];
  /** Per-platform install command line. `all` is the fallback. */
  install: Partial<Record<CliPlatform, string>>;
  /** One-line description shown in the installer card. */
  description?: string;
  /** Marks shipped-by-default CLIs (Install button becomes "Reinstall"). */
  builtin?: boolean;
  /** Tools the install command needs on PATH (npm / pip / gh / uv). */
  requires?: string[];
  /** Optional documentation URL surfaced in the dialog. */
  homepage?: string;
}

export const CLI_CATALOG: CliEntry[] = [
  {
    id: "claude",
    label: "Claude Code",
    bin: ["claude"],
    install: { all: "npm i -g @anthropic-ai/claude-code" },
    description: "Anthropic 官方 CLI",
    builtin: true,
    requires: ["npm"],
    homepage: "https://docs.claude.com/claude-code",
  },
  {
    id: "codex",
    label: "OpenAI Codex",
    bin: ["codex"],
    install: { all: "npm i -g @openai/codex" },
    description: "OpenAI 官方 CLI",
    builtin: true,
    requires: ["npm"],
    homepage: "https://developers.openai.com/codex/cli",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    bin: ["gemini"],
    install: { all: "npm i -g @google/gemini-cli" },
    description: "Google 官方 · 免费额度宽松",
    requires: ["npm"],
    homepage: "https://github.com/google-gemini/gemini-cli",
  },
  {
    id: "opencode",
    label: "OpenCode",
    bin: ["opencode"],
    install: { all: "npm i -g opencode-ai" },
    description: "开源 · 多模型聚合 TUI",
    requires: ["npm"],
    homepage: "https://opencode.ai",
  },
  {
    id: "qoder",
    label: "Qoder CLI",
    bin: ["qodercli", "qoder"],
    install: { all: "npm i -g @qoder-ai/qodercli" },
    description: "Qoder 终端 Agent",
    requires: ["npm"],
    homepage: "https://qoder.com/cli",
  },
  {
    id: "kilo",
    label: "Kilo CLI",
    bin: ["kilo"],
    install: { all: "npm i -g @kilocode/cli" },
    description: "开源 · Agentic 编程平台",
    requires: ["npm"],
    homepage: "https://kilo.ai/cli",
  },
  {
    id: "browser-use",
    label: "browser-use",
    kind: "mcp-tool",
    bin: ["browser-use"],
    install: { all: "uv tool install 'browser-use[cli]'" },
    description: "浏览器手 · 给 claude/codex 等 session 经 MCP 调用",
    requires: ["uv"],
    homepage: "https://github.com/browser-use/browser-use",
  },
];

export function getCliEntry(id: string): CliEntry | undefined {
  return CLI_CATALOG.find((e) => e.id === id);
}

/** Resolve the install command for the current platform, with `all` fallback. */
export function resolveInstallCommand(entry: CliEntry): string | null {
  const plat = process.platform as CliPlatform;
  return entry.install[plat] ?? entry.install.all ?? null;
}
