import { useStore } from '../../store'

export default function EditorTabs() {
  const openFiles = useStore((s) => s.openFiles)
  const activeFileKey = useStore((s) => s.activeFileKey)
  const setActiveFile = useStore((s) => s.setActiveFile)
  const closeFile = useStore((s) => s.closeFile)

  if (openFiles.length === 0) return null

  return (
    <div className="flex items-stretch h-9 border-b border-border/60 bg-black/20 overflow-x-auto">
      {openFiles.map((f) => {
        const active = f.key === activeFileKey
        const basename = f.path.split('/').pop() ?? f.path
        const title = f.commitSha
          ? `${f.path} @ ${f.commitSha.slice(0, 7)}`
          : f.path
        return (
          <div
            key={f.key}
            title={title}
            onClick={() => setActiveFile(f.key)}
            onAuxClick={(e) => {
              if (e.button === 1) closeFile(f.key)
            }}
            className={`group relative flex items-center gap-2 px-3 pr-2 text-[12.5px] cursor-pointer select-none border-r border-border/40 ${
              active
                ? 'bg-bg text-fg'
                : 'bg-transparent text-muted hover:text-fg hover:bg-white/[0.04]'
            }`}
          >
            <span className="font-mono truncate max-w-[220px]">{basename}</span>
            {f.commitSha && (
              <span className="text-[10px] font-mono text-subtle">
                @{f.commitSha.slice(0, 7)}
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                closeFile(f.key)
              }}
              className="w-4 h-4 inline-flex items-center justify-center rounded opacity-60 hover:opacity-100 hover:bg-white/[0.08]"
              title="关闭 (中键)"
            >
              ✕
            </button>
            {active && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent" />
            )}
          </div>
        )
      })}
    </div>
  )
}
