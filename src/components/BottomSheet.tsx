import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouteStore } from '../store/routeStore'

interface BottomSheetProps {
  children: React.ReactNode
}

type SheetPosition = 'collapsed' | 'loading' | 'peek' | 'expanded'

const COLLAPSED_HEIGHT = 48
const LOADING_HEIGHT = 120  // Just enough for spinner + progress bar
const PEEK_HEIGHT_RATIO = 0.4
const EXPANDED_HEIGHT_RATIO = 0.85

export default function BottomSheet({ children }: BottomSheetProps) {
  const [position, setPosition] = useState<SheetPosition>('peek')
  const [dragOffset, setDragOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  const dragStartY = useRef(0)
  const dragStartHeight = useRef(0)

  const { routes, loadingState } = useRouteStore()

  // Auto-expand when routes arrive
  useEffect(() => {
    if (routes.length > 0) {
      setPosition('peek')
    }
  }, [routes])

  // Stay small while loading — just enough to show progress, not eat the map
  useEffect(() => {
    if (loadingState === 'loading') {
      setPosition('loading')
    }
    // Show error state properly
    if (loadingState === 'error') {
      setPosition('peek')
    }
  }, [loadingState])

  // Auto-collapse when idle
  useEffect(() => {
    if (loadingState === 'idle' && routes.length === 0) {
      setPosition('collapsed')
    }
  }, [loadingState, routes.length])

  const getHeight = useCallback(
    (pos: SheetPosition): number => {
      const vh = window.innerHeight
      switch (pos) {
        case 'collapsed':
          return COLLAPSED_HEIGHT
        case 'loading':
          return LOADING_HEIGHT
        case 'peek':
          return vh * PEEK_HEIGHT_RATIO
        case 'expanded':
          return vh * EXPANDED_HEIGHT_RATIO
      }
    },
    []
  )

  const currentHeight = getHeight(position) + dragOffset

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      setIsDragging(true)
      dragStartY.current = e.touches[0].clientY
      dragStartHeight.current = getHeight(position)
    },
    [position, getHeight]
  )

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isDragging) return
      const deltaY = dragStartY.current - e.touches[0].clientY
      setDragOffset(deltaY)
    },
    [isDragging]
  )

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false)
    const finalHeight = dragStartHeight.current + dragOffset
    const vh = window.innerHeight

    // Snap to nearest position (skip 'loading' — that's automatic only)
    const peekH = vh * PEEK_HEIGHT_RATIO
    const expandedH = vh * EXPANDED_HEIGHT_RATIO
    const collapsedH = COLLAPSED_HEIGHT

    const distCollapsed = Math.abs(finalHeight - collapsedH)
    const distPeek = Math.abs(finalHeight - peekH)
    const distExpanded = Math.abs(finalHeight - expandedH)

    const min = Math.min(distCollapsed, distPeek, distExpanded)
    if (min === distCollapsed) setPosition('collapsed')
    else if (min === distExpanded) setPosition('expanded')
    else setPosition('peek')

    setDragOffset(0)
  }, [dragOffset])

  const handleClick = useCallback(() => {
    if (position === 'collapsed') {
      setPosition('peek')
    }
  }, [position])

  return (
    <div
      ref={sheetRef}
      className="fixed bottom-0 left-0 right-0 z-30 flex flex-col bg-[#0f0f1a]/98 backdrop-blur-xl border-t border-[#2a2a3e] rounded-t-2xl"
      style={{
        height: `${Math.max(COLLAPSED_HEIGHT, currentHeight)}px`,
        transition: isDragging ? 'none' : 'height 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
        willChange: 'height',
      }}
    >
      {/* Drag handle */}
      <div
        className="flex-shrink-0 flex flex-col items-center pt-2 pb-1 cursor-grab active:cursor-grabbing touch-none"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleClick}
      >
        <div className="w-10 h-1 rounded-full bg-[#3a3a4e] mb-1" />
        {(position === 'collapsed') && (
          <div className="flex items-center gap-2 py-1">
            <span className="text-[#ff2d55] font-black text-xs tracking-tighter">HOTFIX</span>
            {routes.length > 0 && (
              <span className="text-[10px] text-[#6a6a8a]">
                {routes.length} route{routes.length !== 1 ? 's' : ''} • Tap to view
              </span>
            )}
            {routes.length === 0 && (
              <span className="text-[10px] text-[#6a6a8a]">Tap to expand</span>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {children}
      </div>
    </div>
  )
}
