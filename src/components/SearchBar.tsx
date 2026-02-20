import { useState, useRef, useEffect, useCallback } from 'react'
import { geocodeSearch, type GeocodingResult } from '../lib/mapbox'

interface SearchBarProps {
  placeholder: string
  value: string
  icon: string
  accentColor: string
  onSelect: (coords: { lng: number; lat: number }, name: string) => void
  onClear: () => void
  compact?: boolean
}

export default function SearchBar({
  placeholder,
  value,
  icon,
  accentColor,
  onSelect,
  onClear,
  compact = false,
}: SearchBarProps) {
  const [query, setQuery] = useState(value)
  const [results, setResults] = useState<GeocodingResult[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Sync external value
  useEffect(() => {
    setQuery(value)
  }, [value])

  // Click/touch outside to close
  useEffect(() => {
    const handleClick = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setIsFocused(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('touchstart', handleClick)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('touchstart', handleClick)
    }
  }, [])

  const search = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([])
      setIsOpen(false)
      return
    }
    const res = await geocodeSearch(q)
    setResults(res)
    setIsOpen(res.length > 0)
  }, [])

  const handleInput = (val: string) => {
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void search(val), 300)
  }

  const handleSelect = (result: GeocodingResult) => {
    setQuery(result.place_name)
    setIsOpen(false)
    setIsFocused(false)
    onSelect({ lng: result.center[0], lat: result.center[1] }, result.place_name)
  }

  const handleClear = () => {
    setQuery('')
    setResults([])
    setIsOpen(false)
    onClear()
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        className={`flex items-center gap-2 transition-all duration-200 ${
          compact
            ? 'rounded-lg px-3 py-2'
            : 'rounded-xl px-4 py-3'
        }`}
        style={{
          backgroundColor: compact ? 'rgba(26, 26, 46, 0.9)' : '#1a1a2e',
          backdropFilter: compact ? 'blur(12px)' : undefined,
          border: isFocused ? `1px solid ${accentColor}` : '1px solid #2a2a3e',
          boxShadow: isFocused ? `0 0 20px ${accentColor}20` : 'none',
        }}
      >
        <span className={`shrink-0 ${compact ? 'text-sm' : 'text-lg'}`}>{icon}</span>
        <input
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => {
            setIsFocused(true)
            if (results.length > 0) setIsOpen(true)
          }}
          placeholder={placeholder}
          className={`flex-1 bg-transparent text-white outline-none placeholder:text-[#6a6a8a] ${
            compact ? 'text-xs' : 'text-sm'
          }`}
        />
        {query && (
          <button
            onClick={handleClear}
            className={`text-[#6a6a8a] hover:text-white transition-colors ${
              compact ? 'text-xs p-1' : 'text-sm'
            }`}
          >
            ✕
          </button>
        )}
      </div>

      {/* Dropdown results */}
      {isOpen && results.length > 0 && (
        <div
          className={`absolute top-full left-0 right-0 mt-1 overflow-hidden z-50 border border-[#2a2a3e] ${
            compact ? 'rounded-lg' : 'rounded-xl'
          }`}
          style={{ backgroundColor: '#1a1a2e' }}
        >
          {results.map((result) => (
            <button
              key={result.id}
              onClick={() => handleSelect(result)}
              className={`w-full text-left text-[#a0a0b0] hover:text-white hover:bg-[#2a2a3e] transition-all flex items-center gap-2 ${
                compact ? 'px-3 py-2.5 text-xs' : 'px-4 py-3 text-sm'
              }`}
            >
              <span className="text-[#6a6a8a]">📍</span>
              <span className="truncate">{result.place_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
