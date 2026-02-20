/**
 * Floorability Engine
 * 
 * Scores routes based on acceleration opportunities:
 * - Speed limit deltas (slow → fast transitions)
 * - Signal launch zones (red lights on high-speed roads)
 * - On-ramp merges (highway acceleration zones)
 * - Acceleration runway (uninterrupted distance after a floor-it event)
 * - Road quality (surface, lanes, smoothness)
 */

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
 * Query Overpass API for road data near a route
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

  const query = `
[out:json][timeout:25];
(
  way(around:150,${polyStr})["maxspeed"];
  node(around:150,${polyStr})["highway"="traffic_signals"];
  way(around:250,${polyStr})["highway"="motorway_link"];
  way(around:150,${polyStr})["highway"~"^(motorway|trunk|primary|secondary)$"]["lanes"];
);
out body geom;
`

  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })

  if (!response.ok) {
    console.warn('Overpass API error:', response.status)
    return { elements: [] }
  }

  return response.json()
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

export function analyzeFloorability(
  routeCoords: [number, number][], // [lng, lat][]
  overpassData: OverpassResponse
): FloorabilityResult {
  const events: FloorItEvent[] = []
  let speedDeltaRaw = 0
  let signalLaunchRaw = 0
  let rampMergeRaw = 0
  let runwayRaw = 0
  let roadQualityRaw = 0

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

    if (nearest.dist < 0.1) { // within ~500ft of route
      speedProfile.push({
        idx: nearest.idx,
        speedMph: speed,
        roadName: way.tags?.name || 'unnamed',
        highway: way.tags?.highway || 'road',
      })
    }
  }

  // Sort by route position
  speedProfile.sort((a, b) => a.idx - b.idx)

  // ── Detect Speed Deltas ──
  for (let i = 1; i < speedProfile.length; i++) {
    const prev = speedProfile[i - 1]
    const curr = speedProfile[i]
    const delta = curr.speedMph - prev.speedMph

    if (delta >= 10) {
      // Positive speed transition — floor-it opportunity!
      // Calculate runway: distance of the high-speed stretch
      const nextChange = speedProfile[i + 1]
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
    for (const sp of speedProfile) {
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
