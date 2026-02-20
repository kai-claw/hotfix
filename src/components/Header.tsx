import SearchBar from './SearchBar'
import { useRouteStore } from '../store/routeStore'
import { useIsMobile } from '../hooks/useMediaQuery'

export default function Header() {
  const {
    originName,
    destinationName,
    setOrigin,
    setDestination,
    swapLocations,
  } = useRouteStore()

  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <header className="absolute top-0 left-0 right-0 z-20 pointer-events-none">
        <div className="p-3 flex flex-col gap-2">
          {/* Compact mobile search */}
          <div className="pointer-events-auto flex items-center gap-2">
            {/* Logo pill */}
            <div className="flex items-center bg-[#0a0a0f]/90 backdrop-blur-md rounded-lg px-2.5 py-2 border border-[#1a1a2e] shrink-0">
              <span className="text-[#ff2d55] font-black text-sm tracking-tighter">HF</span>
            </div>

            {/* Stacked search inputs */}
            <div className="flex-1 flex flex-col gap-1.5">
              <SearchBar
                placeholder="Starting point..."
                value={originName}
                icon="🟢"
                accentColor="#22c55e"
                onSelect={(coords, name) => setOrigin(coords, name)}
                onClear={() => setOrigin(null)}
                compact
              />
              <SearchBar
                placeholder="Where to?"
                value={destinationName}
                icon="🏁"
                accentColor="#ff2d55"
                onSelect={(coords, name) => setDestination(coords, name)}
                onClear={() => setDestination(null)}
                compact
              />
            </div>

            {/* Swap button */}
            <button
              onClick={swapLocations}
              className="shrink-0 w-9 h-9 rounded-lg bg-[#1a1a2e]/90 backdrop-blur-md border border-[#2a2a3e] flex items-center justify-center text-[#6a6a8a] hover:text-[#ff2d55] active:scale-95 transition-all text-sm"
              title="Swap"
            >
              ⇅
            </button>
          </div>
        </div>
      </header>
    )
  }

  // Desktop layout
  return (
    <header className="absolute top-0 left-0 right-0 z-20 pointer-events-none">
      <div className="p-4 flex items-start gap-3 max-w-4xl">
        {/* Logo */}
        <div className="pointer-events-auto flex items-center gap-2 bg-[#0a0a0f]/90 backdrop-blur-md rounded-xl px-4 py-3 border border-[#1a1a2e] shrink-0">
          <span className="text-[#ff2d55] font-black text-lg tracking-tighter">
            HOTFIX
          </span>
        </div>

        {/* Search bars */}
        <div className="pointer-events-auto flex-1 flex items-center gap-2 max-w-2xl">
          <div className="flex-1">
            <SearchBar
              placeholder="Starting point..."
              value={originName}
              icon="🟢"
              accentColor="#22c55e"
              onSelect={(coords, name) => setOrigin(coords, name)}
              onClear={() => setOrigin(null)}
            />
          </div>

          {/* Swap button */}
          <button
            onClick={swapLocations}
            className="shrink-0 w-10 h-10 rounded-xl bg-[#1a1a2e] border border-[#2a2a3e] flex items-center justify-center text-[#6a6a8a] hover:text-[#ff2d55] hover:border-[#ff2d55] transition-all active:scale-95"
            title="Swap origin and destination"
          >
            ⇄
          </button>

          <div className="flex-1">
            <SearchBar
              placeholder="Where to?"
              value={destinationName}
              icon="🏁"
              accentColor="#ff2d55"
              onSelect={(coords, name) => setDestination(coords, name)}
              onClear={() => setDestination(null)}
            />
          </div>
        </div>
      </div>
    </header>
  )
}
