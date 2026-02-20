import SearchBar from './SearchBar'
import { useRouteStore } from '../store/routeStore'
import { useIsMobile } from '../hooks/useMediaQuery'
import type { LoopDuration } from '../lib/loopRouter'

const DURATION_OPTIONS: { value: LoopDuration; label: string }[] = [
  { value: 15, label: '15m' },
  { value: 30, label: '30m' },
  { value: 60, label: '60m' },
]

export default function Header() {
  const {
    mode,
    setMode,
    originName,
    destinationName,
    loopDuration,
    setLoopDuration,
    setOrigin,
    setDestination,
    swapLocations,
  } = useRouteStore()

  const isMobile = useIsMobile()

  return (
    <header className="absolute top-0 left-0 right-0 z-20 pointer-events-none">
      <div className={`${isMobile ? 'p-3' : 'p-4'} flex flex-col gap-2`}>
        {/* Top row: Logo + Mode toggle */}
        <div className="pointer-events-auto flex items-center gap-2">
          {/* Logo */}
          <div className="flex items-center bg-[#0a0a0f]/90 backdrop-blur-md rounded-xl px-3 py-2 border border-[#1a1a2e] shrink-0">
            <span className="text-[#ff2d55] font-black text-base tracking-tighter">
              {isMobile ? 'HF' : 'HOTFIX'}
            </span>
          </div>

          {/* Mode toggle */}
          <div className="flex bg-[#1a1a2e]/90 backdrop-blur-md rounded-xl border border-[#2a2a3e] p-0.5">
            <button
              onClick={() => setMode('ab')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                mode === 'ab'
                  ? 'bg-[#ff2d55] text-white'
                  : 'text-[#6a6a8a] hover:text-white'
              }`}
            >
              A → B
            </button>
            <button
              onClick={() => setMode('loop')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                mode === 'loop'
                  ? 'bg-[#ff2d55] text-white'
                  : 'text-[#6a6a8a] hover:text-white'
              }`}
            >
              🔄 Loop
            </button>
          </div>

          {/* Loop duration pills (only in loop mode) */}
          {mode === 'loop' && (
            <div className="flex bg-[#1a1a2e]/90 backdrop-blur-md rounded-xl border border-[#2a2a3e] p-0.5">
              {DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setLoopDuration(opt.value)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    loopDuration === opt.value
                      ? 'bg-[#ffb800] text-black'
                      : 'text-[#6a6a8a] hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Search bars row */}
        <div className="pointer-events-auto flex items-center gap-2">
          {mode === 'loop' ? (
            /* Loop mode: single search bar */
            <div className="flex-1 max-w-lg">
              <SearchBar
                placeholder="Start from..."
                value={originName}
                icon="📍"
                accentColor="#ff2d55"
                onSelect={(coords, name) => setOrigin(coords, name)}
                onClear={() => setOrigin(null)}
                compact={isMobile}
              />
            </div>
          ) : (
            /* A→B mode: two search bars */
            <>
              <div className={`flex-1 ${isMobile ? '' : 'max-w-sm'}`}>
                <SearchBar
                  placeholder="Starting point..."
                  value={originName}
                  icon="🟢"
                  accentColor="#22c55e"
                  onSelect={(coords, name) => setOrigin(coords, name)}
                  onClear={() => setOrigin(null)}
                  compact={isMobile}
                />
              </div>

              <button
                onClick={swapLocations}
                className={`shrink-0 rounded-lg bg-[#1a1a2e]/90 backdrop-blur-md border border-[#2a2a3e] flex items-center justify-center text-[#6a6a8a] hover:text-[#ff2d55] active:scale-95 transition-all ${
                  isMobile ? 'w-9 h-9 text-sm' : 'w-10 h-10'
                }`}
                title="Swap"
              >
                {isMobile ? '⇅' : '⇄'}
              </button>

              <div className={`flex-1 ${isMobile ? '' : 'max-w-sm'}`}>
                <SearchBar
                  placeholder="Where to?"
                  value={destinationName}
                  icon="🏁"
                  accentColor="#ff2d55"
                  onSelect={(coords, name) => setDestination(coords, name)}
                  onClear={() => setDestination(null)}
                  compact={isMobile}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
