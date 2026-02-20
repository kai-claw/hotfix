/**
 * Route Export — Generate navigation app links + GPX files
 * 
 * Supports:
 * - Apple Maps URL (14 waypoints via +to: separator)
 * - Google Maps URL (20 waypoints via path format)
 * - Waze URL (single destination)
 * - GPX file download (every coordinate — max accuracy)
 */

import type { ScoredRoute } from '../types/route'

/**
 * Sample waypoints along a route, prioritizing turns and decision points.
 * These are the points where a nav app could choose the wrong road
 * if we don't pin them down. More points = better route fidelity.
 */
function sampleWaypoints(
  coords: [number, number][],
  maxPoints: number = 20
): [number, number][] {
  if (coords.length <= maxPoints) return coords

  // Phase 1: Find ALL significant turns (heading change > 20°)
  const turnScores: { idx: number; score: number }[] = []
  // Use a 3-point window with a gap for noise resistance
  const gap = Math.max(2, Math.floor(coords.length / 200))
  for (let i = gap; i < coords.length - gap; i++) {
    const angle1 = Math.atan2(
      coords[i][1] - coords[i - gap][1],
      coords[i][0] - coords[i - gap][0]
    )
    const angle2 = Math.atan2(
      coords[i + gap][1] - coords[i][1],
      coords[i + gap][0] - coords[i][0]
    )
    let change = Math.abs(angle2 - angle1)
    if (change > Math.PI) change = 2 * Math.PI - change
    if (change > 0.35) { // ~20 degrees
      turnScores.push({ idx: i, score: change })
    }
  }

  // Sort by turn sharpness (biggest turns first)
  turnScores.sort((a, b) => b.score - a.score)

  // Phase 2: Greedily pick turn points with minimum spacing
  const minSpacing = Math.floor(coords.length / (maxPoints * 1.5))
  const picked = new Set<number>([0, coords.length - 1])
  const result: number[] = [0]

  for (const { idx } of turnScores) {
    if (result.length >= maxPoints - 1) break
    const tooClose = [...picked].some(p => Math.abs(p - idx) < minSpacing)
    if (!tooClose) {
      result.push(idx)
      picked.add(idx)
    }
  }

  // Phase 3: Fill remaining slots with evenly-spaced points
  const remaining = maxPoints - result.length - 1 // -1 for end
  if (remaining > 0) {
    const step = Math.floor(coords.length / (remaining + 1))
    for (let i = step; result.length < maxPoints - 1 && i < coords.length - 1; i += step) {
      const tooClose = [...picked].some(p => Math.abs(p - i) < Math.floor(minSpacing / 2))
      if (!tooClose) {
        result.push(i)
        picked.add(i)
      }
    }
  }

  // End point
  result.push(coords.length - 1)

  // Sort by index order (route sequence matters!)
  result.sort((a, b) => a - b)

  return result.map(i => coords[i])
}

/** Format a coordinate pair as "lat,lng" with 6 decimal places */
function fmtCoord([lng, lat]: [number, number]): string {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`
}

/** Check if a route is a loop (start ≈ end) */
function isLoopRoute(coords: [number, number][]): boolean {
  const s = coords[0], e = coords[coords.length - 1]
  return Math.abs(s[0] - e[0]) < 0.001 && Math.abs(s[1] - e[1]) < 0.001
}

/**
 * Generate Apple Maps URL
 * 
 * IMPORTANT: Apple Maps web URLs (maps.apple.com) do NOT support multi-stop
 * directions. The "+to:" separator is a legacy Google Maps convention that
 * Apple Maps ignores — it treats the whole daddr as one address string.
 * 
 * Best we can do: single A→B direction from start to farthest waypoint,
 * which at least gets you driving in the right direction on the route.
 * For full route fidelity, use Google Maps (20 waypoints) or GPX.
 */
export function getAppleMapsUrl(route: ScoredRoute): string {
  const coords = route.mapboxRoute.geometry.coordinates
  if (coords.length < 2) return ''

  const start = coords[0]

  if (isLoopRoute(coords)) {
    // For loops: navigate to the farthest point from start (apex of the loop).
    // This gets you driving the first half of the route correctly.
    let farthestIdx = 0
    let maxDist = 0
    for (let i = 0; i < coords.length; i++) {
      const d = (coords[i][0] - start[0]) ** 2 + (coords[i][1] - start[1]) ** 2
      if (d > maxDist) {
        maxDist = d
        farthestIdx = i
      }
    }
    const apex = coords[farthestIdx]
    return `https://maps.apple.com/?saddr=${fmtCoord(start)}&daddr=${fmtCoord(apex)}&dirflg=d`
  }

  // A→B route: simple start to end
  const end = coords[coords.length - 1]
  return `https://maps.apple.com/?saddr=${fmtCoord(start)}&daddr=${fmtCoord(end)}&dirflg=d`
}

/**
 * Generate Google Maps URL — PRIMARY NAV EXPORT
 * 
 * Uses the path-based format: /maps/dir/lat,lng/lat,lng/...
 * This is the same format Google Maps generates when sharing routes.
 * Supports ~23 waypoints, no query encoding issues.
 * We use 20 turn-sampled waypoints for high route fidelity.
 */
export function getGoogleMapsUrl(route: ScoredRoute): string {
  const coords = route.mapboxRoute.geometry.coordinates
  if (coords.length < 2) return ''

  // 20 waypoints for excellent route reproduction
  const waypoints = sampleWaypoints(coords, 20)

  // For loops, ensure the last point returns to start
  if (isLoopRoute(coords)) {
    waypoints[waypoints.length - 1] = waypoints[0]
  }

  // Path-based format — each coordinate is a path segment
  // No encoding needed, works on web and mobile app
  const path = waypoints.map(fmtCoord).join('/')

  return `https://www.google.com/maps/dir/${path}`
}

/**
 * Generate Waze URL
 */
export function getWazeUrl(route: ScoredRoute): string {
  const coords = route.mapboxRoute.geometry.coordinates
  if (coords.length < 2) return ''

  // Waze only supports single destination - use the farthest waypoint
  const midIdx = Math.floor(coords.length / 2)
  const mid = coords[midIdx]

  return `https://waze.com/ul?ll=${mid[1]},${mid[0]}&navigate=yes`
}

/**
 * Generate GPX file content
 * GPX is the most accurate — includes every coordinate
 */
export function generateGpx(route: ScoredRoute): string {
  const coords = route.mapboxRoute.geometry.coordinates
  const name = route.name.replace(/[<>&'"]/g, '')
  const now = new Date().toISOString()

  const trackpoints = coords
    .map(([lng, lat]) => `      <trkpt lat="${lat}" lon="${lng}"></trkpt>`)
    .join('\n')

  // Add waypoints at key turns for navigation guidance
  const waypoints = sampleWaypoints(coords, 20)
  const waypointXml = waypoints
    .map(([lng, lat], i) => {
      const wpName = i === 0 ? 'Start' : i === waypoints.length - 1 ? 'End' : `Turn ${i}`
      return `  <wpt lat="${lat}" lon="${lng}">\n    <name>${wpName}</name>\n  </wpt>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Hotfix - Route Like You Mean It"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${name}</name>
    <desc>Generated by Hotfix — ${route.distanceMi} mi, ${route.durationMin} min</desc>
    <time>${now}</time>
  </metadata>
${waypointXml}
  <trk>
    <name>${name}</name>
    <trkseg>
${trackpoints}
    </trkseg>
  </trk>
</gpx>`
}

/**
 * Download GPX file
 */
export function downloadGpx(route: ScoredRoute): void {
  const gpxContent = generateGpx(route)
  const blob = new Blob([gpxContent], { type: 'application/gpx+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `hotfix-${route.name.toLowerCase().replace(/\s+/g, '-')}.gpx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Check if running on iOS (for Apple Maps priority)
 */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}
