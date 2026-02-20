# Hotfix — Routing App for Fast Cars

## Vision
A web app where drivers with fast sports cars can find routes between two points that maximize driving fun — long on-ramps, open straightaways, sweeping curves, and roads where you can actually use what's under the hood. Think "Waze for car enthusiasts" meets "Google Maps but the fun route."

## Tech Stack
- **React 19** + **TypeScript** + **Vite**
- **Mapbox GL JS** for map rendering (dark style: `mapbox://styles/mapbox/dark-v11`)
- **Mapbox Directions API** for route calculation (with `alternatives=true`)
- **TailwindCSS v4** for styling
- **Overpass API** (OpenStreetMap) for road attribute enrichment
- **Zustand** for state management

## Environment
- Mapbox token via `VITE_MAPBOX_TOKEN` env variable
- Create a `.env.example` with `VITE_MAPBOX_TOKEN=your_token_here`

## Core Feature: Thrill Route Finder

### User Flow
1. User sees a full-screen dark map (centered on their location or default US)
2. User enters **Origin** and **Destination** via search bars at the top (Mapbox Geocoding)
3. App calculates multiple routes (Mapbox Directions API with `alternatives=true`, plus custom waypoint variations)
4. Each route is analyzed and scored with a **Thrill Score**
5. Routes displayed on map, color-coded by fun factor
6. Route cards in a sidebar/bottom panel show:
   - Route name (auto-generated: "The Highway Run", "The Scenic Sweep", etc.)
   - Total time + distance
   - **"+X min vs fastest route"** comparison (CRITICAL FEATURE)
   - Thrill Score (0-100) with breakdown
   - Key highlights ("3.2mi straightaway on I-95", "1,200ft elevation gain", "4 sweeping curves")
7. User can click a route card to select it, and the map zooms/highlights that route
8. Selected route shows segment-by-segment color coding on the map

### Route Naming
Auto-generate fun names based on route characteristics:
- Heavy highway: "The Interstate Blast"
- Curvy mountain: "The Ridge Runner"  
- Long on-ramps: "The Merge Machine"
- Mixed: "The Best of Both"
- Fastest/boring: "The Commuter" (shown for comparison but scored low)

### Thrill Score Algorithm (0-100)
Composite of weighted sub-scores:

| Factor | Weight | What It Measures |
|--------|--------|-----------------|
| **Straightaway Score** | 25% | Length of uninterrupted segments with speed limit ≥55mph. Longer = better. A 2+ mile straightaway at 65mph is gold. |
| **On-Ramp Score** | 20% | Number and length of `highway=motorway_link` segments. Long merge lanes = acceleration zones. |
| **Curve Quality** | 20% | Sweeping curves (low curvature rate of change) score high. Hairpins score lower (fun but not "floor it" fun). Calculate from route geometry angular changes. |
| **Open Road Score** | 15% | Inverse of intersection density + traffic signal count along route. Fewer stops = more flow. |
| **Elevation Score** | 10% | Fun elevation changes — hill climbs, descents. Not just total gain, but the drama of it (gradient percentage). |
| **Surface Score** | 10% | Road surface quality from OSM tags. Asphalt > concrete > everything else. Penalize unpaved. |

### Data Enrichment Pipeline
For each route returned by Mapbox:
1. Decode the route polyline into coordinates
2. Sample points along the route at ~500m intervals
3. Query **Overpass API** for road segments near those points, fetching:
   - `highway` type (motorway, trunk, primary, secondary, motorway_link, etc.)
   - `maxspeed` tag
   - `lanes` count
   - `surface` tag (asphalt, concrete, etc.)
   - `smoothness` tag
   - `name` for notable road names
4. Calculate curvature from the route geometry (angular change per km)
5. Get elevation profile from Mapbox terrain or route elevation data
6. Run scoring algorithm on enriched data

### Map Visualization
- **Route lines**: Each alternative route drawn as a line on the map
  - Thickness: thicker = higher Thrill Score
  - Color: gradient from cool blue (boring) → orange → red (thrilling)
  - Selected route: bright, others dimmed
- **Segment coloring**: When a route is selected, color individual segments:
  - 🔴 Red: straightaways with high speed limits (the money spots)
  - 🟠 Orange: good curves, on-ramps
  - 🟡 Yellow: decent road, moderate fun
  - 🔵 Blue: low-fun segments (residential, many intersections)
- **Markers**: Custom markers for notable features along selected route:
  - 🛣️ Long straightaway start/end
  - 🔄 Best curve sections
  - ⬆️ Elevation highlights
  - 🚦 Traffic light clusters (warning)

## UI Design

### Layout
```
┌──────────────────────────────────────────────────┐
│ [🔍 Origin............] [🏁 Destination.........] │
│ ┌────────────────────────────────┬───────────────┐│
│ │                                │ ROUTE CARDS   ││
│ │                                │               ││
│ │          MAP                   │ ┌───────────┐ ││
│ │       (full dark)              │ │ Route 1   │ ││
│ │                                │ │ ⚡ 87/100  │ ││
│ │                                │ │ +4min     │ ││
│ │                                │ └───────────┘ ││
│ │                                │ ┌───────────┐ ││
│ │                                │ │ Route 2   │ ││
│ │                                │ │ ⚡ 72/100  │ ││
│ │                                │ │ Fastest ⚡ │ ││
│ │                                │ └───────────┘ ││
│ │                                │ ┌───────────┐ ││
│ │                                │ │ Route 3   │ ││
│ │                                │ │ ⚡ 94/100  │ ││
│ │                                │ │ +11min    │ ││
│ │                                │ └───────────┘ ││
│ └────────────────────────────────┴───────────────┘│
└──────────────────────────────────────────────────┘
```

### Theme
- **Background**: Near-black (#0a0a0f) 
- **Card background**: Dark gray (#1a1a2e) with subtle border
- **Primary accent**: Electric red (#ff2d55) — like brake calipers
- **Secondary accent**: Amber/gold (#ffb800) — like instrument cluster
- **Text**: White (#ffffff) and light gray (#a0a0b0)
- **Font**: Inter or similar modern sans-serif
- **Vibe**: Premium, automotive, like a high-end car's infotainment screen

### Route Card Design
```
┌─────────────────────────────┐
│ 🏎️ THE RIDGE RUNNER         │
│ ⚡ Thrill Score: 94/100      │
│ ████████████████████░░ 94%  │
│                             │
│ 📏 47.3 mi  ⏱️ 52 min       │
│ ⏱️ +11 min vs fastest        │
│                             │
│ 🛣️ Straight: 88  🔄 Curves: 91 │
│ 🚀 On-ramps: 78  🏔️ Elev: 95  │
│                             │
│ ✨ 3.2mi straightaway on US-9 │
│ ✨ 1,200ft elevation gain     │
│ ✨ 4 sweeping curves          │
└─────────────────────────────┘
```

## Phase 1 — MVP (BUILD THIS FIRST)
**Goal**: Map + search + routes displayed + basic comparison

1. Vite + React + TypeScript + Tailwind setup
2. Full-screen Mapbox dark map
3. Origin/destination search bars with Mapbox Geocoding
4. Route calculation with Mapbox Directions API (alternatives=true)
5. Display routes on map with different colors
6. Basic route cards showing time, distance, "+X min vs fastest"
7. Click card to select/highlight route
8. Responsive layout (map + sidebar)

**DO NOT move to Phase 2 until Phase 1 is pixel-perfect and fully functional.**

## Phase 2 — Thrill Score Engine
1. Route geometry analysis (curvature, straightaway detection)
2. Overpass API integration for road attributes
3. Scoring algorithm implementation
4. Route cards updated with Thrill Score + breakdown
5. Auto-generated route names

## Phase 3 — Visual Polish
1. Segment-by-segment color coding on selected route
2. Notable feature markers on map
3. Route highlight animations
4. Score breakdown mini radar chart in route cards
5. Smooth transitions between route selections

## Phase 4 — Advanced Features
1. "Explore mode" — find fun roads near a location without a destination
2. Share route via URL
3. Road surface warnings
4. Time-of-day traffic overlay (when is this road empty?)
5. Save favorite routes (localStorage initially)

## IMPORTANT RULES
- Use TypeScript strictly — no `any` types
- All components must be properly typed
- Use functional components with hooks
- Keep components small and focused
- Error handling everywhere (API calls can fail)
- Loading states for all async operations
- Mobile-responsive (but desktop-first)
- Mapbox token must come from env variable, never hardcoded
- Use semantic HTML
- Accessible (proper ARIA labels, keyboard navigation)
