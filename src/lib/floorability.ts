/**
 * Floorability Engine
 * 
 * Scores routes based on acceleration opportunities:
 * - Speed limit deltas (slow → fast transitions)
 * - Signal launch zones (red lights on high-speed roads)
 * - On-ramp merges (highway acceleration zones)
 * - Acceleration runway (uninterrupted distance after a floor-it event)
 * - Road quality (surface, lanes, smoothness)
 * 
 * FIX 1: Speed data integrity — matches Overpass ways to route steps
 * by road name, not just proximity. Prevents cross-street speed limits
 * from contaminating the speed profile.
 */

import type { RouteLeg } from '../types/route'

// ─── Types ────────────────────────────────────────────

export interface SpeedZone {
  startIdx: number
  endIdx: number
  speedMph: number
  lengthMi: number
  roadName: string
  highway: string
}

export interface TrafficSignal {
  lat: number
  lng: number
  nearestSpeedMph: number
  distanceToNextSignalMi: number
  distanceToNextIntersectionMi: number
  launchScore: number
}

export interface OnRamp {
  lat: number
  lng: number
  rampLengthMi: number
  mergeSpeedMph: number
  score: number
}

export interface FloorItEvent {
  type: 'speed_delta' | 'signal_launch' | 'ramp_merge'
  lat: number
  lng: number
  score: number
  label: string
  detail: string
  runwayMi: number // how much road after this event
}

export interface FloorabilityResult {
  totalScore: number // 0-100 normalized
  rawScore: number
  events: FloorItEvent[]
  speedDeltaScore: number
  signalLaunchScore: number
  rampMergeScore: number
  runwayScore: number
  roadQualityScore: number
  bestMoment: string // human-readable description of the best floor-it moment
  floorItCount: number // total number of floor-it events
}

// ─── Route Step Mapping ───────────────────────────────

/** Maps a range of route coordinate indices to a road name & ref */
interface RouteStepSegment {
  name: string
  ref: string
  startIdx: number
  endIdx: number
}

/**
 * Build a map from route coordinate indices to road names.
 * Uses cumulative distances along route coords matched to step distances.
 */
function buildStepMap(
  coords: [number, number][],
  legs: RouteLeg[]
): RouteStepSegment[] {
  if (!legs?.length || coords.length < 2) return []

  // Build cumulative distance along route coords (in meters for matching with step.distance)
  const cumDist: number[] = [0]
  for (let i = 1; i < coords.length; i++) {
    const d = haversineDistMi(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0])
    cumDist.push(cumDist[i - 1] + d * 1609.34) // convert to meters
  }

  const segments: RouteStepSegment[] = []
  let currentDistM = 0

  for (const leg of legs) {
    for (const step of leg.steps) {
      const startDistM = currentDistM
      const endDistM = currentDistM + step.distance

      // Find coord indices for this distance range
      let startIdx = 0
      let endIdx = coords.length - 1

      for (let i = 0; i < cumDist.length; i++) {
        if (cumDist[i] >= startDistM) {
          startIdx = i
          break
        }
      }
      for (let i = startIdx; i < cumDist.length; i++) {
        if (cumDist[i] >= endDistM) {
          endIdx = i
          break
        }
      }

      if (step.name) {
        segments.push({
          name: step.name,
          ref: step.ref || '',
          startIdx,
          endIdx,
        })
      }

      currentDistM = endDistM
    }
  }

  return segments
}

/**
 * Get the road name at a given route coordinate index.
 */
function getRoadNameAtIndex(idx: number, stepMap: RouteStepSegment[]): string {
  for (const seg of stepMap) {
    if (idx >= seg.startIdx && idx <= seg.endIdx) return seg.name
  }
  return ''
}

/**
 * Get the road ref at a given route coordinate index.
 */
function getRoadRefAtIndex(idx: number, stepMap: RouteStepSegment[]): string {
  for (const seg of stepMap) {
    if (idx >= seg.startIdx && idx <= seg.endIdx) return seg.ref
  }
  return ''
}

// ─── Road Name Matching ──────────────────────────────

/**
 * Normalize a road name for comparison.
 * Handles common abbreviation differences between OSRM and OSM data.
 */
function normalizeRoadName(name: string): string {
  return name.toLowerCase()
    .replace(/\bstreet\b/gi, 'st')
    .replace(/\bavenue\b/gi, 'ave')
    .replace(/\bboulevard\b/gi, 'blvd')
    .replace(/\bdrive\b/gi, 'dr')
    .replace(/\broad\b/gi, 'rd')
    .replace(/\blane\b/gi, 'ln')
    .replace(/\bparkway\b/gi, 'pkwy')
    .replace(/\bpky\b/gi, 'pkwy')
    .replace(/\bhighway\b/gi, 'hwy')
    .replace(/\bexpressway\b/gi, 'expy')
    .replace(/\bturnpike\b/gi, 'tpk')
    .replace(/\btpke\b/gi, 'tpk')
    .replace(/\bcircle\b/gi, 'cir')
    .replace(/\bcourt\b/gi, 'ct')
    .replace(/\bplace\b/gi, 'pl')
    .replace(/\bterrace\b/gi, 'ter')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Check if two road names likely refer to the same road.
 * Uses normalized comparison + substring matching for partial names.
 */
function roadNamesMatch(name1: string, name2: string): boolean {
  if (!name1 || !name2) return false

  const n1 = normalizeRoadName(name1)
  const n2 = normalizeRoadName(name2)

  // Exact match after normalization
  if (n1 === n2) return true

  // One contains the other (handles "Taconic State Pkwy" vs "Taconic")
  if (n1.length >= 5 && n2.length >= 5) {
    if (n1.includes(n2) || n2.includes(n1)) return true
  }

  // Check if significant words overlap (at least 2 words match)
  const words1 = new Set(n1.split(' ').filter(w => w.length >= 3))
  const words2 = new Set(n2.split(' ').filter(w => w.length >= 3))
  let matchCount = 0
  for (const w of words1) {
    if (words2.has(w)) matchCount++
  }
  if (matchCount >= 2) return true

  return false
}

// ─── Highway Type Compatibility ──────────────────────

/** High-speed road types that should never have very low speed limits */
const HIGH_SPEED_HIGHWAY_TYPES = new Set([
  'motorway', 'trunk', 'motorway_link', 'trunk_link',
  'primary', // primaries are usually 35+
])

/** Minimum credible speed (mph) for a given highway type */
function minCredibleSpeed(highway: string): number {
  switch (highway) {
    case 'motorway': return 40
    case 'trunk': return 35
    case 'motorway_link': return 25
    case 'trunk_link': return 25
    case 'primary': return 25
    default: return 10
  }
}

/**
 * Check if an Overpass way's highway type is compatible with the route at a position.
 * Prevents matching a residential cross-street's speed to a motorway segment.
 */
function isHighwayTypeCompatible(
  overpassHighway: string,
  routeStepName: string,
  routeStepRef: string
): boolean {
  // If the route step name or ref suggests a major road, don't accept residential/tertiary
  const nameLower = routeStepName.toLowerCase()
  const refLower = routeStepRef.toLowerCase()
  const isMajorRoute =
    nameLower.includes('parkway') ||
    nameLower.includes('highway') ||
    nameLower.includes('interstate') ||
    nameLower.includes('expressway') ||
    nameLower.includes('turnpike') ||
    nameLower.includes('freeway') ||
    nameLower.includes('thruway') ||
    nameLower.includes('i-') ||
    nameLower.includes('us-') ||
    nameLower.includes('us ') ||
    refLower.startsWith('i ') ||
    refLower.startsWith('us ') ||
    refLower.startsWith('ny ') ||
    refLower.startsWith('sr ')

  const lowTypeWay =
    overpassHighway === 'residential' ||
    overpassHighway === 'tertiary' ||
    overpassHighway === 'unclassified' ||
    overpassHighway === 'service' ||
    overpassHighway === 'living_street'

  // Major route should not get speed data from low-type roads
  if (isMajorRoute && lowTypeWay) return false

  return true
}

// ─── Overpass API ─────────────────────────────────────

interface OverpassElement {
  type: 'way' | 'node'
  id: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
  geometry?: { lat: number; lon: number }[]
  nodes?: number[]
}

interface OverpassResponse {
  elements: OverpassElement[]
}

/**
 * Query Overpass API for road data near a route.
 * Uses tight radius (50m) for speed limit data to avoid cross-street contamination.
 */
export async function queryOverpass(
  routeCoords: [number, number][],
  sampleInterval: number = 20 // sample every N points
): Promise<OverpassResponse> {
  // Sample points along the route for the around filter
  const sampled: [number, number][] = []
  for (let i = 0; i < routeCoords.length; i += sampleInterval) {
    sampled.push(routeCoords[i])
  }
  // Always include last point
  if (sampled.length > 0) {
    const last = routeCoords[routeCoords.length - 1]
    if (sampled[sampled.length - 1] !== last) {
      sampled.push(last)
    }
  }

  // Limit sample size to avoid Overpass timeouts
  const maxSamples = 40
  const step = Math.max(1, Math.ceil(sampled.length / maxSamples))
  const finalSampled = sampled.filter((_, i) => i % step === 0)

  // Build poly string for around filter: lat1,lng1,lat2,lng2,...
  const polyStr = finalSampled.map(([lng, lat]) => `${lat},${lng}`).join(',')

  // FIX 1: Reduced radius from 150m to 50m for speed data
  // Keeps 150m for signals and road quality, 250m for ramp detection
  const query = `
[out:json][timeout:25];
(
  way(around:50,${polyStr})["maxspeed"];
  node(around:150,${polyStr})["highway"="traffic_signals"];
  way(around:250,${polyStr})["highway"="motorway_link"];
  way(around:100,${polyStr})["highway"~"^(motorway|trunk|primary|secondary)$"]["lanes"];
);
out body geom;
`

  // Timeout Overpass calls — they can hang for 30+ seconds on complex queries
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000) // 15 second timeout

  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: controller.signal,
    })

    if (!response.ok) {
      console.warn('Overpass API error:', response.status)
      return { elements: [] }
    }

    return response.json()
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      console.warn('Overpass API timed out after 15s')
    } else {
      console.warn('Overpass API error:', err)
    }
    return { elements: [] }
  } finally {
    clearTimeout(timer)
  }
}

// ─── Speed Limit Parsing ──────────────────────────────

function parseSpeedMph(maxspeed: string | undefined): number | null {
  if (!maxspeed) return null
  // Handle formats: "55 mph", "55", "50 km/h"
  const match = maxspeed.match(/^(\d+)\s*(mph|km\/h)?/)
  if (!match) return null
  const val = parseInt(match[1], 10)
  if (match[2] === 'km/h') return Math.round(val * 0.621371)
  return val
}

// ─── Distance Utilities ───────────────────────────────

function haversineDistMi(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 3958.8 // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function findNearestPoint(
  lat: number, lng: number,
  coords: [number, number][]
): { idx: number; dist: number } {
  let minDist = Infinity
  let minIdx = 0
  for (let i = 0; i < coords.length; i++) {
    const d = haversineDistMi(lat, lng, coords[i][1], coords[i][0])
    if (d < minDist) {
      minDist = d
      minIdx = i
    }
  }
  return { idx: minIdx, dist: minDist }
}

// ─── Segment Gradient ─────────────────────────────────

export interface GradientStop {
  progress: number // 0-1 along route
  color: string    // hex color
}

/**
 * Compute per-segment floorability colors for MapLibre line-gradient.
 * Returns gradient stops mapping route progress to heat colors:
 *   blue (chill) → cyan → yellow → red (floor it)
 */
export function computeFloorabilityGradient(
  routeCoords: [number, number][], // [lng, lat][]
  events: FloorItEvent[]
): GradientStop[] {
  if (events.length === 0 || routeCoords.length < 2) {
    return [{ progress: 0, color: '#2a3a5a' }, { progress: 1, color: '#2a3a5a' }]
  }

  // Compute cumulative distance along route
  const cumDist: number[] = [0]
  for (let i = 1; i < routeCoords.length; i++) {
    const d = haversineDistMi(
      routeCoords[i - 1][1], routeCoords[i - 1][0],
      routeCoords[i][1], routeCoords[i][0]
    )
    cumDist.push(cumDist[i - 1] + d)
  }
  const totalMi = cumDist[cumDist.length - 1]
  if (totalMi === 0) {
    return [{ progress: 0, color: '#2a3a5a' }, { progress: 1, color: '#2a3a5a' }]
  }

  // Map each event to a heat zone on the route (progress range + score)
  const heatZones: { start: number; end: number; score: number }[] = []
  for (const event of events) {
    const nearest = findNearestPoint(event.lat, event.lng, routeCoords)
    const progress = cumDist[nearest.idx] / totalMi
    const runwayProgress = Math.min(event.runwayMi / totalMi, 0.25) // cap at 25% of route
    heatZones.push({
      start: Math.max(0, progress - 0.008), // tiny lead-in before the event
      end: Math.min(1, progress + runwayProgress),
      score: event.score,
    })
  }

  // Normalize scores to 0-1
  const maxScore = Math.max(...heatZones.map((z) => z.score), 1)

  // Sample the route at N points and compute heat at each
  const N = 64
  const stops: GradientStop[] = []

  for (let i = 0; i <= N; i++) {
    const p = i / N
    let maxInfluence = 0

    for (const zone of heatZones) {
      if (p >= zone.start && p <= zone.end) {
        const zoneLen = zone.end - zone.start
        const zoneProg = zoneLen > 0 ? (p - zone.start) / zoneLen : 0
        // Score decays linearly to 30% at the end of the runway
        const influence = (zone.score / maxScore) * (1 - zoneProg * 0.7)
        maxInfluence = Math.max(maxInfluence, influence)
      }
    }

    stops.push({ progress: p, color: heatToColor(maxInfluence) })
  }

  return stops
}

/** Map a 0-1 heat value to a color: dim blue → cyan → amber → hot red */
function heatToColor(heat: number): string {
  if (heat < 0.05) return '#2a3a5a'  // dim base — no event nearby
  if (heat < 0.25) return lerpHex('#2a3a5a', '#00d4ff', (heat - 0.05) / 0.20)
  if (heat < 0.55) return lerpHex('#00d4ff', '#ffb800', (heat - 0.25) / 0.30)
  return lerpHex('#ffb800', '#ff2d55', Math.min((heat - 0.55) / 0.45, 1))
}

function lerpHex(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16)
  const ag = parseInt(a.slice(3, 5), 16)
  const ab = parseInt(a.slice(5, 7), 16)
  const br = parseInt(b.slice(1, 3), 16)
  const bg = parseInt(b.slice(3, 5), 16)
  const bb = parseInt(b.slice(5, 7), 16)
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`
}

// ─── Core Scoring Engine ──────────────────────────────

/**
 * Analyze a route's floorability score.
 * 
 * FIX 1: Now accepts route legs to build a step map for name-based
 * speed data matching. Prevents cross-street speed contamination.
 */
export function analyzeFloorability(
  routeCoords: [number, number][], // [lng, lat][]
  overpassData: OverpassResponse,
  legs?: RouteLeg[]
): FloorabilityResult {
  const events: FloorItEvent[] = []
  let speedDeltaRaw = 0
  let signalLaunchRaw = 0
  let rampMergeRaw = 0
  let runwayRaw = 0
  let roadQualityRaw = 0

  // Build step map for name-based matching (Fix 1)
  const stepMap = legs ? buildStepMap(routeCoords, legs) : []
  const hasStepMap = stepMap.length > 0

  // ── Extract speed zones from Overpass ways ──
  const speedWays = overpassData.elements.filter(
    (el) => el.type === 'way' && el.tags?.maxspeed
  )

  // Build speed profile along route by matching ways to route segments
  const speedProfile: { idx: number; speedMph: number; roadName: string; highway: string }[] = []

  for (const way of speedWays) {
    const speed = parseSpeedMph(way.tags?.maxspeed)
    if (!speed || !way.geometry?.length) continue

    // Find where this way intersects the route
    const midGeo = way.geometry[Math.floor(way.geometry.length / 2)]
    const nearest = findNearestPoint(midGeo.lat, midGeo.lon, routeCoords)

    // Tighter proximity threshold: 0.04mi (~210ft) instead of 0.1mi
    if (nearest.dist > 0.04) continue

    const overpassWayName = way.tags?.name || ''
    const overpassHighway = way.tags?.highway || 'road'

    // ── FIX 1: Name-based matching ──
    if (hasStepMap) {
      const routeRoadName = getRoadNameAtIndex(nearest.idx, stepMap)
      const routeRoadRef = getRoadRefAtIndex(nearest.idx, stepMap)

      // Check 1: Road name must match (or Overpass way is unnamed — accept with caution)
      if (overpassWayName && routeRoadName) {
        if (!roadNamesMatch(overpassWayName, routeRoadName)) {
          // Names don't match — this is likely a cross-street. Skip it.
          // Exception: if the Overpass way ref matches the route ref, it's the same road
          const overpassRef = way.tags?.ref || ''
          if (!overpassRef || !routeRoadRef || overpassRef !== routeRoadRef) {
            continue
          }
        }
      }

      // Check 2: Highway type compatibility
      if (routeRoadName && !isHighwayTypeCompatible(overpassHighway, routeRoadName, routeRoadRef)) {
        continue
      }

      // Check 3: Sanity — major roads don't suddenly have very low speed limits
      if (HIGH_SPEED_HIGHWAY_TYPES.has(overpassHighway) && speed < minCredibleSpeed(overpassHighway)) {
        continue
      }

      // Check 4: If route step suggests a major road, reject anomalously low speeds
      const routeNameLower = routeRoadName.toLowerCase()
      const routeIsMajor =
        routeNameLower.includes('parkway') ||
        routeNameLower.includes('highway') ||
        routeNameLower.includes('interstate') ||
        routeNameLower.includes('expressway') ||
        routeNameLower.includes('turnpike') ||
        routeNameLower.includes('freeway') ||
        routeNameLower.includes('thruway')

      if (routeIsMajor && speed < 30) {
        // A parkway/highway at <30mph is almost certainly a cross-street match
        continue
      }
    }

    speedProfile.push({
      idx: nearest.idx,
      speedMph: speed,
      roadName: overpassWayName || (hasStepMap ? getRoadNameAtIndex(nearest.idx, stepMap) : 'unnamed'),
      highway: overpassHighway,
    })
  }

  // Sort by route position
  speedProfile.sort((a, b) => a.idx - b.idx)

  // Deduplicate: if multiple speed entries at very close indices, keep the one
  // that best matches the route step name
  const deduped: typeof speedProfile = []
  for (let i = 0; i < speedProfile.length; i++) {
    const curr = speedProfile[i]
    // If the next entry is within 10 indices, pick the better match
    if (i + 1 < speedProfile.length && Math.abs(speedProfile[i + 1].idx - curr.idx) < 10) {
      // Keep the one with the higher speed if on a major road (less likely to be a cross-street)
      const next = speedProfile[i + 1]
      if (hasStepMap) {
        const routeName = getRoadNameAtIndex(curr.idx, stepMap)
        const currMatch = roadNamesMatch(curr.roadName, routeName)
        const nextMatch = roadNamesMatch(next.roadName, routeName)
        if (nextMatch && !currMatch) {
          // Skip current, next is better
          continue
        }
      }
      deduped.push(curr)
      i++ // skip next
    } else {
      deduped.push(curr)
    }
  }

  const finalProfile = deduped.length > 0 ? deduped : speedProfile

  // ── Detect Speed Deltas ──
  for (let i = 1; i < finalProfile.length; i++) {
    const prev = finalProfile[i - 1]
    const curr = finalProfile[i]
    const delta = curr.speedMph - prev.speedMph

    if (delta >= 10) {
      // Positive speed transition — floor-it opportunity!
      // Calculate runway: distance of the high-speed stretch
      const nextChange = finalProfile[i + 1]
      const runwayEndIdx = nextChange ? nextChange.idx : Math.min(curr.idx + 200, routeCoords.length - 1)
      let runwayMi = 0
      for (let j = curr.idx; j < runwayEndIdx - 1 && j < routeCoords.length - 1; j++) {
        runwayMi += haversineDistMi(
          routeCoords[j][1], routeCoords[j][0],
          routeCoords[j + 1][1], routeCoords[j + 1][0]
        )
      }

      // Score: delta magnitude * runway length * speed factor
      const speedFactor = curr.speedMph >= 50 ? 1.5 : curr.speedMph >= 40 ? 1.2 : 1.0
      const score = delta * Math.min(runwayMi, 3) * speedFactor

      speedDeltaRaw += score
      runwayRaw += runwayMi * 5

      const coord = routeCoords[curr.idx]
      events.push({
        type: 'speed_delta',
        lat: coord[1],
        lng: coord[0],
        score,
        label: `${prev.speedMph}→${curr.speedMph} mph`,
        detail: `Speed jumps from ${prev.speedMph} to ${curr.speedMph} mph on ${curr.roadName}. ${runwayMi.toFixed(1)}mi runway ahead.`,
        runwayMi,
      })
    }
  }

  // ── Detect Signal Launch Zones ──
  const signals = overpassData.elements.filter(
    (el) => el.type === 'node' && el.tags?.highway === 'traffic_signals'
  )

  for (const signal of signals) {
    if (!signal.lat || !signal.lon) continue

    const nearest = findNearestPoint(signal.lat, signal.lon, routeCoords)
    if (nearest.dist > 0.05) continue // within ~250ft

    // Find the speed limit at this signal
    let signalSpeed = 35 // default assumption
    for (const sp of finalProfile) {
      if (Math.abs(sp.idx - nearest.idx) < 30) {
        signalSpeed = sp.speedMph
        break
      }
    }

    if (signalSpeed < 35) continue // low-speed signals aren't exciting

    // Find distance to next signal along route
    let nextSignalDist = 2.0 // default: assume 2 miles if unknown
    for (const otherSignal of signals) {
      if (otherSignal.id === signal.id || !otherSignal.lat || !otherSignal.lon) continue
      const otherNearest = findNearestPoint(otherSignal.lat, otherSignal.lon, routeCoords)
      if (otherNearest.idx > nearest.idx) {
        let dist = 0
        for (let j = nearest.idx; j < otherNearest.idx - 1 && j < routeCoords.length - 1; j++) {
          dist += haversineDistMi(
            routeCoords[j][1], routeCoords[j][0],
            routeCoords[j + 1][1], routeCoords[j + 1][0]
          )
        }
        if (dist > 0.1) {
          nextSignalDist = Math.min(nextSignalDist, dist)
          break
        }
      }
    }

    // Score: speed * distance to next signal (launch + runway)
    const score = (signalSpeed / 50) * Math.min(nextSignalDist, 2) * 15
    signalLaunchRaw += score

    events.push({
      type: 'signal_launch',
      lat: signal.lat,
      lng: signal.lon,
      score,
      label: `🚦 ${signalSpeed}mph launch`,
      detail: `Traffic light on ${signalSpeed}mph road. ${nextSignalDist.toFixed(1)}mi until next signal — floor it.`,
      runwayMi: nextSignalDist,
    })
  }

  // ── Detect On-Ramp Merges ──
  const ramps = overpassData.elements.filter(
    (el) => el.type === 'way' && el.tags?.highway === 'motorway_link' && el.geometry?.length
  )

  for (const ramp of ramps) {
    if (!ramp.geometry?.length) continue

    const midGeo = ramp.geometry[Math.floor(ramp.geometry.length / 2)]
    const nearest = findNearestPoint(midGeo.lat, midGeo.lon, routeCoords)
    if (nearest.dist > 0.15) continue

    // Calculate ramp length
    let rampLen = 0
    for (let i = 0; i < ramp.geometry.length - 1; i++) {
      rampLen += haversineDistMi(
        ramp.geometry[i].lat, ramp.geometry[i].lon,
        ramp.geometry[i + 1].lat, ramp.geometry[i + 1].lon
      )
    }

    // Score based on ramp length (longer = more acceleration)
    const score = Math.min(rampLen, 0.5) * 60
    rampMergeRaw += score

    events.push({
      type: 'ramp_merge',
      lat: midGeo.lat,
      lng: midGeo.lon,
      score,
      label: `🛣️ Highway merge`,
      detail: `${(rampLen * 5280).toFixed(0)}ft on-ramp — merge acceleration zone.`,
      runwayMi: rampLen,
    })
  }

  // ── Road Quality from lanes/surface ──
  const qualityWays = overpassData.elements.filter(
    (el) => el.type === 'way' && el.tags && (el.tags.lanes || el.tags.surface)
  )
  for (const way of qualityWays) {
    const lanes = parseInt(way.tags?.lanes || '0', 10)
    const surface = way.tags?.surface || ''
    if (lanes >= 4) roadQualityRaw += 3
    else if (lanes >= 2) roadQualityRaw += 1
    if (surface === 'asphalt') roadQualityRaw += 2
    else if (surface === 'concrete') roadQualityRaw += 1
  }

  // ── Normalize to 0-100 ──
  const rawTotal = speedDeltaRaw * 0.35 +
    signalLaunchRaw * 0.25 +
    rampMergeRaw * 0.20 +
    runwayRaw * 0.10 +
    roadQualityRaw * 0.10

  // Normalize: a "perfect" route scores around 200 raw
  const totalScore = Math.min(100, Math.round((rawTotal / 150) * 100))

  // Sort events by score descending
  events.sort((a, b) => b.score - a.score)

  // Generate best moment description
  const bestEvent = events[0]
  const bestMoment = bestEvent
    ? bestEvent.detail
    : 'No major floor-it events detected on this route.'

  return {
    totalScore,
    rawScore: rawTotal,
    events,
    speedDeltaScore: Math.min(100, Math.round((speedDeltaRaw / 50) * 100)),
    signalLaunchScore: Math.min(100, Math.round((signalLaunchRaw / 40) * 100)),
    rampMergeScore: Math.min(100, Math.round((rampMergeRaw / 30) * 100)),
    runwayScore: Math.min(100, Math.round((runwayRaw / 30) * 100)),
    roadQualityScore: Math.min(100, Math.round((roadQualityRaw / 20) * 100)),
    bestMoment,
    floorItCount: events.length,
  }
}
