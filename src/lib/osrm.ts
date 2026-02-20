/**
 * OSRM Client with automatic failover
 * 
 * Primary: router.project-osrm.org (official demo)
 * Fallback: routing.openstreetmap.de (FOSSGIS community instance)
 * 
 * If the primary fails (timeout, connection refused, 5xx), 
 * all subsequent requests use the fallback for the rest of the session.
 */

const OSRM_SERVERS = [
  'https://router.project-osrm.org',
  'https://routing.openstreetmap.de/routed-car',
]

let activeServerIndex = 0
let failoverTimestamp = 0

/** Reset to primary after 5 minutes */
const FAILOVER_RESET_MS = 5 * 60 * 1000

function resetIfExpired(): void {
  if (activeServerIndex > 0 && Date.now() - failoverTimestamp > FAILOVER_RESET_MS) {
    activeServerIndex = 0
  }
}

function failover(): void {
  if (activeServerIndex < OSRM_SERVERS.length - 1) {
    activeServerIndex++
    failoverTimestamp = Date.now()
    console.warn(`[OSRM] Failing over to ${OSRM_SERVERS[activeServerIndex]}`)
  }
}

/**
 * Fetch from OSRM with timeout and automatic failover.
 * If the current server fails, switches to the next and retries once.
 */
export async function osrmFetch(path: string, timeoutMs: number = 8000): Promise<Response> {
  resetIfExpired()

  const tryServer = async (serverIndex: number): Promise<Response> => {
    const url = `${OSRM_SERVERS[serverIndex]}${path}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (response.status >= 500) {
        throw new Error(`Server error: ${response.status}`)
      }
      return response
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    return await tryServer(activeServerIndex)
  } catch (err) {
    // If primary failed and there's a fallback, try it
    if (activeServerIndex < OSRM_SERVERS.length - 1) {
      failover()
      return tryServer(activeServerIndex)
    }
    throw err
  }
}

/**
 * Build a route URL path for OSRM
 */
export function routePath(coords: string): string {
  return `/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`
}

/**
 * Build a route URL path with alternatives
 */
export function routePathWithAlts(coords: string): string {
  return `/route/v1/driving/${coords}?alternatives=true&geometries=geojson&overview=full&steps=true`
}

/**
 * Build a trip URL path for OSRM (round-trip optimization)
 */
export function tripPath(coords: string): string {
  return `/trip/v1/driving/${coords}?source=first&destination=last&roundtrip=true&geometries=geojson&overview=full&steps=true`
}
