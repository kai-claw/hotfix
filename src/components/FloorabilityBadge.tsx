import type { FloorabilityResult } from '../lib/floorability'

interface FloorabilityBadgeProps {
  floorability: FloorabilityResult
  compact?: boolean
}

function scoreColor(score: number): string {
  if (score >= 70) return '#ff2d55' // hot
  if (score >= 40) return '#ffb800' // warm
  if (score >= 20) return '#00d4ff' // cool
  return '#6a6a8a' // cold
}

function scoreLabel(score: number): string {
  if (score >= 80) return 'INSANE'
  if (score >= 60) return 'HOT'
  if (score >= 40) return 'SOLID'
  if (score >= 20) return 'MILD'
  return 'CHILL'
}

export default function FloorabilityBadge({ floorability, compact = false }: FloorabilityBadgeProps) {
  const { totalScore, events } = floorability
  const color = scoreColor(totalScore)
  const label = scoreLabel(totalScore)

  // Count events by type
  const speedDeltas = events.filter((e) => e.type === 'speed_delta').length
  const signalLaunches = events.filter((e) => e.type === 'signal_launch').length
  const rampMerges = events.filter((e) => e.type === 'ramp_merge').length

  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        <span
          className="text-lg font-black tabular-nums"
          style={{ color }}
        >
          {totalScore}
        </span>
        <div className="flex flex-col">
          <span className="text-[9px] uppercase tracking-widest font-bold" style={{ color }}>
            {label}
          </span>
          <span className="text-[9px] text-[#6a6a8a]">floorability</span>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl p-3" style={{ backgroundColor: `${color}08`, border: `1px solid ${color}20` }}>
      {/* Score header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-black tabular-nums" style={{ color }}>
            {totalScore}
          </span>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color }}>
              {label}
            </span>
            <span className="text-[10px] text-[#6a6a8a]">Floorability Score</span>
          </div>
        </div>
        <span className="text-xs text-[#6a6a8a]">
          {floorability.floorItCount} zone{floorability.floorItCount !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Score bar */}
      <div className="h-1.5 rounded-full bg-[#1a1a2e] overflow-hidden mb-2">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${totalScore}%`,
            background: `linear-gradient(90deg, ${color}80, ${color})`,
            boxShadow: `0 0 8px ${color}40`,
          }}
        />
      </div>

      {/* Event breakdown — actual counts by type */}
      <div className="grid grid-cols-3 gap-1 mb-2">
        <EventCount icon="🚀" label="Speed Δ" count={speedDeltas} color="#ff2d55" />
        <EventCount icon="🚦" label="Launches" count={signalLaunches} color="#ffb800" />
        <EventCount icon="🛣️" label="Merges" count={rampMerges} color="#00d4ff" />
      </div>

      {/* Sub-scores bar chart */}
      <div className="space-y-1">
        <ScoreBar label="Speed Δ" score={floorability.speedDeltaScore} color="#ff2d55" />
        <ScoreBar label="Launches" score={floorability.signalLaunchScore} color="#ffb800" />
        <ScoreBar label="Merges" score={floorability.rampMergeScore} color="#00d4ff" />
      </div>

      {/* Best moment */}
      {floorability.bestMoment && floorability.floorItCount > 0 && (
        <div className="mt-2 text-[10px] text-[#8a8aa0] italic leading-relaxed">
          ✦ {floorability.bestMoment}
        </div>
      )}
    </div>
  )
}

function EventCount({ icon, label, count, color }: { icon: string; label: string; count: number; color: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-1 rounded-lg" style={{ backgroundColor: count > 0 ? `${color}08` : 'transparent' }}>
      <div className="flex items-center gap-1">
        <span className="text-xs">{icon}</span>
        <span className="text-sm font-black tabular-nums" style={{ color: count > 0 ? color : '#4a4a5a' }}>
          {count}
        </span>
      </div>
      <span className="text-[8px] uppercase tracking-wider text-[#6a6a8a]">{label}</span>
    </div>
  )
}

function ScoreBar({ label, score, color }: { label: string; score: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-[#6a6a8a] w-14 text-right">{label}</span>
      <div className="flex-1 h-1 rounded-full bg-[#1a1a2e] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.min(100, score)}%`,
            background: score > 0 ? color : 'transparent',
            opacity: 0.7,
          }}
        />
      </div>
      <span className="text-[9px] font-bold tabular-nums w-6 text-right" style={{ color: score > 30 ? color : '#4a4a5a' }}>
        {score}
      </span>
    </div>
  )
}
