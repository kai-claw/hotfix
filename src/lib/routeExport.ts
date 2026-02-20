/**
 * Route Export — Generate navigation app links + GPX files
 * 
 * Supports:
 * - Apple Maps URL (maps:// scheme with waypoints)
 * - Google Maps URL (via waypoints)
 * - GPX file download (universal)
 */

import type { ScoredRoute } from '../types/route'

/**
 * Sample waypoints along a route, emphasizing key turns and direction changes.
 * More points = more accurate route reproduction in nav apps.
 */
function sampleWaypoints(
  coords: [number, number][],
  maxPoints: number = 15
): [number, number][] {
  if (coords.length <= maxPoints) return coords

  // Always include start and end
  const result: [number, number][] = [coords[0]]

  // Pick points at regular intervals plus points where direction changes significantly
  const step = Math.max(1, Math.floor(coords.length / (maxPoints - 2)))

  for (let i = step; i < coords.length - 1; i += step) {
    // Check if there's a significant turn near this point
    let bestIdx = i
    let bestAngleChange = 0
    const searchRadius = Math.min(step, 20)

    for (let j = Math.max(1, i - searchRadius); j < Math.min(coords.length - 1, i + searchRadius); j++) {
      if (j < 1 || j >= coords.length - 1) continue
      const angle1 = Math.atan2(
        coords[j][1] - coords[j - 1][1],
        coords[j][0] - coords[j - 1][0]
      )
      const angle2 = Math.atan2(
        coords[j + 1][1] - coords[j][1],
        coords[j + 1][0] - coords[j][0]
      )
      let change = Math.abs(angle2 - angle1)
      if (change > Math.PI) change = 2 * Math.PI - change
      if (change > bestAngleChange) {
        bestAngleChange = change
        bestIdx = j
      }
    }

    result.push(coords[bestIdx])
    if (result.length >= maxPoints - 1) break
  }

  // Always include the last point
  result.push(coords[coords.length - 1])

  return result
}

/**
 * Generate Apple Maps URL
 * Uses maps.apple.com which opens Apple Maps app on iOS.
 * 
 * Apple Maps only reliably supports ~3-5 stops via URL.
 * We use 4 carefully-chosen waypoints (key turns) so the route
 * actually renders instead of silently failing.
 */
export function getAppleMapsUrl(route: ScoredRoute): string {
  const coords = route.mapboxRoute.geometry.coordinates
  if (coords.length < 2) return ''

  const start = coords[0]
  const end = coords[coords.length - 1]
  // Apple Maps chokes on many waypoints — use 4 key turn points max
  const waypoints = sampleWaypoints(coords, 6) // start + 4 mid + end

  // Build daddr with +to: separator (skip start, include all stops through end)
  const stops = waypoints.slice(1)
  
  // Check if route is a loop (start ≈ end)
  const isLoop = Math.abs(start[0] - end[0]) < 0.001 && Math.abs(start[1] - end[1]) < 0.001
  
  // For loops, make sure the last stop is the start point
  if (isLoop) {
    stops[stops.length - 1] = start
  }

  const waypointStr = stops
    .map(([lng, lat]) => `${lat},${lng}`)
    .join('+to:')

  return `https://maps.apple.com/?saddr=${start[1]},${start[0]}&daddr=${waypointStr}&dirflg=d`
}

/**
 * Generate Google Maps URL
 * Google Maps supports waypoints in the URL
 */
export function getGoogleMapsUrl(route: ScoredRoute): string {
  const coords = route.mapboxRoute.geometry.coordinates
  if (coords.length < 2) return ''

  // Google Maps URL has a length limit (~2048 chars) so we need fewer points
  // but use the turn-detection sampling for better accuracy
  const waypoints = sampleWaypoints(coords, 10)

  const start = waypoints[0]
  const end = waypoints[waypoints.length - 1]
  const mid = waypoints.slice(1, -1)

  // Use the Google Maps directions URL with waypoints parameter
  const origin = `${start[1]},${start[0]}`
  const destination = `${end[1]},${end[0]}`

  if (mid.length > 0) {
    const waypointStr = mid.map(([lng, lat]) => `${lat},${lng}`).join('|')
    return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&waypoints=${encodeURIComponent(waypointStr)}&travelmode=driving`
  }

  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`
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
