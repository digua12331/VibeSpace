import * as api from '../api'
import { aimonWS } from '../ws'
import { useStore } from '../store'
import { logAction } from '../logs'
import { runPythonFile } from './runPython'

/** 后缀判断：本仓库当前支持一键执行的可执行文件类型。新增类型时改这里。 */
export function isExecutablePath(p: string): boolean {
  return /\.(py|bat|cmd)$/i.test(p)
}

// 记住每个项目"上一次通过启动脚本入口起的 bat 会话"。再次启动同一项目时先把它
// 关掉，避免越点越多的 cmd 页签堆积。仅用于项目启动脚本（runProjectStartScript）；
// 文件右键里的 runExecutableFile 跑任意 bat，不参与互相关闭。模块级保存：跨组件
// 重挂存活；整页刷新后丢失跟踪属可接受降级（与未做此功能前行为一致）。
const startBatSessionByProject = new Map<string, string>()

/**
 * 起一个 cmd 会话直接执行 .bat / .cmd 文件。和 runPythonFile 同构：先 cd
 * 到脚本所在目录，再以 PATH 中的 cmd 解释执行。120ms 兜底是给 conpty 启动
 * 早期的吞字现象留窗口。错误抛给调用方做 alert；logAction 已记录 ERROR。
 * 返回新建会话 id，供启动脚本入口记账以便下次关旧。
 */
export async function runBatFile(projectId: string, path: string): Promise<string> {
  let createdId = ''
  await logAction(
    'fs',
    'run-bat',
    async () => {
      const s = await api.createSession({ projectId, agent: 'cmd' })
      createdId = s.id
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
  return createdId
}

/** 关掉某项目上一次启动脚本起的 bat 页签（若仍在）。失败不抛，不阻塞起新会话。 */
async function closePrevStartBat(projectId: string): Promise<void> {
  const prevId = startBatSessionByProject.get(projectId)
  if (!prevId) return
  startBatSessionByProject.delete(projectId)
  const st = useStore.getState()
  const prev = st.sessions.find((s) => s.id === prevId)
  if (!prev) return // 用户已手动关掉，store 里已无此页签
  const status = st.liveStatus[prevId] ?? prev.status
  const isDead = status === 'stopped' || status === 'crashed'
  try {
    if (!isDead) {
      await logAction(
        'session',
        'stop',
        () => api.deleteSession(prevId),
        {
          projectId,
          sessionId: prevId,
          meta: { reason: 'relaunch-start-script' },
        },
      )
    }
  } catch {
    // 关旧失败就放过——大不了多留一个旧页签，下面照常起新会话
  } finally {
    st.removeSession(prevId)
  }
}

/**
 * 项目「一键启动」专用入口：再次启动同一项目脚本前，先关掉上一次本入口起的
 * bat 页签，再起新的并记账。和 runBatFile 的差别只在"关旧 + 记新"。
 */
export async function runProjectStartScript(
  projectId: string,
  path: string,
): Promise<void> {
  await closePrevStartBat(projectId)
  const id = await runBatFile(projectId, path)
  startBatSessionByProject.set(projectId, id)
}

/** 通用入口：根据后缀分发到对应的执行实现。调用方在判断 isExecutablePath 后调用。 */
export async function runExecutableFile(projectId: string, path: string): Promise<void> {
  if (/\.py$/i.test(path)) return runPythonFile(projectId, path)
  if (/\.(bat|cmd)$/i.test(path)) {
    await runBatFile(projectId, path)
    return
  }
  throw new Error(`不支持执行: ${path}`)
}
