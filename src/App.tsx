import Header from './components/Header'
import MapView from './components/MapView'
import RouteSidebar from './components/RouteSidebar'
import BottomSheet from './components/BottomSheet'
import { useIsMobile } from './hooks/useMediaQuery'

export default function App() {
  const isMobile = useIsMobile()

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[#0a0a0f]">
      {/* Header with search */}
      <Header />

      {/* Main content */}
      <div className="flex-1 flex relative">
        {/* Map — full width on mobile */}
        <div className="flex-1 relative">
          <MapView />
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
