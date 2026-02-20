import Header from './components/Header'
import MapView from './components/MapView'
import RouteSidebar from './components/RouteSidebar'
import BottomSheet from './components/BottomSheet'
import { useIsMobile } from './hooks/useMediaQuery'
import { useRouteStore } from './store/routeStore'

export default function App() {
  const isMobile = useIsMobile()
  const { mode, origin, loadingState } = useRouteStore()

  const showPinHint = mode === 'loop' && !origin && loadingState === 'idle'

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[#0a0a0f]">
      {/* Header with search */}
      <Header />

      {/* Main content */}
      <div className="flex-1 flex relative">
        {/* Map — full width on mobile */}
        <div className="flex-1 relative">
          <MapView />

          {/* Pin hint overlay — shown in loop mode when no origin */}
          {showPinHint && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div className="bg-[#0a0a0f]/80 backdrop-blur-md rounded-2xl px-6 py-4 border border-[#2a2a3e] text-center max-w-xs">
                <div className="text-3xl mb-2">📍</div>
                <p className="text-white font-semibold text-sm mb-1">Tap the map to drop a pin</p>
                <p className="text-[#6a6a8a] text-xs">Or search for a location above</p>
              </div>
            </div>
          )}
        </div>

        {/* Desktop sidebar */}
        {!isMobile && (
          <aside className="w-[340px] shrink-0 bg-[#0f0f1a]/95 backdrop-blur-md border-l border-[#1a1a2e] overflow-hidden">
            <RouteSidebar />
          </aside>
        )}
      </div>

      {/* Mobile bottom sheet */}
      {isMobile && (
        <BottomSheet>
          <RouteSidebar />
        </BottomSheet>
      )}
    </div>
  )
}
