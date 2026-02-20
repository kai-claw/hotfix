import { create } from 'zustand'
import type { RoutePoint, ScoredRoute, RouteLoadingState } from '../types/route'
import { fetchRoutes } from '../lib/mapbox'

interface RouteState {
  // Locations
  origin: RoutePoint | null
  originName: string
  destination: RoutePoint | null
  destinationName: string

  // Routes
  routes: ScoredRoute[]
  selectedRouteId: string | null
  loadingState: RouteLoadingState
  error: string | null

  // Actions
  setOrigin: (point: RoutePoint | null, name?: string) => void
  setDestination: (point: RoutePoint | null, name?: string) => void
  selectRoute: (id: string) => void
  calculateRoutes: () => Promise<void>
  clearRoutes: () => void
  swapLocations: () => void
}

export const useRouteStore = create<RouteState>((set, get) => ({
  origin: null,
  originName: '',
  destination: null,
  destinationName: '',
  routes: [],
  selectedRouteId: null,
  loadingState: 'idle',
  error: null,

  setOrigin: (point, name = '') => {
    set({ origin: point, originName: name })
    // Auto-calculate if both points set
    const state = get()
    if (point && state.destination) {
      void get().calculateRoutes()
    }
  },

  setDestination: (point, name = '') => {
    set({ destination: point, destinationName: name })
    const state = get()
    if (state.origin && point) {
      void get().calculateRoutes()
    }
  },

  selectRoute: (id) => set({ selectedRouteId: id }),

  calculateRoutes: async () => {
    const { origin, destination } = get()
    if (!origin || !destination) return

    set({ loadingState: 'loading', error: null, routes: [], selectedRouteId: null })

    try {
      const routes = await fetchRoutes(
        [origin.lng, origin.lat],
        [destination.lng, destination.lat]
      )
      // Auto-select the first route (usually the recommended one)
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

  clearRoutes: () =>
    set({
      routes: [],
      selectedRouteId: null,
      loadingState: 'idle',
      error: null,
    }),

  swapLocations: () => {
    const { origin, originName, destination, destinationName } = get()
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
