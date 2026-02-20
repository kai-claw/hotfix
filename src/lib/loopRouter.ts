/**
 * Loop Route Generator
 * 
 * Generates circular routes from a starting point that return
 * to the same location, optimized for floorability.
 */

import type { MapboxRoute, ScoredRoute } from '../types/route'
import { analyzeFloorability, queryOverpass, type FloorabilityResult } from './floorability'

export type LoopDuration = 15 | 30 | 60
export type LoopStyle = 'highway' | 'backroad' | 'mixed' | 'best'

export interface LoopRoute extends ScoredRoute {
  floorability: FloorabilityResult
  loopStyle: string
  waypoints: [number, number][]
}

// Radius in miles for each duration target
const DURATION_RADIUS: Record<LoopDuration, number> = {
  15: 5,
  30: 12,
  60: 22,
}

// How many degrees between waypoint directions
const WAYPOINT_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315]
// Additional angles for more variety
const EXTRA_ANGLES = [22, 67, 112, 157, 202, 247, 292, 337]

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
 * Fetch a single loop route from OSRM
 */
async function fetchLoopRoute(
  start: [number, number],
  waypoints: [number, number][]
): Promise<MapboxRoute | null> {
  try {
    const url = buildLoopUrl(start, waypoints)
    const response = await fetch(url)
    if (!response.ok) return null

    const data = await response.json()
    if (data.code !== 'Ok' || !data.routes?.length) return null

    const r = data.routes[0]
    return {
      distance: r.distance,
      duration: r.duration,
      geometry: r.geometry,
      legs: r.legs.map((leg: { distance: number; duration: number; summary: string; steps: { name: string; distance: number; duration: number; maneuver: { type: string; instruction: string } }[] }) => ({
        distance: leg.distance,
        duration: leg.duration,
        summary: leg.summary || '',
        steps: (leg.steps || []).map((step) => ({
          name: step.name || '',
          distance: step.distance,
          duration: step.duration,
          maneuver: {
            type: step.maneuver?.type || '',
            instruction: step.maneuver?.instruction || '',
          },
        })),
      })),
      weight: r.duration,
      weight_name: 'duration',
    }
  } catch {
    return null
  }
}

// Route name pools for loops
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
  // Name based on dominant floor-it type
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

/**
 * Generate and score loop routes from a starting point
 */
export async function generateLoopRoutes(
  start: [number, number], // [lng, lat]
  duration: LoopDuration = 30,
  _style: LoopStyle = 'best',
  onProgress?: (stage: string, progress: number) => void
): Promise<LoopRoute[]> {
  const radius = DURATION_RADIUS[duration]
  const targetDurationSec = duration * 60

  // Stage 1: Generate waypoints
  onProgress?.('Generating waypoints...', 0.1)

  // Single-waypoint loops (8 directions)
  const singleWps = generateWaypoints(start, radius, WAYPOINT_ANGLES)

  // Double-waypoint loops for variety (pairs of nearby angles)
  const doubleWps: [number, number][][] = []
  const shortRadius = radius * 0.6
  const extraWps = generateWaypoints(start, shortRadius, EXTRA_ANGLES)
  for (let i = 0; i < extraWps.length; i += 2) {
    if (i + 1 < extraWps.length) {
      doubleWps.push([extraWps[i], extraWps[i + 1]])
    }
  }

  // Stage 2: Fetch all candidate loop routes in parallel
  onProgress?.('Calculating routes...', 0.2)

  const candidates: { route: MapboxRoute; waypoints: [number, number][] }[] = []

  // Fetch single-wp loops (batch 4 at a time to be nice to OSRM)
  for (let i = 0; i < singleWps.length; i += 4) {
    const batch = singleWps.slice(i, i + 4)
    const results = await Promise.all(
      batch.map((wp) => fetchLoopRoute(start, [wp]))
    )
    results.forEach((route, j) => {
      if (route) {
        candidates.push({ route, waypoints: [batch[j]] })
      }
    })
    onProgress?.('Calculating routes...', 0.2 + (i / singleWps.length) * 0.2)
  }

  // Fetch double-wp loops
  for (let i = 0; i < doubleWps.length; i += 3) {
    const batch = doubleWps.slice(i, i + 3)
    const results = await Promise.all(
      batch.map((wps) => fetchLoopRoute(start, wps))
    )
    results.forEach((route, j) => {
      if (route) {
        candidates.push({ route, waypoints: batch[j] })
      }
    })
  }

  onProgress?.('Filtering routes...', 0.45)

  // Filter by duration (within 50% of target to allow variety)
  const minDuration = targetDurationSec * 0.5
  const maxDuration = targetDurationSec * 1.8
  const filtered = candidates.filter(
    (c) => c.route.duration >= minDuration && c.route.duration <= maxDuration
  )

  if (filtered.length === 0) {
    // If nothing matches, return whatever we have
    const fallback = candidates.slice(0, 3)
    if (fallback.length === 0) {
      throw new Error('Could not generate any loop routes from this location')
    }
    return scoreCandidates(fallback, start, onProgress)
  }

  // Sort by closeness to target duration, take top 6 for scoring
  filtered.sort(
    (a, b) =>
      Math.abs(a.route.duration - targetDurationSec) -
      Math.abs(b.route.duration - targetDurationSec)
  )

  const topCandidates = filtered.slice(0, 6)
  return scoreCandidates(topCandidates, start, onProgress)
}

async function scoreCandidates(
  candidates: { route: MapboxRoute; waypoints: [number, number][] }[],
  start: [number, number],
  onProgress?: (stage: string, progress: number) => void
): Promise<LoopRoute[]> {
  // Stage 3: Score with Overpass data
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
      floorability = analyzeFloorability(route.geometry.coordinates, overpassData)
    } catch {
      // If Overpass fails, use a basic score
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

    const durationMin = Math.round(route.duration / 60)
    const name = nameLoopRoute(floorability, i)

    scored.push({
      id: `loop-${i}`,
      name,
      mapboxRoute: route,
      distanceMi: parseFloat((route.distance / 1609.34).toFixed(1)),
      durationMin,
      deltaMin: 0, // will be set below
      isFastest: false,
      color: ROUTE_COLORS[i % ROUTE_COLORS.length],
      highlights: generateLoopHighlights(floorability, durationMin),
      floorability,
      loopStyle: categorizeLoop(floorability),
      waypoints: [start, ...waypoints],
    })

    // Small delay between Overpass queries to be respectful
    if (i < candidates.length - 1) {
      await new Promise((r) => setTimeout(r, 1500))
    }
  }

  // Sort by floorability score (best first)
  scored.sort((a, b) => b.floorability.totalScore - a.floorability.totalScore)

  // Set delta vs shortest duration
  const shortestDuration = Math.min(...scored.map((r) => r.durationMin))
  for (const route of scored) {
    route.deltaMin = route.durationMin - shortestDuration
    route.isFastest = route.durationMin === shortestDuration
  }

  // Re-assign colors (best route = red)
  scored.forEach((route, i) => {
    route.color = ROUTE_COLORS[i % ROUTE_COLORS.length]
    route.id = `loop-${i}`
  })

  onProgress?.('Done!', 1.0)

  // Return top 5
  return scored.slice(0, 5)
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

function generateLoopHighlights(f: FloorabilityResult, durationMin: number): string[] {
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

  highlights.push(`~${durationMin} min loop`)

  return highlights.slice(0, 4)
}
