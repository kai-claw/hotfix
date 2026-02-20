import { useRouteStore } from '../store/routeStore'
import { useIsMobile } from '../hooks/useMediaQuery'
import RouteCard from './RouteCard'

export default function RouteSidebar() {
  const { mode, routes, loopRoutes, selectedRouteId, selectRoute, loadingState, loadingStage, loadingProgress, error, lowFloorabilityWarning } =
    useRouteStore()
  const isMobile = useIsMobile()

  const displayRoutes = mode === 'loop' ? loopRoutes : routes
  const isLoop = mode === 'loop'

  if (loadingState === 'idle' && displayRoutes.length === 0) {
    if (isMobile) return null

    return (
      <div className="h-full flex flex-col items-center justify-center px-6 text-center">
        <div className="text-5xl mb-4">{isLoop ? '🔄' : '🏎️'}</div>
        <h2 className="text-xl font-bold text-white mb-2">
          {isLoop ? 'Ready to Loop?' : 'Ready to Rip?'}
        </h2>
        <p className="text-sm text-[#6a6a8a] leading-relaxed">
          {isLoop
            ? 'Pick a starting point and we\'ll generate loops with the highest floorability — speed transitions, signal launches, and on-ramp merges.'
            : 'Enter an origin and destination to find routes that let you actually use what\'s under the hood.'}
        </p>
        <div className="mt-6 flex flex-col gap-2 text-xs text-[#4a4a5a]">
          {isLoop ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-[#ff2d55]">⚡</span> Speed limit transitions (25→55)
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#ffb800]">🚦</span> Signal launch zones
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#00d4ff]">🛣️</span> On-ramp acceleration
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#a855f7]">📏</span> Long acceleration runways
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="text-[#ff2d55]">●</span> Long straightaways
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#ffb800]">●</span> On-ramp acceleration zones
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#00d4ff]">●</span> Sweeping curves
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#a855f7]">●</span> Scenic elevation changes
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  if (loadingState === 'loading') {
    return (
      <div className={`flex flex-col items-center justify-center px-6 ${isMobile ? 'py-6' : 'h-full'}`}>
        <div className="relative mb-4">
          <div className={`rounded-full border-2 border-[#2a2a3e] border-t-[#ff2d55] animate-spin ${
            isMobile ? 'w-10 h-10' : 'w-16 h-16'
          }`} />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={isMobile ? 'text-lg' : 'text-2xl'}>{isLoop ? '🔄' : '🏎️'}</span>
          </div>
        </div>
        <p className={`text-[#a0a0b0] mb-2 ${isMobile ? 'text-xs' : 'text-sm'}`}>
          {loadingStage || 'Finding routes...'}
        </p>
        {/* Progress bar */}
        {loadingProgress > 0 && (
          <div className="w-40 h-1 rounded-full bg-[#1a1a2e] overflow-hidden">
            <div
              className="h-full rounded-full bg-[#ff2d55] transition-all duration-300"
              style={{ width: `${loadingProgress * 100}%` }}
            />
          </div>
        )}
      </div>
    )
  }

  if (loadingState === 'error') {
    return (
      <div className={`flex flex-col items-center justify-center px-6 text-center ${isMobile ? 'py-6' : 'h-full'}`}>
        <div className={isMobile ? 'text-2xl mb-2' : 'text-4xl mb-4'}>⚠️</div>
        <h3 className={`font-bold text-[#ff2d55] ${isMobile ? 'text-sm mb-1' : 'text-lg mb-2'}`}>Route Error</h3>
        <p className={`text-[#6a6a8a] ${isMobile ? 'text-xs' : 'text-sm'}`}>{error}</p>
      </div>
    )
  }

  return (
    <div className={`flex flex-col ${isMobile ? '' : 'h-full'}`}>
      {/* Header */}
      <div className={`${isMobile ? 'px-3 pt-1 pb-2' : 'px-4 pt-4 pb-2'}`}>
        <div className="flex items-center justify-between">
          <h2 className={`font-bold uppercase tracking-widest text-[#6a6a8a] ${
            isMobile ? 'text-[10px]' : 'text-sm'
          }`}>
            {isLoop ? 'Loop Routes' : 'Routes Found'}
          </h2>
          <span className={`text-[#4a4a5a] ${isMobile ? 'text-[10px]' : 'text-xs'}`}>
            {displayRoutes.length} option{displayRoutes.length !== 1 ? 's' : ''}
          </span>
        </div>
        {isLoop && !lowFloorabilityWarning && (
          <p className="text-[10px] text-[#4a4a5a] mt-0.5">
            Ranked by floorability — speed transitions, launches & merges
          </p>
        )}
        {isLoop && lowFloorabilityWarning && (
          <div className="mt-1 px-2 py-1.5 rounded-lg bg-[#ffb80010] border border-[#ffb80020]">
            <p className="text-[10px] text-[#ffb800] font-semibold">
              ⚠️ Limited floor-it opportunities in this area
            </p>
            <p className="text-[9px] text-[#6a6a8a] mt-0.5">
              Try a different starting point or longer duration for better routes.
            </p>
          </div>
        )}
      </div>

      {/* Route cards */}
      <div className={`flex-1 overflow-y-auto ${
        isMobile ? 'px-3 pb-3 space-y-2' : 'px-4 pb-4 space-y-3'
      }`}>
        {displayRoutes.map((route, index) => (
          <RouteCard
            key={route.id}
            route={route}
            isSelected={route.id === selectedRouteId}
            onSelect={() => selectRoute(route.id)}
            index={index}
            isLoop={isLoop}
          />
        ))}
      </div>

      {/* Footer — desktop only */}
      {!isMobile && (
        <div className="px-4 py-3 border-t border-[#1a1a2e]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[#ff2d55] font-black text-sm tracking-tight">HOTFIX</span>
              <span className="text-[10px] text-[#4a4a5a] uppercase tracking-widest">Route Like You Mean It</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
