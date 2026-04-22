// Prompt library shown in the SessionView header's 📝 dialog. Mirrors the
// pattern used by `customButtons.ts`: module-level state, localStorage-backed,
// pub/sub via listener Set. The built-in set is hard-coded here (not fetched)
// so the UI doesn't need a loading state.

export interface BuiltinPrompt {
  id: string
  name: string
  content: string
  builtin: true
}

export interface UserPrompt {
  id: string
  name: string
  content: string
  builtin: false
}

export type Prompt = BuiltinPrompt | UserPrompt

export const BUILTIN_PROMPTS: readonly BuiltinPrompt[] = [
  {
    id: 'builtin.review',
    builtin: true,
    name: '代码审查',
    content:
      '请审查我刚才改动的代码，重点关注安全漏洞、性能瓶颈、设计缺陷和可维护性。按"严重 / 中等 / 轻微"三档列出问题并给出修复建议。',
  },
  {
    id: 'builtin.test',
    builtin: true,
    name: '写单元测试',
    content:
      '请为 @<path> 编写单元测试，覆盖主干逻辑、边界情况（空输入、极值、并发）和典型错误路径。使用本项目已在用的测试框架。',
  },
  {
    id: 'builtin.explain',
    builtin: true,
    name: '解释代码',
    content:
      '请逐段解释 @<path> 的工作方式：它解决什么问题、关键算法/数据结构是什么、外部依赖有哪些、常见调用链是什么样的。',
  },
  {
    id: 'builtin.refactor',
    builtin: true,
    name: '重构（不改行为）',
    content:
      '请重构我刚才选中的代码，让它更简洁、更易读，但**不要改变外部行为**。说明你做了哪些变化以及为什么。',
  },
  {
    id: 'builtin.error-handling',
    builtin: true,
    name: '加错误处理 / 参数校验',
    content:
      '请为我刚才改动的代码补充必要的错误处理和参数校验：非法输入、外部调用失败、并发竞争都要考虑到。给出明确的失败模式与错误消息。',
  },
  {
    id: 'builtin.perf',
    builtin: true,
    name: '性能优化',
    content:
      '请分析这段代码的性能瓶颈（CPU / 内存 / IO / 网络）并给出可量化的优化方案。如果改动收益小于 20%，请直接告诉我"不值得优化"。',
  },
  {
    id: 'builtin.doc',
    builtin: true,
    name: '补文档 / JSDoc',
    content:
      '请为 @<path> 里的导出函数和类型补充简洁的 JSDoc / 类型注释。重点写清"为什么"而非"是什么"，不要写冗余注释。',
  },
  {
    id: 'builtin.bug-hunt',
    builtin: true,
    name: '找 bug',
    content:
      '请仔细读 @<path>，列出所有你觉得可疑、容易出 bug 的地方（off-by-one、空引用、并发、类型强转、异常吞掉等），并给出复现思路。',
  },
  {
    id: 'builtin.diff-explain',
    builtin: true,
    name: '解释最近 git diff',
    content:
      '请运行 `git diff HEAD~1` 查看最近一次改动并解释：这次改动的意图是什么、涉及哪些模块、有没有潜在风险或被遗漏的地方。',
  },
  {
    id: 'builtin.commit-msg',
    builtin: true,
    name: '生成 commit 信息（Conventional Commits）',
    content:
      '基于当前已暂存的更改（`git diff --cached`），生成一条符合 Conventional Commits 规范的 commit 信息。只输出最终结果，不要解释。',
  },
]

const LS_KEY = 'vibespace_user_prompts_v1'

function isUserPrompt(v: unknown): v is UserPrompt {
  if (!v || typeof v !== 'object') return false
  const obj = v as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.content === 'string'
  )
}

export function getUserPrompts(): UserPrompt[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(isUserPrompt)
      .map((p) => ({ ...p, builtin: false }) satisfies UserPrompt)
  } catch {
    return []
  }
}

export function setUserPrompts(list: UserPrompt[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    // Strip builtin to keep storage lean and schema-safe.
    const sanitized = list.map(({ id, name, content }) => ({ id, name, content }))
    localStorage.setItem(LS_KEY, JSON.stringify(sanitized))
  } catch {
    // Quota exceeded / private mode — silent, match customButtons behaviour.
  }
  fire()
}

export function addUserPrompt(input: { name: string; content: string }): UserPrompt {
  const prompt: UserPrompt = {
    id: `user.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    content: input.content,
    builtin: false,
  }
  const next = [...getUserPrompts(), prompt]
  setUserPrompts(next)
  return prompt
}

export function updateUserPrompt(
  id: string,
  patch: { name?: string; content?: string },
): void {
  const next = getUserPrompts().map((p) =>
    p.id === id ? { ...p, ...patch } : p,
  )
  setUserPrompts(next)
}

export function deleteUserPrompt(id: string): void {
  setUserPrompts(getUserPrompts().filter((p) => p.id !== id))
}

type Listener = (list: UserPrompt[]) => void
const listeners = new Set<Listener>()

function fire(): void {
  const snap = getUserPrompts()
  for (const l of listeners) l(snap)
}

export function onUserPromptsChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Merge built-in and user prompts into the single list rendered by the UI.
 * Built-ins first so they are the "default answer" when searching.
 */
export function listAllPrompts(): Prompt[] {
  return [...BUILTIN_PROMPTS, ...getUserPrompts()]
}
