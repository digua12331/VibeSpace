import { useEffect, useRef, useState } from 'react'
import { projectRawUrl } from '../api'
import { pushLog } from '../logs'

interface Props {
  projectId: string
  path: string
}

function extOf(p: string): string {
  const m = /\.([^.]+)$/.exec(p)
  return m ? m[1].toLowerCase() : ''
}

function isSvg(p: string): boolean {
  return /\.svg$/i.test(p)
}

export default function ImagePreview({ projectId, path }: Props) {
  const url = projectRawUrl(projectId, path)
  const startedAtRef = useRef<number>(performance.now())
  const settledRef = useRef<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    startedAtRef.current = performance.now()
    settledRef.current = false
    setError(null)
    pushLog({
      level: 'info',
      scope: 'file',
      msg: 'preview-image 开始',
      projectId,
      meta: { path, ext: extOf(path) },
    })
  }, [projectId, path])

  function onLoad() {
    if (settledRef.current) return
    settledRef.current = true
    const ms = Math.round(performance.now() - startedAtRef.current)
    pushLog({
      level: 'info',
      scope: 'file',
      msg: `preview-image 成功 (${ms}ms)`,
      projectId,
      meta: { ms, path },
    })
  }

  function onError(reason: string) {
    if (settledRef.current) return
    settledRef.current = true
    const ms = Math.round(performance.now() - startedAtRef.current)
    setError(reason)
    pushLog({
      level: 'error',
      scope: 'file',
      msg: `preview-image 失败: ${reason}`,
      projectId,
      meta: { ms, path, error: { message: reason } },
    })
  }

  return (
    <div className="w-full h-full flex flex-col bg-black/40">
      {error && (
        <div className="px-3 py-1.5 text-[11px] text-rose-300 bg-rose-500/10 border-b border-rose-600/40">
          {error}
        </div>
      )}
      <div className="flex-1 overflow-auto flex items-center justify-center p-4">
        {isSvg(path) ? (
          <iframe
            title={path}
            src={url}
            sandbox=""
            onLoad={onLoad}
            onError={() => onError('SVG 加载失败')}
            className="w-full h-full bg-white border-0"
          />
        ) : (
          <img
            src={url}
            alt={path}
            onLoad={onLoad}
            onError={() => onError('图片加载失败（可能损坏、过大或不支持的格式）')}
            className="max-w-full max-h-full object-contain"
          />
        )}
      </div>
    </div>
  )
}
