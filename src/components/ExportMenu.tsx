import { useState, useRef, useEffect } from 'react'
import type { ScoredRoute } from '../types/route'
import {
  getAppleMapsUrl,
  getGoogleMapsUrl,
  getWazeUrl,
  downloadGpx,
  isIOS,
} from '../lib/routeExport'

interface ExportMenuProps {
  route: ScoredRoute
}

export default function ExportMenu({ route }: ExportMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClick)
      document.addEventListener('touchstart', handleClick)
    }
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('touchstart', handleClick)
    }
  }, [isOpen])

  const ios = isIOS()

  const copyToClipboard = (url: string) => {
    navigator.clipboard.writeText(url).catch(() => {
      const input = document.createElement('input')
      input.value = url
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
    })
  }

  const options = [
    // Primary nav apps — order by platform
    ...(ios
      ? [
          { label: '🍎 Apple Maps (14 pts)', action: () => window.open(getAppleMapsUrl(route), '_blank') },
          { label: '📍 Google Maps (20 pts)', action: () => window.open(getGoogleMapsUrl(route), '_blank') },
        ]
      : [
          { label: '📍 Google Maps (20 pts)', action: () => window.open(getGoogleMapsUrl(route), '_blank') },
          { label: '🍎 Apple Maps (14 pts)', action: () => window.open(getAppleMapsUrl(route), '_blank') },
        ]),
    { label: '🚗 Open in Waze', action: () => window.open(getWazeUrl(route), '_blank') },
    { label: '📥 Download GPX (exact)', action: () => downloadGpx(route) },
    {
      label: '📋 Copy Google Maps Link',
      action: () => {
        copyToClipboard(getGoogleMapsUrl(route))
        setIsOpen(false)
      },
    },
    {
      label: '📋 Copy Apple Maps Link',
      action: () => {
        copyToClipboard(getAppleMapsUrl(route))
        setIsOpen(false)
      },
    },
  ]

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation()
          setIsOpen(!isOpen)
        }}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#22c55e15] text-[#22c55e] hover:bg-[#22c55e25] transition-all active:scale-95"
        title="Export to navigation app"
      >
        🧭 Navigate
      </button>

      {isOpen && (
        <div className="absolute bottom-full right-0 mb-2 w-52 rounded-xl overflow-hidden border border-[#2a2a3e] shadow-2xl z-50"
          style={{ backgroundColor: '#1a1a2e' }}>
          <div className="px-3 py-2 border-b border-[#2a2a3e]">
            <span className="text-[10px] uppercase tracking-widest text-[#6a6a8a] font-bold">
              Open Route In...
            </span>
          </div>
          {options.map((opt, i) => (
            <button
              key={i}
              onClick={(e) => {
                e.stopPropagation()
                opt.action()
                if (!opt.label.includes('Copy')) setIsOpen(false)
              }}
              className="w-full text-left px-3 py-2.5 text-sm text-[#a0a0b0] hover:text-white hover:bg-[#2a2a3e] transition-all"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
