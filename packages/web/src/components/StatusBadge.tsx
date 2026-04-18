import type { SessionStatus } from '../types'

// Fluent-style status pill: filled dot + label inside a soft tinted chip.
const STYLES: Record<SessionStatus, { dot: string; chip: string; label: string }> = {
  starting: {
    dot: 'bg-sky-400',
    chip: 'text-sky-200 bg-sky-500/15 border-sky-500/30',
    label: 'starting',
  },
  running: {
    dot: 'bg-sky-400',
    chip: 'text-sky-200 bg-sky-500/15 border-sky-500/30',
    label: 'running',
  },
  working: {
    dot: 'bg-amber-400 animate-pulse-soft',
    chip: 'text-amber-200 bg-amber-500/15 border-amber-500/30',
    label: 'working',
  },
  waiting_input: {
    dot: 'bg-rose-500 animate-blink-fast',
    chip: 'text-rose-200 bg-rose-500/15 border-rose-500/30',
    label: 'waiting',
  },
  idle: {
    dot: 'bg-emerald-400',
    chip: 'text-emerald-200 bg-emerald-500/15 border-emerald-500/30',
    label: 'idle',
  },
  stopped: {
    dot: 'bg-zinc-500',
    chip: 'text-zinc-300 bg-zinc-500/15 border-zinc-500/30',
    label: 'stopped',
  },
  crashed: {
    dot: 'bg-rose-500',
    chip: 'text-rose-200 bg-rose-500/15 border-rose-500/30',
    label: 'crashed',
  },
}

export default function StatusBadge({ status }: { status: SessionStatus }) {
  const s = STYLES[status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border ${s.chip}`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}
