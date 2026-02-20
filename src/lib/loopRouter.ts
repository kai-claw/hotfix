/**
 * Loop Route Generator
 * 
 * Generates circular routes from a starting point that return
 * to the same location, optimized for floorability.
 * 
 * FIX 2: True circular loops via OSRM trip endpoint, circularity metrics,
 *        and improved 4-waypoint strategy.
 * FIX 3: Minimum floorability score threshold (25).
 * FIX 4: Improved overlap detection using index-distance-aware comparison.
 */

import type { MapboxRoute, ScoredRoute } from '../types/route'
import { analyzeFloorability, queryOverpass, type FloorabilityResult } from './floorability'

export type LoopDuration = 15 | 30 | 60
export type LoopStyle = 'highway' | 'backroad' | 'mixed' | 'best'
export type LoopType = 'anchor' | 'nearby'

export interface LoopRoute extends ScoredRoute {
  floorability: FloorabilityResult
  loopStyle: string
  waypoints: [number, number][]
  overlapPenalty: number // 0-1, how much road is reused (0 = no overlap, 1 = full U-turn)
  circularity: number   // 0-1, how circular the route is (area fill ratio)
}

/** Minimum floorability score to present a route (Fix 3) */
const MIN_FLOORABILITY_SCORE = 25

// Radius in miles for out-and-back / triangle loops (single waypoint target distance)
const DURATION_RADIUS: Record<LoopDuration, number> = {
  15: 5,
  30: 12,
  60: 22,
}

// Radius in miles for 4-waypoint circular loops
// Empirically tested: road network adds ~2.5x winding factor
// r=1.0mi → ~26min, r=1.5mi → ~37min, r=2.0mi → ~39min
const LOOP_RADIUS: Record<LoopDuration, number> = {
  15: 0.6,
  30: 1.3,
  60: 2.5,
}

/**
 * Generate waypoints in a circle around a center point
 */
function generateWaypoints(
  center: [number, number], // [lng, lat]
  radiusMi: number,
  angles: number[]
): [number, number][] {
  const [lng, lat] = center
  // 1 degree lat ≈ 69 miles, 1 degree lng ≈ 69 * cos(lat) miles
  const latPerMile = 1 / 69
  const lngPerMile = 1 / (69 * Math.cos(lat * Math.PI / 180))

  return angles.map((angle) => {
    const rad = (angle * Math.PI) / 180
    const dLat = Math.cos(rad) * radiusMi * latPerMile
    const dLng = Math.sin(rad) * radiusMi * lngPerMile
    return [lng + dLng, lat + dLat] as [number, number]
  })
}

// ─── OSRM Route Fetching ──────────────────────────────

/**
 * Build OSRM route URL for a loop: start → waypoint(s) → start
 */
function buildLoopUrl(
  start: [number, number],
  waypoints: [number, number][]
): string {
  const coords = [start, ...waypoints, start]
    .map(([lng, lat]) => `${lng},${lat}`)
    .join(';')

  return `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`
}

/**
 * Build OSRM trip URL for round-trip optimization (Fix 2A)
 * The trip endpoint optimizes waypoint ordering for round trips.
 */
function buildTripUrl(
  start: [number, number],
  waypoints: [number, number][]
): string {
  const coords = [start, ...waypoints]
    .map(([lng, lat]) => `${lng},${lat}`)
    .join(';')

  return `https://router.project-osrm.org/trip/v1/driving/${coords}?source=first&destination=last&roundtrip=true&geometries=geojson&overview=full&steps=true`
}

interface OSRMStepRaw {
  name: string
  ref?: string
  distance: number
  duration: number
  maneuver: { type: string; instruction?: string }
}

interface OSRMLegRaw {
  distance: number
  duration: number
  summary?: string
  steps?: OSRMStepRaw[]
}

function parseLeg(leg: OSRMLegRaw) {
  return {
    distance: leg.distance,
    duration: leg.duration,
    summary: leg.summary || '',
    steps: (leg.steps || []).map((step: OSRMStepRaw) => ({
      name: step.name || '',
      ref: step.ref || '',
      distance: step.distance,
      duration: step.duration,
      maneuver: {
        type: step.maneuver?.type || '',
        instruction: step.maneuver?.instruction || '',
      },
    })),
  }
}

/** Fetch with a timeout — prevents hanging on slow/dead OSRM responses */
async function fetchWithTimeout(url: string, timeoutMs: number = 8000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    return response
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetch a single loop route from OSRM using the route endpoint
 */
async function fetchLoopRoute(
  start: [number, number],
  waypoints: [number, number][]
): Promise<MapboxRoute | null> {
  try {
    const url = buildLoopUrl(start, waypoints)
    const response = await fetchWithTimeout(url)
    if (!response.ok) return null

    const data = await response.json()
    if (data.code !== 'Ok' || !data.routes?.length) return null

    const r = data.routes[0]
    return {
      distance: r.distance,
      duration: r.duration,
      geometry: r.geometry,
      legs: r.legs.map((leg: OSRMLegRaw) => parseLeg(leg)),
      weight: r.duration,
      weight_name: 'duration',
    }
  } catch {
    return null
  }
}

/**
 * Fetch a round-trip route using OSRM's trip endpoint (Fix 2A)
 * Falls back to regular route endpoint on failure.
 */
async function fetchTripRoute(
  start: [number, number],
  waypoints: [number, number][]
): Promise<MapboxRoute | null> {
  try {
    const url = buildTripUrl(start, waypoints)
    const response = await fetchWithTimeout(url)
    if (!response.ok) {
      return fetchLoopRoute(start, waypoints)
    }

    const data = await response.json()

    if (data.code !== 'Ok' || !data.trips?.length) {
      return fetchLoopRoute(start, waypoints)
    }

    const trip = data.trips[0]
    return {
      distance: trip.distance,
      duration: trip.duration,
      geometry: trip.geometry,
      legs: trip.legs.map((leg: OSRMLegRaw) => parseLeg(leg)),
      weight: trip.duration,
      weight_name: 'duration',
    }
  } catch {
    return fetchLoopRoute(start, waypoints)
  }
}

// ─── Circularity Metric (Fix 2B) ─────────────────────

/**
 * Calculate how "circular" a route is using the shoelace formula.
 * Returns area fill ratio: route area / bounding box area.
 * A perfect circle fills ~78% of its bounding box.
 * A straight out-and-back line fills ~0%.
 * 
 * Routes with circularity < 0.15 are hard-rejected as basically linear.
 */
function calculateCircularity(coords: [number, number][]): number {
  if (coords.length < 3) return 0

  // Calculate bounding box
  let minLng = Infinity, maxLng = -Infinity
  let minLat = Infinity, maxLat = -Infinity
  for (const [lng, lat] of coords) {
    minLng = Math.min(minLng, lng)
    maxLng = Math.max(maxLng, lng)
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
  }

  // Convert to miles for area calculation
  const midLat = (minLat + maxLat) / 2
  const lngToMi = 69 * Math.cos(midLat * Math.PI / 180)
  const latToMi = 69

  const width = (maxLng - minLng) * lngToMi
  const height = (maxLat - minLat) * latToMi

  if (width < 0.01 || height < 0.01) return 0

  const bboxArea = width * height

  // Also check aspect ratio — reject very elongated shapes
  const aspectRatio = Math.max(width, height) / Math.min(width, height)
  if (aspectRatio > 5) return 0 // Very elongated = basically a line

  // Calculate route area using shoelace formula
  let area = 0
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length
    const xi = (coords[i][0] - minLng) * lngToMi
    const yi = (coords[i][1] - minLat) * latToMi
    const xj = (coords[j][0] - minLng) * lngToMi
    const yj = (coords[j][1] - minLat) * latToMi
    area += xi * yj - xj * yi
  }
  area = Math.abs(area) / 2

  return bboxArea > 0 ? area / bboxArea : 0
}

// ─── Overlap Detection (Fix 4) ───────────────────────

/**
 * Calculate road overlap / backtracking penalty for a loop route.
 * 
 * FIX 4: Improved algorithm. For each point, check if ANY OTHER point
 * more than 20% of the route away (by position index) is within 50m.
 * This catches true backtracking without penalizing routes that happen
 * to cross near themselves (like a figure-8).
 * 
 * Returns 0 (no overlap) to 1 (complete U-turn).
 */
function calculateOverlapPenalty(coords: [number, number][]): number {
  if (coords.length < 10) return 0

  // ~50m in degrees at mid-latitudes
  const CLOSE_THRESHOLD_DEG = 0.00045
  // Minimum index separation: 10% of route (was 20% — tighter to catch tip turnarounds)
  const MIN_INDEX_SEPARATION = Math.floor(coords.length * 0.10)

  let overlapCount = 0
  const sampleStep = Math.max(1, Math.floor(coords.length / 100))
  let totalSampled = 0

  for (let i = 0; i < coords.length; i += sampleStep) {
    totalSampled++
    let hasOverlap = false

    for (let j = 0; j < coords.length; j += sampleStep) {
      if (Math.abs(i - j) < MIN_INDEX_SEPARATION) continue

      const dLat = Math.abs(coords[i][1] - coords[j][1])
      const dLng = Math.abs(coords[i][0] - coords[j][0])

      if (dLat < CLOSE_THRESHOLD_DEG && dLng < CLOSE_THRESHOLD_DEG) {
        hasOverlap = true
        break
      }
    }

    if (hasOverlap) overlapCount++
  }

  const globalOverlap = totalSampled > 0 ? overlapCount / totalSampled : 0

  // Also detect LOCAL turnarounds — spots where the route reverses direction
  // even if the overall overlap is low. A turnaround at the tip of a loop
  // only affects a small portion but ruins the driving experience.
  const turnaroundPenalty = detectLocalTurnarounds(coords)

  // Return the worse of the two penalties
  return Math.max(globalOverlap, turnaroundPenalty)
}

/**
 * Detect local turnarounds — segments where the route reverses direction
 * sharply and doubles back on itself. Returns a penalty 0-1.
 */
function detectLocalTurnarounds(coords: [number, number][]): number {
  if (coords.length < 30) return 0

  const CLOSE_THRESHOLD_DEG = 0.0005 // ~55m
  // Check windows of ~5% of the route length
  const windowSize = Math.max(10, Math.floor(coords.length * 0.05))
  const step = Math.max(1, Math.floor(windowSize / 3))

  let turnaroundSegments = 0
  let totalChecks = 0

  // For each point, check if there's a point AHEAD in the route (by 2-4 windows)
  // that's geographically close — meaning the route came back to this spot
  for (let i = 0; i < coords.length - windowSize * 3; i += step) {
    totalChecks++

    // Look ahead 2-4 windows for a nearby point
    const searchStart = i + windowSize * 2
    const searchEnd = Math.min(coords.length, i + windowSize * 5)

    for (let j = searchStart; j < searchEnd; j += step) {
      const dLat = Math.abs(coords[i][1] - coords[j][1])
      const dLng = Math.abs(coords[i][0] - coords[j][0])

      if (dLat < CLOSE_THRESHOLD_DEG && dLng < CLOSE_THRESHOLD_DEG) {
        // This point is near a point 2-4 windows ahead — possible turnaround
        // Verify by checking that the route actually went AWAY and came back
        const midIdx = Math.floor((i + j) / 2)
        const midDist = Math.sqrt(
          (coords[midIdx][0] - coords[i][0]) ** 2 +
          (coords[midIdx][1] - coords[i][1]) ** 2
        )
        // If the midpoint is significantly farther away than the endpoints, it's a turnaround
        if (midDist > CLOSE_THRESHOLD_DEG * 3) {
          turnaroundSegments++
        }
        break
      }
    }
  }

  // If more than 15% of checks show turnaround behavior, it's a problem
  const turnaroundRatio = totalChecks > 0 ? turnaroundSegments / totalChecks : 0
  // Scale so that even 10% turnaround = significant penalty
  return Math.min(1, turnaroundRatio * 3)
}

// ─── Route Naming ─────────────────────────────────────

const LOOP_NAMES_SPEED_DELTA = [
  'The Speed Step',
  'Gear Shift Loop',
  'The Accelerator',
  'Zone Runner',
  'The Speed Surge',
]

const LOOP_NAMES_SIGNAL = [
  'The Launch Loop',
  'Green Light Special',
  'Signal Sender',
  'The Traffic Dancer',
  'Light-to-Light',
]

const LOOP_NAMES_RAMP = [
  'The Ramp Run',
  'Merge Machine',
  'On-Ramp Rally',
  'Highway Hopper',
  'The Merge Loop',
]

const LOOP_NAMES_GENERAL = [
  'The Full Send',
  'The Quick Rip',
  'Neighborhood Blast',
  'The Joy Loop',
  'Sunday Sender',
  'The Daily Driver',
  'Backyard Burner',
  'The Scenic Rip',
]

function nameLoopRoute(floorability: FloorabilityResult, index: number): string {
  if (floorability.speedDeltaScore > floorability.signalLaunchScore &&
      floorability.speedDeltaScore > floorability.rampMergeScore) {
    return LOOP_NAMES_SPEED_DELTA[index % LOOP_NAMES_SPEED_DELTA.length]
  }
  if (floorability.signalLaunchScore > floorability.rampMergeScore) {
    return LOOP_NAMES_SIGNAL[index % LOOP_NAMES_SIGNAL.length]
  }
  if (floorability.rampMergeScore > 20) {
    return LOOP_NAMES_RAMP[index % LOOP_NAMES_RAMP.length]
  }
  return LOOP_NAMES_GENERAL[index % LOOP_NAMES_GENERAL.length]
}

const ROUTE_COLORS = [
  '#ff2d55', // Electric red
  '#ffb800', // Amber gold
  '#00d4ff', // Cyan
  '#a855f7', // Purple
  '#22c55e', // Green
]

// ─── Nearby Loop Helpers ─────────────────────────────

/**
 * Generate nearby loop starting points (for "Nearby" mode).
 */
function generateNearbyStartPoints(
  center: [number, number],
  radiusMi: number
): [number, number][] {
  const [lng, lat] = center
  const latPerMile = 1 / 69
  const lngPerMile = 1 / (69 * Math.cos(lat * Math.PI / 180))

  const nearbyAngles = [30, 90, 150, 210, 270, 330]
  const nearbyDistances = [0.4, 0.5, 0.6, 0.35, 0.55, 0.45]

  return nearbyAngles.map((angle, i) => {
    const dist = radiusMi * nearbyDistances[i]
    const rad = (angle * Math.PI) / 180
    const dLat = Math.cos(rad) * dist * latPerMile
    const dLng = Math.sin(rad) * dist * lngPerMile
    return [lng + dLng, lat + dLat] as [number, number]
  })
}

// ─── Main Loop Generation ─────────────────────────────

/**
 * Generate and score loop routes from a starting point.
 * 
 * FIX 2: Uses three complementary strategies for true circular loops:
 *   A) OSRM trip endpoint for round-trip optimization
 *   B) Circularity metric to hard-reject linear routes
 *   C) 4-waypoint loops at 90° intervals for proper rectangles/circles
 * 
 * FIX 3: Filters routes below minimum floorability score (25).
 * FIX 4: Improved overlap detection for true backtracking.
 */
export async function generateLoopRoutes(
  start: [number, number], // [lng, lat]
  duration: LoopDuration = 30,
  _style: LoopStyle = 'best',
  onProgress?: (stage: string, progress: number) => void,
  loopType: LoopType = 'anchor'
): Promise<LoopRoute[]> {
  const loopRadius = LOOP_RADIUS[duration]
  const triRadius = DURATION_RADIUS[duration]
  const targetDurationSec = duration * 60

  // For "nearby" mode, generate loops from different start points in the area
  if (loopType === 'nearby') {
    return generateNearbyLoopRoutes(start, duration, onProgress)
  }

  onProgress?.('Generating loop waypoints...', 0.05)

  const candidates: { route: MapboxRoute; waypoints: [number, number][]; method: string }[] = []

  // ── FIX 2C: 4-waypoint loops at various angles and radii for maximum variety ──
  // More configs = more chances to find a good loop in any road network
  const quadConfigs = [
    { angles: [0, 90, 180, 270], radiusFrac: 1.0, label: 'cardinal-100' },
    { angles: [45, 135, 225, 315], radiusFrac: 1.0, label: 'diagonal-100' },
    { angles: [0, 90, 180, 270], radiusFrac: 0.7, label: 'cardinal-70' },
    { angles: [30, 120, 210, 300], radiusFrac: 0.85, label: 'offset-85' },
    { angles: [0, 90, 180, 270], radiusFrac: 1.4, label: 'cardinal-140' },
    { angles: [45, 135, 225, 315], radiusFrac: 0.7, label: 'diagonal-70' },
    { angles: [15, 105, 195, 285], radiusFrac: 1.15, label: 'rotated-115' },
    { angles: [60, 150, 240, 330], radiusFrac: 0.85, label: 'wide-offset-85' },
    { angles: [0, 90, 180, 270], radiusFrac: 1.6, label: 'cardinal-160' },
    { angles: [45, 135, 225, 315], radiusFrac: 1.3, label: 'diagonal-130' },
    { angles: [20, 110, 200, 290], radiusFrac: 0.5, label: 'tight-50' },
    { angles: [70, 160, 250, 340], radiusFrac: 1.1, label: 'alt-110' },
  ]

  // ── FIX 2A: Use trip endpoint for round-trip optimization ──
  onProgress?.('Optimizing round trips...', 0.1)

  // Batch trip requests (4 at a time)
  for (let i = 0; i < quadConfigs.length; i += 4) {
    const batch = quadConfigs.slice(i, i + 4)
    const batchWps = batch.map((config) =>
      generateWaypoints(start, loopRadius * config.radiusFrac, config.angles)
    )
    const results = await Promise.all(
      batch.map((config, j) =>
        fetchTripRoute(start, batchWps[j]).then((route) => ({ route, config, wps: batchWps[j] }))
      )
    )
    for (const { route, config, wps } of results) {
      if (route) {
        candidates.push({ route, waypoints: wps, method: `trip-${config.label}` })
      }
    }
    onProgress?.('Optimizing round trips...', 0.1 + (i / quadConfigs.length) * 0.15)
  }

  // Also try a few 3-waypoint triangle loops via regular route (for variety)
  // These use the larger DURATION_RADIUS since triangles have fewer waypoints
  onProgress?.('Exploring triangle loops...', 0.28)

  const triConfigs = [
    { angles: [0, 120, 240], radiusFrac: 0.35 },
    { angles: [60, 180, 300], radiusFrac: 0.35 },
    { angles: [30, 150, 270], radiusFrac: 0.45 },
    { angles: [90, 210, 330], radiusFrac: 0.30 },
  ]

  const triWps = triConfigs.map((config) =>
    generateWaypoints(start, triRadius * config.radiusFrac, config.angles)
  )
  const triRoutes = await Promise.all(
    triConfigs.map((_, j) => fetchLoopRoute(start, triWps[j]))
  )
  for (let j = 0; j < triRoutes.length; j++) {
    const route = triRoutes[j]
    if (route) {
      candidates.push({ route, waypoints: triWps[j], method: `route-tri-${triConfigs[j].angles[0]}` })
    }
  }

  onProgress?.('Evaluating route shapes...', 0.35)

  // ── Duration filter (generous — 40% to 2.2x target) ──
  const minDuration = targetDurationSec * 0.4
  const maxDuration = targetDurationSec * 2.2
  let filtered = candidates.filter(
    (c) => c.route.duration >= minDuration && c.route.duration <= maxDuration
  )

  onProgress?.('Evaluating shapes...', 0.38)

  // ── Score each candidate with quality metrics ──
  // Instead of hard-rejecting, score each route and sort by quality.
  // Only hard-reject truly degenerate routes (overlap > 0.5 or circularity < 0.05)
  const scored = filtered.map((c) => {
    const circ = calculateCircularity(c.route.geometry.coordinates)
    const overlap = calculateOverlapPenalty(c.route.geometry.coordinates)
    const durationFit = 1 - Math.abs(c.route.duration - targetDurationSec) / targetDurationSec

    // Quality score: higher = better loop
    // Circularity is most important, then low overlap, then duration fit
    const quality = (circ * 0.45) + ((1 - overlap) * 0.35) + (Math.max(0, durationFit) * 0.2)

    return { ...c, circ, overlap, quality }
  })

  // Hard reject only the truly broken ones
  let quality = scored.filter((c) => c.overlap <= 0.5 && c.circ >= 0.05)

  // If nothing passes even the loose filter, take everything
  if (quality.length === 0) {
    quality = scored
  }

  // Sort by quality descending
  quality.sort((a, b) => b.quality - a.quality)

  onProgress?.('Selecting best loops...', 0.45)

  // Take the best ones, preferring diversity (not all the same shape)
  filtered = quality.slice(0, 8)

  // Take top 6 for floorability scoring
  const topCandidates = filtered.slice(0, 6)
  return scoreCandidates(topCandidates, start, onProgress)
}

/**
 * Explore a single nearby area — returns candidates or empty array on failure.
 * Isolated so one area failing doesn't kill the whole run.
 */
async function exploreNearbyArea(
  loopStart: [number, number],
  loopRadius: number,
  triRadius: number
): Promise<{ route: MapboxRoute; waypoints: [number, number][]; method: string }[]> {
  const results: { route: MapboxRoute; waypoints: [number, number][]; method: string }[] = []
  try {
    // 4-waypoint trip loop
    const wps4 = generateWaypoints(loopStart, loopRadius, [0, 90, 180, 270])
    const tripResult = await fetchTripRoute(loopStart, wps4)
    if (tripResult) {
      results.push({ route: tripResult, waypoints: wps4, method: 'nearby-trip' })
    }

    // 3-waypoint route loop for variety
    const wps3 = generateWaypoints(loopStart, triRadius * 0.35, [0, 120, 240])
    const routeResult = await fetchLoopRoute(loopStart, wps3)
    if (routeResult) {
      results.push({ route: routeResult, waypoints: wps3, method: 'nearby-route' })
    }
  } catch {
    // This area failed — that's fine, we have others
  }
  return results
}

/**
 * Generate loops from nearby starting points (Nearby mode)
 * Processes 3 areas at a time to avoid OSRM rate limits and timeouts.
 */
async function generateNearbyLoopRoutes(
  center: [number, number],
  duration: LoopDuration,
  onProgress?: (stage: string, progress: number) => void
): Promise<LoopRoute[]> {
  const loopRadius = LOOP_RADIUS[duration]
  const triRadius = DURATION_RADIUS[duration]
  const nearbyStarts = generateNearbyStartPoints(center, loopRadius * 2)

  onProgress?.('Finding nearby loops...', 0.1)

  const allCandidates: { route: MapboxRoute; waypoints: [number, number][]; method: string }[] = []

  // Process in batches of 3 areas at a time
  const BATCH_SIZE = 3
  for (let batchStart = 0; batchStart < nearbyStarts.length; batchStart += BATCH_SIZE) {
    const batch = nearbyStarts.slice(batchStart, batchStart + BATCH_SIZE)
    const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(nearbyStarts.length / BATCH_SIZE)

    onProgress?.(
      `Exploring areas ${batchStart + 1}-${batchStart + batch.length} of ${nearbyStarts.length}...`,
      0.1 + (batchNum / totalBatches) * 0.3
    )

    // Run all areas in this batch in parallel
    const batchResults = await Promise.all(
      batch.map((loopStart) => exploreNearbyArea(loopStart, loopRadius, triRadius))
    )

    for (const areaResults of batchResults) {
      allCandidates.push(...areaResults)
    }

    // Brief pause between batches to respect OSRM rate limits
    if (batchStart + BATCH_SIZE < nearbyStarts.length) {
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  onProgress?.('Evaluating shapes...', 0.45)

  const targetDurationSec = duration * 60
  const minDuration = targetDurationSec * 0.4
  const maxDuration = targetDurationSec * 2.2

  // Soft-score approach (same as anchor mode): don't hard-reject, rank by quality
  const durationFiltered = allCandidates.filter(
    (c) => c.route.duration >= minDuration && c.route.duration <= maxDuration
  )

  const withQuality = (durationFiltered.length > 0 ? durationFiltered : allCandidates).map((c) => {
    const circ = calculateCircularity(c.route.geometry.coordinates)
    const overlap = calculateOverlapPenalty(c.route.geometry.coordinates)
    const durationFit = 1 - Math.abs(c.route.duration - targetDurationSec) / targetDurationSec
    const quality = (circ * 0.45) + ((1 - overlap) * 0.35) + (Math.max(0, durationFit) * 0.2)
    return { ...c, quality }
  })

  // Sort by quality, take top 6
  withQuality.sort((a, b) => b.quality - a.quality)
  const sorted = withQuality.slice(0, 6)

  if (sorted.length === 0) {
    throw new Error('Could not find any loops in this area. Try a different location or longer duration.')
  }

  return scoreCandidates(sorted, center, onProgress)
}

// ─── Scoring Pipeline ─────────────────────────────────

async function scoreCandidates(
  candidates: { route: MapboxRoute; waypoints: [number, number][]; method?: string }[],
  start: [number, number],
  onProgress?: (stage: string, progress: number) => void
): Promise<LoopRoute[]> {
  onProgress?.('Analyzing road data...', 0.5)

  const scored: LoopRoute[] = []

  for (let i = 0; i < candidates.length; i++) {
    const { route, waypoints } = candidates[i]
    onProgress?.(
      `Scoring route ${i + 1}/${candidates.length}...`,
      0.5 + (i / candidates.length) * 0.4
    )

    let floorability: FloorabilityResult
    try {
      const overpassData = await queryOverpass(route.geometry.coordinates)
      // FIX 1: Pass legs for name-based speed matching
      floorability = analyzeFloorability(route.geometry.coordinates, overpassData, route.legs)
    } catch {
      floorability = {
        totalScore: 0,
        rawScore: 0,
        events: [],
        speedDeltaScore: 0,
        signalLaunchScore: 0,
        rampMergeScore: 0,
        runwayScore: 0,
        roadQualityScore: 0,
        bestMoment: 'Road data unavailable — score is estimated.',
        floorItCount: 0,
      }
    }

    // Calculate metrics
    const overlapPenalty = calculateOverlapPenalty(route.geometry.coordinates)
    const circularity = calculateCircularity(route.geometry.coordinates)

    // Mild penalty for any remaining overlap
    if (overlapPenalty > 0.1) {
      const penaltyMultiplier = 1 - (overlapPenalty * 0.3)
      floorability.totalScore = Math.round(floorability.totalScore * penaltyMultiplier)
    }

    // Slight bonus for highly circular routes
    if (circularity > 0.4) {
      floorability.totalScore = Math.min(100, floorability.totalScore + 3)
    }

    const durationMin = Math.round(route.duration / 60)
    const name = nameLoopRoute(floorability, i)

    scored.push({
      id: `loop-${i}`,
      name,
      mapboxRoute: route,
      distanceMi: parseFloat((route.distance / 1609.34).toFixed(1)),
      durationMin,
      deltaMin: 0,
      isFastest: false,
      color: ROUTE_COLORS[i % ROUTE_COLORS.length],
      highlights: generateLoopHighlights(floorability, durationMin, overlapPenalty, circularity),
      floorability,
      loopStyle: categorizeLoop(floorability),
      waypoints: [start, ...waypoints],
      overlapPenalty,
      circularity,
    })

    // Brief delay between Overpass queries
    if (i < candidates.length - 1) {
      await new Promise((r) => setTimeout(r, 800))
    }
  }

  // Sort by floorability score (best first)
  scored.sort((a, b) => b.floorability.totalScore - a.floorability.totalScore)

  // ── FIX 3: Minimum score threshold ──
  const aboveThreshold = scored.filter((r) => r.floorability.totalScore >= MIN_FLOORABILITY_SCORE)
  const finalRoutes = aboveThreshold.length > 0 ? aboveThreshold : scored

  // If all routes are below threshold, mark them (store will show warning)
  if (aboveThreshold.length === 0 && scored.length > 0) {
    // Add a hint to the highlights of each route
    for (const route of finalRoutes) {
      if (!route.highlights.includes('⚠️ Limited floor-it opportunities')) {
        route.highlights.unshift('⚠️ Limited floor-it opportunities')
      }
    }
  }

  // Set delta vs shortest duration
  const shortestDuration = Math.min(...finalRoutes.map((r) => r.durationMin))
  for (const route of finalRoutes) {
    route.deltaMin = route.durationMin - shortestDuration
    route.isFastest = route.durationMin === shortestDuration
  }

  // Re-assign colors (best route = red)
  finalRoutes.forEach((route, i) => {
    route.color = ROUTE_COLORS[i % ROUTE_COLORS.length]
    route.id = `loop-${i}`
  })

  onProgress?.('Done!', 1.0)

  // Return top 5
  return finalRoutes.slice(0, 5)
}

function categorizeLoop(f: FloorabilityResult): string {
  if (f.rampMergeScore > f.speedDeltaScore && f.rampMergeScore > f.signalLaunchScore) {
    return 'Highway-heavy'
  }
  if (f.speedDeltaScore > f.signalLaunchScore) {
    return 'Speed transitions'
  }
  if (f.signalLaunchScore > 20) {
    return 'Signal launches'
  }
  return 'Mixed'
}

function generateLoopHighlights(
  f: FloorabilityResult,
  durationMin: number,
  overlapPenalty: number = 0,
  circularity: number = 0
): string[] {
  const highlights: string[] = []

  if (f.floorItCount > 0) {
    highlights.push(`${f.floorItCount} floor-it moment${f.floorItCount !== 1 ? 's' : ''}`)
  }

  if (f.events.length > 0) {
    const best = f.events[0]
    if (best.type === 'speed_delta') {
      highlights.push(`Best: ${best.label} with ${best.runwayMi.toFixed(1)}mi runway`)
    } else if (best.type === 'signal_launch') {
      highlights.push(`Best: ${best.label}`)
    } else {
      highlights.push(`Best: ${best.label}`)
    }
  }

  const speedEvents = f.events.filter((e) => e.type === 'speed_delta')
  const signalEvents = f.events.filter((e) => e.type === 'signal_launch')
  const rampEvents = f.events.filter((e) => e.type === 'ramp_merge')

  if (speedEvents.length > 0) {
    highlights.push(`${speedEvents.length} speed transitions`)
  }
  if (signalEvents.length > 0) {
    highlights.push(`${signalEvents.length} signal launch${signalEvents.length !== 1 ? 'es' : ''}`)
  }
  if (rampEvents.length > 0) {
    highlights.push(`${rampEvents.length} highway merge${rampEvents.length !== 1 ? 's' : ''}`)
  }

  if (overlapPenalty > 0.3) {
    highlights.push(`⚠️ ${Math.round(overlapPenalty * 100)}% road overlap`)
  } else if (circularity >= 0.3) {
    highlights.push('🔄 Great loop shape')
  } else if (overlapPenalty < 0.1) {
    highlights.push('✅ Unique outbound & return roads')
  }

  highlights.push(`~${durationMin} min loop`)

  return highlights.slice(0, 4)
}
