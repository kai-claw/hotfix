import { useEffect, useRef, useCallback, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useRouteStore } from '../store/routeStore'
import { useIsMobile } from '../hooks/useMediaQuery'
import type { FloorItEvent } from '../lib/floorability'
import { computeFloorabilityGradient } from '../lib/floorability'
import type { ExpressionSpecification } from 'maplibre-gl'

// CartoDB Dark Matter — gorgeous dark tiles, free, no API key
const DARK_STYLE = {
  version: 8 as const,
  name: 'Hotfix Dark',
  sources: {
    'carto-dark': {
      type: 'raster' as const,
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://carto.com">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    },
  },
  layers: [
    {
      id: 'carto-dark-layer',
      type: 'raster' as const,
      source: 'carto-dark',
      minzoom: 0,
      maxzoom: 20,
    },
  ],
}

export default function MapView() {
  const isMobile = useIsMobile()
  const mapRef = useRef<maplibregl.Map | null>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const eventMarkersRef = useRef<maplibregl.Marker[]>([])
  const eventPopupsRef = useRef<maplibregl.Popup[]>([])
  const dropPinMarkerRef = useRef<maplibregl.Marker | null>(null)
  const [locating, setLocating] = useState(false)

  const { routes, selectedRouteId, origin, destination, mode, loopRoutes, setOrigin } = useRouteStore()

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: DARK_STYLE,
      center: [-73.85, 41.05], // Westchester, NY default
      zoom: 10,
      pitch: 0,
    })

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Update cursor based on mode
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const canvas = map.getCanvasContainer()
    if (mode === 'loop') {
      canvas.style.cursor = 'crosshair'
    } else {
      canvas.style.cursor = ''
    }
  }, [mode])

  // Drop-a-pin: click/tap map to set origin in loop mode
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      // Only in loop mode
      const currentMode = useRouteStore.getState().mode
      if (currentMode !== 'loop') return

      const { lng, lat } = e.lngLat

      // Immediately show a pulsing pin marker for visual feedback
      if (dropPinMarkerRef.current) {
        dropPinMarkerRef.current.remove()
      }
      const pinEl = createDropPinElement()
      dropPinMarkerRef.current = new maplibregl.Marker({ element: pinEl })
        .setLngLat([lng, lat])
        .addTo(map)

      // Reverse geocode to get a readable name
      fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16`, {
        headers: { 'User-Agent': 'Hotfix-App/1.0' },
      })
        .then((r) => r.json())
        .then((data: { display_name?: string }) => {
          const name = data.display_name
            ? data.display_name.split(',').slice(0, 3).join(',')
            : `${lat.toFixed(4)}, ${lng.toFixed(4)}`
          setOrigin({ lng, lat }, `📍 ${name}`)
        })
        .catch(() => {
          setOrigin({ lng, lat }, `📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}`)
        })
    }

    map.on('click', handleClick)
    return () => {
      map.off('click', handleClick)
    }
  }, [setOrigin])

  // Clean up drop pin when routes load (origin marker takes over)
  useEffect(() => {
    if (routes.length > 0 && dropPinMarkerRef.current) {
      dropPinMarkerRef.current.remove()
      dropPinMarkerRef.current = null
    }
  }, [routes])

  // Current location handler
  const handleLocateMe = useCallback(() => {
    if (!navigator.geolocation) return
    setLocating(true)

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { longitude: lng, latitude: lat } = pos.coords
        setLocating(false)

        // Drop pin immediately
        const map = mapRef.current
        if (map) {
          if (dropPinMarkerRef.current) dropPinMarkerRef.current.remove()
          const pinEl = createDropPinElement()
          dropPinMarkerRef.current = new maplibregl.Marker({ element: pinEl })
            .setLngLat([lng, lat])
            .addTo(map)
          map.flyTo({ center: [lng, lat], zoom: 13, duration: 1000 })
        }

        // Reverse geocode
        fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16`, {
          headers: { 'User-Agent': 'Hotfix-App/1.0' },
        })
          .then((r) => r.json())
          .then((data: { display_name?: string }) => {
            const name = data.display_name
              ? data.display_name.split(',').slice(0, 3).join(',')
              : `${lat.toFixed(4)}, ${lng.toFixed(4)}`
            setOrigin({ lng, lat }, `📍 ${name}`)
          })
          .catch(() => {
            setOrigin({ lng, lat }, `📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}`)
          })
      },
      () => {
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [setOrigin])

  // Clear existing route layers
  const clearRoutes = useCallback(() => {
    const map = mapRef.current
    if (!map) return

    // Clean up both A→B (route-N) and loop (loop-N) layers
    for (const prefix of ['route-', 'loop-']) {
      for (let i = 0; i < 10; i++) {
        const layerId = `${prefix}${i}`
        const outlineId = `${layerId}-outline`
        const glowId = `${layerId}-glow`
        if (map.getLayer(glowId)) map.removeLayer(glowId)
        if (map.getLayer(outlineId)) map.removeLayer(outlineId)
        if (map.getLayer(layerId)) map.removeLayer(layerId)
        if (map.getSource(layerId)) map.removeSource(layerId)
      }
    }

    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    eventPopupsRef.current.forEach((p) => p.remove())
    eventPopupsRef.current = []
    eventMarkersRef.current.forEach((m) => m.remove())
    eventMarkersRef.current = []
  }, [])

  // Draw routes on map
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const onLoad = () => {
      clearRoutes()

      if (routes.length === 0) return

      // Draw routes (unselected first, selected on top)
      const sortedRoutes = [...routes].sort((a, b) => {
        if (a.id === selectedRouteId) return 1
        if (b.id === selectedRouteId) return -1
        return 0
      })

      sortedRoutes.forEach((route) => {
        const isSelected = route.id === selectedRouteId
        const sourceId = route.id

        // Check if this is a selected loop route with floor-it events
        const selectedLoop = isSelected && mode === 'loop'
          ? loopRoutes.find((r) => r.id === route.id)
          : null
        const hasEvents = selectedLoop && selectedLoop.floorability?.events?.length > 0

        if (!map.getSource(sourceId)) {
          map.addSource(sourceId, {
            type: 'geojson',
            lineMetrics: true, // enables line-progress for gradient
            data: {
              type: 'Feature',
              properties: {},
              geometry: route.mapboxRoute.geometry,
            },
          })
        }

        if (isSelected && hasEvents && selectedLoop) {
          // ── Selected loop route with events: floorability gradient ──
          const gradientStops = computeFloorabilityGradient(
            route.mapboxRoute.geometry.coordinates,
            selectedLoop.floorability.events
          )

          // Build MapLibre interpolate expression
          const gradientExpr: unknown[] = ['interpolate', ['linear'], ['line-progress']]
          for (const stop of gradientStops) {
            gradientExpr.push(stop.progress, stop.color)
          }

          // Warm glow outline
          const glowId = `${sourceId}-glow`
          if (!map.getLayer(glowId)) {
            map.addLayer({
              id: glowId,
              type: 'line',
              source: sourceId,
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint: {
                'line-gradient': gradientExpr as ExpressionSpecification,
                'line-width': 16,
                'line-opacity': 0.15,
                'line-blur': 10,
              },
            })
          }

          // Main gradient line
          if (!map.getLayer(sourceId)) {
            map.addLayer({
              id: sourceId,
              type: 'line',
              source: sourceId,
              layout: {
                'line-join': 'round',
                'line-cap': 'round',
                'line-sort-key': 100,
              },
              paint: {
                'line-gradient': gradientExpr as ExpressionSpecification,
                'line-width': 5,
                'line-opacity': 1,
              },
            })
          }
        } else {
          // ── Normal solid-color route ──
          // When a route IS selected, heavily dim the others so they don't distract
          const hasSelection = selectedRouteId !== null

          const outlineId = `${sourceId}-outline`
          if (!map.getLayer(outlineId)) {
            map.addLayer({
              id: outlineId,
              type: 'line',
              source: sourceId,
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint: {
                'line-color': route.color,
                'line-width': isSelected ? 12 : 4,
                'line-opacity': isSelected ? 0.2 : (hasSelection ? 0.02 : 0.05),
                'line-blur': 8,
              },
            })
          }

          if (!map.getLayer(sourceId)) {
            map.addLayer({
              id: sourceId,
              type: 'line',
              source: sourceId,
              layout: {
                'line-join': 'round',
                'line-cap': 'round',
                'line-sort-key': isSelected ? 100 : 0,
              },
              paint: {
                'line-color': route.color,
                'line-width': isSelected ? 5 : (hasSelection ? 2 : 3),
                'line-opacity': isSelected ? 1 : (hasSelection ? 0.12 : 0.35),
              },
            })
          }
        }
      })

      // Origin marker
      if (origin) {
        const originEl = createMarkerElement('🟢', 'origin')
        const originMarker = new maplibregl.Marker({ element: originEl })
          .setLngLat([origin.lng, origin.lat])
          .addTo(map)
        markersRef.current.push(originMarker)
      }

      // Destination marker
      if (destination) {
        const destEl = createMarkerElement('🏁', 'destination')
        const destMarker = new maplibregl.Marker({ element: destEl })
          .setLngLat([destination.lng, destination.lat])
          .addTo(map)
        markersRef.current.push(destMarker)
      }

      // Floor-it event markers (loop mode, selected route)
      // NOTE: Popups are managed manually (NOT via marker.setPopup()) because
      // MapLibre's built-in setPopup() hides the marker icon when the popup
      // opens, and the MutationObserver workaround is unreliable on mobile.
      if (mode === 'loop' && selectedRouteId) {
        const selectedLoop = loopRoutes.find((r) => r.id === selectedRouteId)
        if (selectedLoop?.floorability?.events?.length) {
          const topEvents = selectedLoop.floorability.events.slice(0, 12)
          topEvents.forEach((event, idx) => {
            const el = createEventMarkerElement(event, idx)

            const marker = new maplibregl.Marker({ element: el })
              .setLngLat([event.lng, event.lat])
              .addTo(map)

            // Manual popup — completely independent of marker lifecycle
            const popup = new maplibregl.Popup({
              offset: 20,
              closeButton: true,
              className: 'hotfix-event-popup',
              maxWidth: '240px',
            }).setHTML(createEventPopupHTML(event))

            let popupOpen = false
            const togglePopup = (e: Event) => {
              e.stopPropagation()
              if (popupOpen) {
                popup.remove()
                popupOpen = false
              } else {
                // Close any other open event popups first
                eventPopupsRef.current.forEach((p) => p.remove())
                popup.setLngLat([event.lng, event.lat]).addTo(map)
                popupOpen = true
              }
            }
            el.addEventListener('click', togglePopup)
            el.addEventListener('touchend', (e) => {
              e.preventDefault() // prevent ghost click
              togglePopup(e)
            })

            // Track close via popup's own close event
            popup.on('close', () => { popupOpen = false })

            eventMarkersRef.current.push(marker)
            eventPopupsRef.current.push(popup)
          })
        }
      }

      // Fit map to routes
      if (routes.length > 0) {
        const bounds = new maplibregl.LngLatBounds()
        routes.forEach((route) => {
          route.mapboxRoute.geometry.coordinates.forEach((coord) => {
            bounds.extend(coord as [number, number])
          })
        })
        map.fitBounds(bounds, {
          padding: isMobile
            ? { top: 100, bottom: window.innerHeight * 0.42, left: 30, right: 30 }
            : { top: 80, bottom: 40, left: 40, right: 380 },
          duration: 1000,
        })
      }
    }

    if (map.isStyleLoaded()) {
      onLoad()
    } else {
      map.on('load', onLoad)
    }

    return () => {
      map.off('load', onLoad)
    }
  }, [routes, selectedRouteId, origin, destination, clearRoutes, isMobile, mode, loopRoutes])

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Current Location button — loop mode only */}
      {mode === 'loop' && (
        <button
          onClick={handleLocateMe}
          disabled={locating}
          className="absolute z-20 flex items-center justify-center rounded-full bg-[#1a1a2e]/90 backdrop-blur border border-[#2a2a3e] shadow-lg hover:border-[#ff2d55]/40 hover:bg-[#ff2d55]/10 active:scale-95 transition-all"
          style={{
            width: 44,
            height: 44,
            bottom: isMobile ? 'calc(max(120px, 40vh) + 12px)' : 20,
            left: 16,
          }}
          title="Use current location"
        >
          {locating ? (
            <div className="w-5 h-5 rounded-full border-2 border-[#2a2a3e] border-t-[#ff2d55] animate-spin" />
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a0a0b0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
            </svg>
          )}
        </button>
      )}

      {/* Tap hint — loop mode, no origin set */}
      {mode === 'loop' && !origin && routes.length === 0 && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
          <div className="flex flex-col items-center gap-2 bg-[#0f0f1a]/80 backdrop-blur-sm rounded-2xl px-6 py-4 border border-[#2a2a3e]">
            <span className="text-2xl">📍</span>
            <span className="text-sm text-[#a0a0b0] font-medium">Tap the map to drop a pin</span>
            <span className="text-xs text-[#6a6a8a]">or search above, or use 📍 location</span>
          </div>
        </div>
      )}
    </div>
  )
}

/** Pulsing red pin — immediate visual feedback when user taps the map */
function createDropPinElement(): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = `
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #ff2d55;
    border: 3px solid white;
    box-shadow: 0 0 0 0 rgba(255, 45, 85, 0.5);
    animation: hotfix-pin-pulse 1.5s ease-out infinite;
    pointer-events: none;
  `

  // Inject keyframes if not already present
  if (!document.getElementById('hotfix-pin-pulse-style')) {
    const style = document.createElement('style')
    style.id = 'hotfix-pin-pulse-style'
    style.textContent = `
      @keyframes hotfix-pin-pulse {
        0% { box-shadow: 0 0 0 0 rgba(255, 45, 85, 0.5); }
        70% { box-shadow: 0 0 0 20px rgba(255, 45, 85, 0); }
        100% { box-shadow: 0 0 0 0 rgba(255, 45, 85, 0); }
      }
    `
    document.head.appendChild(style)
  }

  return el
}

function createMarkerElement(emoji: string, type: 'origin' | 'destination'): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = `
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    border-radius: 50%;
    background: #1a1a2e;
    border: 2px solid ${type === 'origin' ? '#22c55e' : '#ff2d55'};
    box-shadow: 0 0 15px ${type === 'origin' ? '#22c55e40' : '#ff2d5540'};
    cursor: pointer;
    transition: transform 0.2s;
  `
  el.textContent = emoji
  el.onmouseenter = () => { el.style.transform = 'scale(1.2)' }
  el.onmouseleave = () => { el.style.transform = 'scale(1)' }
  return el
}

const EVENT_EMOJI: Record<FloorItEvent['type'], string> = {
  speed_delta: '🚀',
  signal_launch: '🚦',
  ramp_merge: '🛣️',
}

const EVENT_COLORS: Record<FloorItEvent['type'], string> = {
  speed_delta: '#ff2d55',
  signal_launch: '#ffb800',
  ramp_merge: '#00d4ff',
}

const EVENT_TYPE_LABELS: Record<FloorItEvent['type'], string> = {
  speed_delta: 'SPEED DELTA',
  signal_launch: 'SIGNAL LAUNCH',
  ramp_merge: 'RAMP MERGE',
}

function createEventMarkerElement(event: FloorItEvent, _index: number): HTMLDivElement {
  const color = EVENT_COLORS[event.type]
  const emoji = EVENT_EMOJI[event.type]

  const el = document.createElement('div')
  el.style.cssText = `
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    border-radius: 50%;
    background: #0d0d1a;
    border: 2px solid ${color};
    box-shadow: 0 0 12px ${color}50, 0 0 4px ${color}30;
    cursor: pointer;
    transition: transform 0.2s, box-shadow 0.2s;
    z-index: 10;
    pointer-events: auto;
  `
  el.textContent = emoji

  el.onmouseenter = () => {
    el.style.transform = 'scale(1.3)'
    el.style.boxShadow = `0 0 20px ${color}80, 0 0 8px ${color}60`
  }
  el.onmouseleave = () => {
    el.style.transform = 'scale(1)'
    el.style.boxShadow = `0 0 12px ${color}50, 0 0 4px ${color}30`
  }
  return el
}

function createEventPopupHTML(event: FloorItEvent): string {
  const color = EVENT_COLORS[event.type]
  const typeLabel = EVENT_TYPE_LABELS[event.type]
  const scoreBar = Math.min(100, Math.round(event.score * 2))

  return `
    <div style="
      background: #0d0d1a;
      border: 1px solid ${color}40;
      border-radius: 12px;
      padding: 10px 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-width: 180px;
    ">
      <div style="
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 6px;
      ">
        <span style="
          font-size: 8px;
          font-weight: 800;
          letter-spacing: 1.5px;
          color: ${color};
          background: ${color}15;
          padding: 2px 6px;
          border-radius: 4px;
        ">${typeLabel}</span>
        <span style="
          font-size: 11px;
          font-weight: 800;
          color: white;
          margin-left: auto;
        ">${event.label}</span>
      </div>
      <div style="
        font-size: 11px;
        color: #a0a0b0;
        line-height: 1.4;
        margin-bottom: 8px;
      ">${event.detail}</div>
      <div style="
        display: flex;
        align-items: center;
        gap: 6px;
      ">
        <div style="
          flex: 1;
          height: 3px;
          border-radius: 2px;
          background: #1a1a2e;
          overflow: hidden;
        ">
          <div style="
            width: ${scoreBar}%;
            height: 100%;
            border-radius: 2px;
            background: linear-gradient(90deg, ${color}80, ${color});
          "></div>
        </div>
        <span style="
          font-size: 9px;
          color: #6a6a8a;
          white-space: nowrap;
        ">${event.runwayMi.toFixed(1)}mi runway</span>
      </div>
    </div>
  `
}
