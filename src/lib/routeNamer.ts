import type { MapboxRoute } from '../types/route'

interface RoadAnalysis {
  hasHighway: boolean
  hasCurves: boolean
  hasElevation: boolean
  dominantRoadType: string
  longestSegmentName: string
}

function analyzeRoute(route: MapboxRoute): RoadAnalysis {
  const steps = route.legs.flatMap((leg) => leg.steps)

  let highwayDistance = 0
  let totalDistance = 0
  let maxSegmentDist = 0
  let longestSegmentName = ''
  let turnCount = 0

  for (const step of steps) {
    totalDistance += step.distance
    if (step.distance > maxSegmentDist) {
      maxSegmentDist = step.distance
      longestSegmentName = step.name || 'unnamed road'
    }
    // Detect highway segments by checking for typical highway naming
    const name = (step.name || '').toLowerCase()
    if (
      name.includes('interstate') ||
      name.includes('i-') ||
      name.includes('highway') ||
      name.includes('us-') ||
      name.includes('expressway') ||
      name.includes('turnpike') ||
      name.includes('parkway') ||
      name.includes('freeway')
    ) {
      highwayDistance += step.distance
    }
    if (
      step.maneuver.type === 'turn' ||
      step.maneuver.type === 'end of road'
    ) {
      turnCount++
    }
  }

  const highwayRatio = totalDistance > 0 ? highwayDistance / totalDistance : 0
  const turnsPerMile = totalDistance > 0 ? turnCount / (totalDistance / 1609.34) : 0

  return {
    hasHighway: highwayRatio > 0.4,
    hasCurves: turnsPerMile > 2,
    hasElevation: false, // Phase 2: elevation data
    dominantRoadType: highwayRatio > 0.6 ? 'highway' : highwayRatio > 0.3 ? 'mixed' : 'backroad',
    longestSegmentName,
  }
}

const highwayNames = [
  'The Interstate Blast',
  'The Highway Flyer',
  'Full Throttle Express',
  'The Long Stretch',
  'Redline Run',
]

const curveNames = [
  'The Ridge Runner',
  'Canyon Carver',
  'The Switchback Special',
  'Apex Hunter',
  'The Winding Way',
]

const mixedNames = [
  'The Best of Both',
  'Street to Summit',
  'The Cross-Country',
  'Mix Master Route',
  'The All-Rounder',
]

const backroadNames = [
  'The Back Road Blitz',
  'Hidden Gem Route',
  'The Local Legend',
  'Off the Beaten Path',
  'The Secret Run',
]

const boringNames = [
  'The Commuter',
  'Vanilla Route',
  'The Shortcut',
  'Quick & Quiet',
  'The Efficiency Play',
]

export function generateRouteName(
  route: MapboxRoute,
  index: number,
  isFastest: boolean,
  isSlowest: boolean
): string {
  if (isFastest && !isSlowest) {
    // The fastest route gets a "boring but fast" name
    return boringNames[index % boringNames.length]
  }

  const analysis = analyzeRoute(route)

  let namePool: string[]
  if (analysis.hasHighway && analysis.hasCurves) {
    namePool = mixedNames
  } else if (analysis.hasHighway) {
    namePool = highwayNames
  } else if (analysis.hasCurves) {
    namePool = curveNames
  } else {
    namePool = backroadNames
  }

  // Use a deterministic pick based on route characteristics
  const hash = Math.abs(
    route.distance * 7 + route.duration * 13 + index * 31
  )
  return namePool[Math.floor(hash) % namePool.length]
}

export function generateHighlights(route: MapboxRoute): string[] {
  const highlights: string[] = []
  const steps = route.legs.flatMap((leg) => leg.steps)

  // Find longest uninterrupted segment
  let longestSegment = { name: '', distance: 0 }
  for (const step of steps) {
    if (step.distance > longestSegment.distance && step.name) {
      longestSegment = { name: step.name, distance: step.distance }
    }
  }

  if (longestSegment.distance > 1609) {
    // > 1 mile
    const miles = (longestSegment.distance / 1609.34).toFixed(1)
    highlights.push(`${miles}mi stretch on ${longestSegment.name}`)
  }

  // Count highway segments
  const hwSteps = steps.filter((s) => {
    const n = (s.name || '').toLowerCase()
    return (
      n.includes('interstate') ||
      n.includes('i-') ||
      n.includes('highway') ||
      n.includes('us-') ||
      n.includes('expressway') ||
      n.includes('parkway')
    )
  })

  if (hwSteps.length > 0) {
    const hwMiles = (
      hwSteps.reduce((a, s) => a + s.distance, 0) / 1609.34
    ).toFixed(1)
    highlights.push(`${hwMiles}mi of highway`)
  }

  // Count turns
  const turns = steps.filter(
    (s) => s.maneuver.type === 'turn' || s.maneuver.type === 'end of road'
  )
  if (turns.length > 5) {
    highlights.push(`${turns.length} turns — stay sharp`)
  } else if (turns.length <= 2) {
    highlights.push('Minimal turns — open road')
  }

  // Total road names (variety indicator)
  const uniqueRoads = new Set(steps.map((s) => s.name).filter(Boolean))
  if (uniqueRoads.size <= 3) {
    highlights.push(`Only ${uniqueRoads.size} roads — simple route`)
  }

  return highlights.slice(0, 3)
}
