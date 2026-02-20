import type { MapboxRoute, ScoredRoute } from '../types/route'
import { generateRouteName, generateHighlights } from './routeNamer'
import { osrmFetch, routePathWithAlts } from './osrm'

// Route colors — ordered by visual distinctness
const ROUTE_COLORS = [
  '#ff2d55', // Electric red (primary)
  '#ffb800', // Amber gold
  '#00d4ff', // Cyan
  '#a855f7', // Purple
  '#22c55e', // Green
]

interface OSRMRoute {
  distance: number
  duration: number
  geometry: {
    type: 'LineString'
    coordinates: [number, number][]
  }
  legs: {
    distance: number
    duration: number
    summary: string
    steps: {
      name: string
      distance: number
      duration: number
      maneuver: {
        type: string
        instruction: string
      }
    }[]
  }[]
}

interface OSRMResponse {
  code: string
  routes: OSRMRoute[]
}

export async function fetchRoutes(
  origin: [number, number],
  destination: [number, number]
): Promise<ScoredRoute[]> {
  const coords = `${origin[0]},${origin[1]};${destination[0]},${destination[1]}`

  const response = await osrmFetch(routePathWithAlts(coords))
  if (!response.ok) {
    throw new Error(`Routing error: ${response.status} ${response.statusText}`)
  }

  const data: OSRMResponse = await response.json()
  if (data.code !== 'Ok') {
    throw new Error(`Routing error: ${data.code}`)
  }

  if (data.routes.length === 0) {
    throw new Error('No routes found between these points')
  }

  // Convert OSRM routes to our MapboxRoute format (same structure)
  const routes: MapboxRoute[] = data.routes.map((r) => ({
    distance: r.distance,
    duration: r.duration,
    geometry: r.geometry,
    legs: r.legs.map((leg) => ({
      distance: leg.distance,
      duration: leg.duration,
      summary: leg.summary,
      steps: leg.steps.map((step: { name: string; ref?: string; distance: number; duration: number; maneuver: { type: string; instruction: string } }) => ({
        name: step.name,
        ref: step.ref || '',
        distance: step.distance,
        duration: step.duration,
        maneuver: {
          type: step.maneuver.type,
          instruction: step.maneuver.instruction || '',
        },
      })),
    })),
    weight: r.duration,
    weight_name: 'duration',
  }))

  return scoreRoutes(routes)
}

function scoreRoutes(routes: MapboxRoute[]): ScoredRoute[] {
  const fastestDuration = Math.min(...routes.map((r) => r.duration))
  const slowestIdx = routes.reduce(
    (maxI, r, i, arr) => (r.duration > arr[maxI].duration ? i : maxI),
    0
  )

  return routes.map((route, index) => {
    const durationMin = Math.round(route.duration / 60)
    const fastestMin = Math.round(fastestDuration / 60)
    const deltaMin = durationMin - fastestMin
    const isFastest = route.duration === fastestDuration
    const isSlowest = index === slowestIdx

    const name = generateRouteName(route, index, isFastest, isSlowest)
    const highlights = generateHighlights(route)

    return {
      id: `route-${index}`,
      name,
      mapboxRoute: route,
      distanceMi: parseFloat((route.distance / 1609.34).toFixed(1)),
      durationMin,
      deltaMin,
      isFastest,
      color: ROUTE_COLORS[index % ROUTE_COLORS.length],
      highlights,
    }
  })
}

// Nominatim geocoding (free, no API key)
export interface GeocodingResult {
  id: string
  place_name: string
  center: [number, number]
}

export async function geocodeSearch(query: string): Promise<GeocodingResult[]> {
  if (!query || query.length < 2) return []

  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', '5')
  url.searchParams.set('countrycodes', 'us')
  url.searchParams.set('addressdetails', '1')

  const response = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'Hotfix-App/1.0',
    },
  })
  if (!response.ok) return []

  interface NominatimResult {
    place_id: number
    display_name: string
    lon: string
    lat: string
  }

  const data: NominatimResult[] = await response.json()
  return data.map((item) => ({
    id: String(item.place_id),
    place_name: item.display_name,
    center: [parseFloat(item.lon), parseFloat(item.lat)] as [number, number],
  }))
}
