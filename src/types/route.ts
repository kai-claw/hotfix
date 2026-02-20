export interface RoutePoint {
  lng: number
  lat: number
}

export interface RouteStep {
  name: string
  ref: string           // highway reference (e.g., "US 9", "I-87")
  distance: number
  duration: number
  maneuver: {
    type: string
    instruction: string
  }
}

export interface RouteLeg {
  distance: number
  duration: number
  steps: RouteStep[]
  summary: string
}

export interface RouteGeometry {
  type: 'LineString'
  coordinates: [number, number][]
}

export interface MapboxRoute {
  distance: number // meters
  duration: number // seconds
  geometry: RouteGeometry
  legs: RouteLeg[]
  weight: number
  weight_name: string
}

export interface ScoredRoute {
  id: string
  name: string
  mapboxRoute: MapboxRoute
  distanceMi: number
  durationMin: number
  deltaMin: number // +X min vs fastest
  isFastest: boolean
  color: string
  highlights: string[]
  // Phase 2: thrillScore, subscores, etc.
}

export type RouteLoadingState = 'idle' | 'loading' | 'success' | 'error'
