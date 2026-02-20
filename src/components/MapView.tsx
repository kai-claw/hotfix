import { useEffect, useRef, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useRouteStore } from '../store/routeStore'
import { useIsMobile } from '../hooks/useMediaQuery'

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

  const { routes, selectedRouteId, origin, destination } = useRouteStore()

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

  // Clear existing route layers
  const clearRoutes = useCallback(() => {
    const map = mapRef.current
    if (!map) return

    for (let i = 0; i < 10; i++) {
      const layerId = `route-${i}`
      const outlineId = `route-outline-${i}`
      if (map.getLayer(outlineId)) map.removeLayer(outlineId)
      if (map.getLayer(layerId)) map.removeLayer(layerId)
      if (map.getSource(layerId)) map.removeSource(layerId)
    }

    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []
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

        if (!map.getSource(sourceId)) {
          map.addSource(sourceId, {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: route.mapboxRoute.geometry,
            },
          })
        }

        // Glow outline
        const outlineId = `${sourceId}-outline`
        if (!map.getLayer(outlineId)) {
          map.addLayer({
            id: outlineId,
            type: 'line',
            source: sourceId,
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
            paint: {
              'line-color': route.color,
              'line-width': isSelected ? 12 : 6,
              'line-opacity': isSelected ? 0.2 : 0.05,
              'line-blur': 8,
            },
          })
        }

        // Main route line
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
              'line-width': isSelected ? 5 : 3,
              'line-opacity': isSelected ? 1 : 0.35,
            },
          })
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
  }, [routes, selectedRouteId, origin, destination, clearRoutes, isMobile])

  return (
    <div ref={mapContainerRef} className="w-full h-full" />
  )
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
