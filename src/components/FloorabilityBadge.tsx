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
  const { totalScore } = floorability
  const color = scoreColor(totalScore)
  const label = scoreLabel(totalScore)

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
          {floorability.floorItCount} event{floorability.floorItCount !== 1 ? 's' : ''}
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

      {/* Sub-scores */}
      <div className="grid grid-cols-3 gap-1.5">
        <SubScore label="Speed Δ" score={floorability.speedDeltaScore} icon="⚡" />
        <SubScore label="Launches" score={floorability.signalLaunchScore} icon="🚦" />
        <SubScore label="Merges" score={floorability.rampMergeScore} icon="🛣️" />
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

function SubScore({ label, score, icon }: { label: string; score: number; icon: string }) {
  return (
    <div className="flex items-center gap-1 text-[10px]">
      <span>{icon}</span>
      <span className="text-[#6a6a8a]">{label}</span>
      <span className="font-bold text-[#a0a0b0] ml-auto">{score}</span>
    </div>
  )
}
