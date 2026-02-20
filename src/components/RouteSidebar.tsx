import { useRouteStore } from '../store/routeStore'
import { useIsMobile } from '../hooks/useMediaQuery'
import RouteCard from './RouteCard'

export default function RouteSidebar() {
  const { routes, selectedRouteId, selectRoute, loadingState, error } =
    useRouteStore()
  const isMobile = useIsMobile()

  if (loadingState === 'idle' && routes.length === 0) {
    if (isMobile) {
      // Don't show the full empty state on mobile — bottom sheet handles it
      return null
    }

    return (
      <div className="h-full flex flex-col items-center justify-center px-6 text-center">
        <div className="text-5xl mb-4">🏎️</div>
        <h2 className="text-xl font-bold text-white mb-2">
          Ready to Rip?
        </h2>
        <p className="text-sm text-[#6a6a8a] leading-relaxed">
          Enter an origin and destination to find routes that let you actually
          use what's under the hood.
        </p>
        <div className="mt-6 flex flex-col gap-2 text-xs text-[#4a4a5a]">
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
            <span className={isMobile ? 'text-lg' : 'text-2xl'}>🏎️</span>
          </div>
        </div>
        <p className={`text-[#a0a0b0] loading-pulse ${isMobile ? 'text-xs' : 'text-sm'}`}>
          Finding the fun routes...
        </p>
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
            Routes Found
          </h2>
          <span className={`text-[#4a4a5a] ${isMobile ? 'text-[10px]' : 'text-xs'}`}>
            {routes.length} option{routes.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Route cards */}
      <div className={`flex-1 overflow-y-auto ${
        isMobile ? 'px-3 pb-3 space-y-2' : 'px-4 pb-4 space-y-3'
      }`}>
        {routes.map((route, index) => (
          <RouteCard
            key={route.id}
            route={route}
            isSelected={route.id === selectedRouteId}
            onSelect={() => selectRoute(route.id)}
            index={index}
          />
        ))}
      </div>

      {/* Footer — desktop only */}
      {!isMobile && (
        <div className="px-4 py-3 border-t border-[#1a1a2e]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[#ff2d55] font-black text-sm tracking-tight">
                HOTFIX
              </span>
              <span className="text-[10px] text-[#4a4a5a] uppercase tracking-widest">
                Route Like You Mean It
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
