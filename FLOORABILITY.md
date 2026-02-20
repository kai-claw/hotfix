# Floorability Engine — Architecture

## Core Concept
**Floorability** = the quality and quantity of acceleration opportunities on a route.
It's not about going fast — it's about *getting to go fast*. The transition from slow to fast is the thrill.

## Floorability Events (scored individually, summed for route total)

### 1. Speed Limit Deltas (weight: 35%)
- Detect transitions between road segments with different `maxspeed` tags
- Score = `(newSpeed - oldSpeed) * stretchLength`
- A 25→55 with 2 miles ahead = (30) * 2 = 60 points
- A 55→55 continuation = 0 delta but still good (captured by straightaway score)
- A 55→25 = negative (braking zone, penalize route slightly)
- **Bonus multiplier** if the high-speed stretch is > 1 mile uninterrupted

### 2. Signal Launch Zones (weight: 25%)
- Find `highway=traffic_signals` nodes on roads with `maxspeed >= 40mph`
- Each signal is a potential launch event (stop → green → floor it)
- Score based on:
  - Speed limit of the road (higher = better launch)
  - Distance to next intersection/signal (longer = better acceleration zone)
  - Number of lanes (more lanes = less traffic blocking you)
- **The sweet spot:** A signal on a 50mph road with 1+ mile to the next signal

### 3. On-Ramp Merges (weight: 20%)
- `highway=motorway_link` segments = highway merge acceleration zones
- Score based on:
  - Ramp length (longer = more acceleration time)
  - Speed limit of the highway being merged onto
  - Whether it feeds onto a straightaway vs immediate curve

### 4. Acceleration Runway (weight: 10%)
- After any floor-it event, how much uninterrupted road do you have?
- Measure distance until next: speed change, intersection, curve, signal
- Longer runway = higher multiplier on the event that preceded it

### 5. Road Quality Bonus (weight: 10%)
- `surface=asphalt` > `surface=concrete` > other
- `lanes >= 2` in your direction = room to maneuver
- `smoothness=excellent` or `smoothness=good` = bonus
- `highway=motorway` or `highway=trunk` = inherently better road

## Anti-Floorability Penalties
- Frequent speed limit decreases (55→35→25 = bad)
- Dense intersection clusters (many signals in short distance = stop-and-go, not floor-it)
- School zones, residential zones (penalize for safety + speed enforcement)
- Short segments between speed changes (not enough room to actually accelerate)
- Construction zones (if detectable from OSM)

## Loop Route Generation Algorithm

### Input
- Starting point (lat/lng)
- Desired loop duration (15min, 30min, 60min)
- Preferred style: highway-heavy, backroad, mixed

### Strategy
1. **Fan-out waypoints:** Generate 12 candidate waypoints in a circle around start:
   - 4 cardinal directions + 4 diagonals + 4 intermediate
   - Distance based on desired duration (30min ≈ 15-20 mile radius)
   - Snap each waypoint to the nearest road via Nominatim reverse geocode

2. **Generate candidate loops:**
   - Single waypoint loops: start → wp → start (12 candidates)
   - Double waypoint loops: start → wp1 → wp2 → start (select best pairs, ~20 candidates)
   - Use OSRM with intermediate waypoints

3. **Score each candidate** with the Floorability Engine:
   - Query Overpass API for road data along each route
   - Calculate all floorability events
   - Sum scores, normalize to 0-100

4. **Return top 3-5 routes** with:
   - Floorability Score breakdown
   - Key floor-it moments highlighted on map
   - Total time + distance + "+X min vs shortest loop"
   - Auto-generated name

### Route Naming (Loop-specific)
- "The Launch Loop" — many signal launches
- "The Speed Step" — big speed limit transitions  
- "The Ramp Run" — heavy on highway merges
- "The Full Send" — highest overall floorability
- "The Quick Rip" — short but intense loop

## Data Pipeline

### Overpass API Query Strategy
For a given route polyline, build an Overpass query that fetches:
```
[out:json][timeout:30];
(
  // Ways with speed limits near route
  way(around:100,{lat1},{lng1},{lat2},{lng2},...)[maxspeed];
  // Traffic signals near route
  node(around:100,{lat1},{lng1},{lat2},{lng2},...)[highway=traffic_signals];
  // On-ramps near route
  way(around:200,{lat1},{lng1},{lat2},{lng2},...)[highway=motorway_link];
);
out body geom;
```
Sample route points at ~500m intervals for the `around` filter.

### Caching Strategy
- Cache Overpass results per geographic tile (z12 tiles ≈ 10km²)
- Re-use cached tiles for overlapping routes
- Cache in localStorage with TTL of 24 hours

## UI Changes

### New Mode Toggle
- **A → B Mode** (existing): Route between two points
- **Loop Mode** (new): Generate loops from a single point

### Loop Mode UI
- Single search bar: "Start from..."
- Duration selector: 15 / 30 / 60 min
- Style preference: Highway / Backroad / Mixed / Best
- Route cards show Floorability Score prominently
- Map shows floor-it events as markers:
  - 🚀 Speed delta zones (color-coded by intensity)
  - 🚦 Signal launch zones
  - 🛣️ On-ramp merges
  - Green segments = high floorability stretches
  - Red dots = braking zones (things to be aware of)

## Implementation Phases

### Phase A: Loop Route Generation (MVP)
- Fan-out waypoints + OSRM loop routing
- Basic loop cards with time/distance
- Duration selector
- Map display

### Phase B: Overpass Integration  
- Speed limit data along routes
- Traffic signal detection
- On-ramp identification

### Phase C: Floorability Scoring
- Speed delta detection + scoring
- Signal launch zone scoring
- On-ramp merge scoring
- Acceleration runway calculation
- Composite Floorability Score

### Phase D: Floor-it Event Visualization
- Map markers for floor-it events
- Segment color coding by floorability
- Score breakdown in route cards
- Highlight reel of best moments on route

### Phase E: Polish + Optimization
- Overpass query optimization / caching
- Better loop waypoint selection (road-density aware)
- Time-of-day traffic estimation
- User preferences learning
