import { create } from 'zustand'
import type { RoutePoint, ScoredRoute, RouteLoadingState } from '../types/route'
import { fetchRoutes } from '../lib/mapbox'
import { generateLoopRoutes, type LoopDuration, type LoopStyle, type LoopType, type LoopRoute } from '../lib/loopRouter'

type AppMode = 'ab' | 'loop'

interface RouteState {
  // Mode
  mode: AppMode
  setMode: (mode: AppMode) => void

  // Locations
  origin: RoutePoint | null
  originName: string
  destination: RoutePoint | null
  destinationName: string

  // Loop settings
  loopDuration: LoopDuration
  loopStyle: LoopStyle
  loopType: LoopType
  setLoopDuration: (d: LoopDuration) => void
  setLoopStyle: (s: LoopStyle) => void
  setLoopType: (t: LoopType) => void

  // Routes
  routes: ScoredRoute[]
  loopRoutes: LoopRoute[]
  selectedRouteId: string | null
  loadingState: RouteLoadingState
  loadingStage: string
  loadingProgress: number
  error: string | null
  lowFloorabilityWarning: boolean // Fix 3: true when all routes score below threshold

  // Actions
  setOrigin: (point: RoutePoint | null, name?: string) => void
  setDestination: (point: RoutePoint | null, name?: string) => void
  selectRoute: (id: string) => void
  calculateRoutes: () => Promise<void>
  calculateLoopRoutes: () => Promise<void>
  clearRoutes: () => void
  swapLocations: () => void
}

export const useRouteStore = create<RouteState>((set, get) => ({
  mode: 'ab',
  origin: null,
  originName: '',
  destination: null,
  destinationName: '',
  loopDuration: 30,
  loopStyle: 'best',
  loopType: 'anchor',
  routes: [],
  loopRoutes: [],
  selectedRouteId: null,
  loadingState: 'idle',
  loadingStage: '',
  loadingProgress: 0,
  error: null,
  lowFloorabilityWarning: false,

  setMode: (mode) => {
    set({ mode, routes: [], loopRoutes: [], selectedRouteId: null, loadingState: 'idle', error: null })
  },

  setLoopDuration: (d) => {
    set({ loopDuration: d })
    const state = get()
    if (state.mode === 'loop' && state.origin) {
      void get().calculateLoopRoutes()
    }
  },

  setLoopStyle: (s) => {
    set({ loopStyle: s })
    const state = get()
    if (state.mode === 'loop' && state.origin) {
      void get().calculateLoopRoutes()
    }
  },

  setLoopType: (t) => {
    set({ loopType: t })
    const state = get()
    if (state.mode === 'loop' && state.origin) {
      void get().calculateLoopRoutes()
    }
  },

  setOrigin: (point, name = '') => {
    set({ origin: point, originName: name })
    const state = get()
    if (state.mode === 'loop' && point) {
      void get().calculateLoopRoutes()
    } else if (state.mode === 'ab' && point && state.destination) {
      void get().calculateRoutes()
    }
  },

  setDestination: (point, name = '') => {
    set({ destination: point, destinationName: name })
    const state = get()
    if (state.mode === 'ab' && state.origin && point) {
      void get().calculateRoutes()
    }
  },

  selectRoute: (id) => set({ selectedRouteId: id }),

  calculateRoutes: async () => {
    const { origin, destination } = get()
    if (!origin || !destination) return

    set({ loadingState: 'loading', error: null, routes: [], loopRoutes: [], selectedRouteId: null, loadingStage: 'Calculating routes...', loadingProgress: 0.5 })

    try {
      const routes = await fetchRoutes(
        [origin.lng, origin.lat],
        [destination.lng, destination.lat]
      )
      set({
        routes,
        selectedRouteId: routes[0]?.id || null,
        loadingState: 'success',
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to calculate routes'
      set({ loadingState: 'error', error: message })
    }
  },

  calculateLoopRoutes: async () => {
    const { origin, loopDuration, loopStyle, loopType } = get()
    if (!origin) return

    set({
      loadingState: 'loading',
      error: null,
      routes: [],
      loopRoutes: [],
      selectedRouteId: null,
      loadingStage: 'Generating loops...',
      loadingProgress: 0,
      lowFloorabilityWarning: false,
    })

    try {
      const loops = await generateLoopRoutes(
        [origin.lng, origin.lat],
        loopDuration,
        loopStyle,
        (stage, progress) => {
          set({ loadingStage: stage, loadingProgress: progress })
        },
        loopType
      )

      // Fix 3: Check if all routes are below minimum score threshold
      const allLowScore = loops.length > 0 && loops.every((l) => l.floorability.totalScore < 25)

      set({
        loopRoutes: loops,
        routes: loops, // Also set as routes for map rendering
        selectedRouteId: loops[0]?.id || null,
        loadingState: 'success',
        lowFloorabilityWarning: allLowScore,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate loop routes'
      set({ loadingState: 'error', error: message })
    }
  },

  clearRoutes: () =>
    set({
      routes: [],
      loopRoutes: [],
      selectedRouteId: null,
      loadingState: 'idle',
      error: null,
    }),

  swapLocations: () => {
    const { origin, originName, destination, destinationName, mode } = get()
    if (mode === 'loop') return // no swap in loop mode
    set({
      origin: destination,
      originName: destinationName,
      destination: origin,
      destinationName: originName,
    })
    if (origin && destination) {
      void get().calculateRoutes()
    }
  },
}))
