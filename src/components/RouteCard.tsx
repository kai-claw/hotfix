import type { ScoredRoute } from '../types/route'
import { useIsMobile } from '../hooks/useMediaQuery'

interface RouteCardProps {
  route: ScoredRoute
  isSelected: boolean
  onSelect: () => void
  index: number
}

export default function RouteCard({
  route,
  isSelected,
  onSelect,
  index,
}: RouteCardProps) {
  const isMobile = useIsMobile()
  const hours = Math.floor(route.durationMin / 60)
  const mins = route.durationMin % 60
  const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins} min`

  if (isMobile) {
    return (
      <button
        onClick={onSelect}
        className="w-full text-left rounded-xl p-3 transition-all duration-200 route-card-enter"
        style={{
          animationDelay: `${index * 80}ms`,
          backgroundColor: isSelected ? '#1e1e35' : '#1a1a2e',
          border: isSelected
            ? `2px solid ${route.color}`
            : '2px solid transparent',
          boxShadow: isSelected
            ? `0 0 20px ${route.color}15`
            : '0 1px 6px rgba(0,0,0,0.2)',
        }}
      >
        {/* Compact mobile layout — single row */}
        <div className="flex items-center gap-3">
          {/* Color dot + name */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: route.color }}
            />
            <span className="text-white font-bold text-sm truncate">{route.name}</span>
            {route.isFastest && (
              <span className="text-[9px] uppercase tracking-wider font-bold text-[#ffb800] bg-[#ffb80015] px-1.5 py-0.5 rounded-full shrink-0">
                Fast
              </span>
            )}
          </div>

          {/* Time + delta */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-lg font-black text-white tabular-nums">{timeStr}</span>
            {!route.isFastest && route.deltaMin > 0 && (
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-md"
                style={{
                  color: route.deltaMin <= 5 ? '#22c55e' : route.deltaMin <= 15 ? '#ffb800' : '#ff2d55',
                  backgroundColor:
                    route.deltaMin <= 5 ? '#22c55e12' : route.deltaMin <= 15 ? '#ffb80012' : '#ff2d5512',
                }}
              >
                +{route.deltaMin}m
              </span>
            )}
          </div>
        </div>

        {/* Second row — distance + top highlight */}
        <div className="flex items-center gap-3 mt-1.5 pl-[18px]">
          <span className="text-[11px] text-[#6a6a8a]">{route.distanceMi} mi</span>
          {route.highlights[0] && (
            <span className="text-[11px] text-[#8a8aa0] truncate">
              <span style={{ color: route.color }} className="opacity-60">✦ </span>
              {route.highlights[0]}
            </span>
          )}
        </div>
      </button>
    )
  }

  // Desktop layout (unchanged)
  return (
    <button
      onClick={onSelect}
      className="w-full text-left rounded-2xl p-4 transition-all duration-300 route-card-enter group"
      style={{
        animationDelay: `${index * 100}ms`,
        backgroundColor: isSelected ? '#1e1e35' : '#1a1a2e',
        border: isSelected
          ? `2px solid ${route.color}`
          : '2px solid transparent',
        boxShadow: isSelected
          ? `0 0 30px ${route.color}15, 0 4px 20px rgba(0,0,0,0.3)`
          : '0 2px 10px rgba(0,0,0,0.2)',
        transform: isSelected ? 'scale(1.02)' : 'scale(1)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: route.color }}
          />
          <h3 className="text-white font-bold text-base tracking-tight">
            {route.name}
          </h3>
        </div>
        {route.isFastest && (
          <span className="text-[10px] uppercase tracking-widest font-bold text-[#ffb800] bg-[#ffb80015] px-2 py-0.5 rounded-full">
            Fastest
          </span>
        )}
      </div>

      {/* Time + Distance */}
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-2xl font-black text-white tabular-nums">
          {timeStr}
        </span>
        <span className="text-sm text-[#6a6a8a]">{route.distanceMi} mi</span>
      </div>

      {/* Delta time */}
      {!route.isFastest && route.deltaMin > 0 && (
        <div className="mb-3">
          <span
            className="inline-flex items-center gap-1 text-sm font-semibold px-3 py-1 rounded-lg"
            style={{
              color: route.deltaMin <= 5 ? '#22c55e' : route.deltaMin <= 15 ? '#ffb800' : '#ff2d55',
              backgroundColor:
                route.deltaMin <= 5
                  ? '#22c55e12'
                  : route.deltaMin <= 15
                    ? '#ffb80012'
                    : '#ff2d5512',
            }}
          >
            <span>+{route.deltaMin} min</span>
            <span className="text-xs opacity-70">vs fastest</span>
          </span>
        </div>
      )}

      {/* Highlights */}
      {route.highlights.length > 0 && (
        <div className="space-y-1">
          {route.highlights.map((h, i) => (
            <div
              key={i}
              className="text-xs text-[#8a8aa0] flex items-center gap-1.5"
            >
              <span className="opacity-60" style={{ color: route.color }}>✦</span>
              {h}
            </div>
          ))}
        </div>
      )}

      {/* Hover hint */}
      {!isSelected && (
        <div className="mt-3 text-[10px] uppercase tracking-widest text-[#4a4a5a] group-hover:text-[#6a6a8a] transition-colors">
          Click to preview route
        </div>
      )}
    </button>
  )
}
