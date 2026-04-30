import * as api from '../api'
import { aimonWS } from '../ws'
import { useStore } from '../store'
import { logAction } from '../logs'
import { runPythonFile } from './runPython'

/** 后缀判断：本仓库当前支持一键执行的可执行文件类型。新增类型时改这里。 */
export function isExecutablePath(p: string): boolean {
  return /\.(py|bat|cmd)$/i.test(p)
}

/**
 * 起一个 cmd 会话直接执行 .bat / .cmd 文件。和 runPythonFile 同构：先 cd
 * 到脚本所在目录，再以 PATH 中的 cmd 解释执行。120ms 兜底是给 conpty 启动
 * 早期的吞字现象留窗口。错误抛给调用方做 alert；logAction 已记录 ERROR。
 */
export async function runBatFile(projectId: string, path: string): Promise<void> {
  await logAction(
    'fs',
    'run-bat',
    async () => {
      const s = await api.createSession({ projectId, agent: 'cmd' })
      const st = useStore.getState()
      st.addSession(s)
      st.setActiveSession(projectId, s.id)
      st.setActiveTabKind('session')
      aimonWS.subscribe([s.id])
      await new Promise((r) => setTimeout(r, 120))
      const winPath = path.replace(/\//g, '\\')
      const slash = winPath.lastIndexOf('\\')
      const line =
        slash >= 0
          ? `cd /d "${winPath.slice(0, slash)}" && "${winPath.slice(slash + 1)}"\r`
          : `"${winPath}"\r`
      aimonWS.sendInput(s.id, line)
    },
    { projectId, meta: { path } },
  )
}

/** 通用入口：根据后缀分发到对应的执行实现。调用方在判断 isExecutablePath 后调用。 */
export async function runExecutableFile(projectId: string, path: string): Promise<void> {
  if (/\.py$/i.test(path)) return runPythonFile(projectId, path)
  if (/\.(bat|cmd)$/i.test(path)) return runBatFile(projectId, path)
  throw new Error(`不支持执行: ${path}`)
}
