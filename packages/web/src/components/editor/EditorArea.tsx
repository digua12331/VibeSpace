import { useStore } from '../../store'
import FilePreview from '../FilePreview'
import EditorTabs from './EditorTabs'

export default function EditorArea() {
  const openFiles = useStore((s) => s.openFiles)
  const activeFileKey = useStore((s) => s.activeFileKey)
  const active = openFiles.find((f) => f.key === activeFileKey) ?? null

  return (
    <section className="h-full flex flex-col min-h-0 min-w-0 bg-bg">
      <EditorTabs />
      <div className="flex-1 flex min-h-0">
        {active ? (
          <FilePreview
            key={active.key}
            projectId={active.projectId}
            path={active.path}
            ref={active.ref}
            from={active.from}
            to={active.to}
          />
        ) : (
          <EmptyState />
        )}
      </div>
    </section>
  )
}

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center text-sm text-muted">
      <div className="text-center space-y-1">
        <div className="text-[36px] opacity-40">📄</div>
        <div>从左侧「源代码更改」中选择一个文件</div>
      </div>
    </div>
  )
}
