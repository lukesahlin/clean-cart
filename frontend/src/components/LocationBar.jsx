// LocationBar.jsx — shows current location and lets user change it
// Props:
//   location: { lat, lng, zip, label } | null
//   onLocationChange: (newLoc) => void
//   compact: bool — smaller inline version for use inside result pages

import { useState, useRef } from 'react'
import { requestGeolocation, reverseGeocode, geocodeLocation } from '../api.js'

export default function LocationBar({ location, onLocationChange, compact = false }) {
  const [editing, setEditing]   = useState(false)
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const inputRef = useRef(null)

  const startEdit = () => {
    setInput(location?.zip || '')
    setError('')
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const useGPS = async () => {
    setLoading(true)
    setError('')
    try {
      const loc = await requestGeolocation()
      const geo = await reverseGeocode(loc.lat, loc.lng).catch(() => ({}))
      const zip = geo.zip_code || ''
      const label = geo.city
        ? `${geo.city}, ${geo.state || ''}`.trim().replace(/,$/, '')
        : zip || 'Current location'
      onLocationChange({ lat: loc.lat, lng: loc.lng, zip, label })
      setEditing(false)
    } catch {
      setError('Location access denied. Enter a zip code below.')
    } finally {
      setLoading(false)
    }
  }

  const submitZip = async () => {
    const q = input.trim()
    if (!q) return
    setLoading(true)
    setError('')
    try {
      const geo = await geocodeLocation(q)
      if (geo.error || !geo.lat) {
        setError('Could not find that location. Try a zip code like 98101.')
        return
      }
      // geocode returns short_name; reverse-geocode returns city+state
      const label = geo.city
        ? `${geo.city}, ${geo.state || ''}`.trim().replace(/,$/, '')
        : geo.short_name || q
      onLocationChange({ lat: geo.lat, lng: geo.lng, zip: geo.zip_code || q, label })
      setEditing(false)
    } catch {
      setError('Could not look up that location.')
    } finally {
      setLoading(false)
    }
  }

  // ── Editing mode ─────────────────────────────────────────────────────────────
  if (editing) {
    return (
      <div style={compact ? s.wrapCompact : s.wrap}>
        <div style={s.editRow}>
          <button style={s.gpsBtn} onClick={useGPS} disabled={loading}>
            {loading ? '…' : '📍'} Use my location
          </button>
          <span style={s.orDivider}>or</span>
          <div style={s.zipRow}>
            <input
              ref={inputRef}
              style={s.zipInput}
              placeholder="Enter zip or city"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submitZip()}
              maxLength={20}
            />
            <button style={s.goBtn} onClick={submitZip} disabled={loading}>
              {loading ? '…' : 'Go'}
            </button>
          </div>
          <button style={s.cancelBtn} onClick={() => setEditing(false)}>✕</button>
        </div>
        {error && <div style={s.errorText}>{error}</div>}
      </div>
    )
  }

  // ── Display mode ─────────────────────────────────────────────────────────────
  return (
    <button style={compact ? s.pillCompact : s.pill} onClick={startEdit}>
      <span style={s.pin}>📍</span>
      <span style={s.label}>
        {location ? location.label : 'Set your location'}
      </span>
      <span style={s.chevron}>›</span>
    </button>
  )
}

const s = {
  wrap:        { padding: '12px 16px', background: '#fff', borderBottom: '1px solid #EBEBEB' },
  wrapCompact: { padding: '8px 16px 4px' },

  pill:        { display: 'flex', alignItems: 'center', gap: 8, background: '#F7F6F3', border: '1.5px solid #E8E6E3', borderRadius: 24, padding: '10px 16px', cursor: 'pointer', width: '100%', textAlign: 'left', transition: 'border-color 0.15s' },
  pillCompact: { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#F0EDE8', border: 'none', borderRadius: 14, padding: '6px 12px', cursor: 'pointer', textAlign: 'left' },

  pin:    { fontSize: 14, flexShrink: 0 },
  label:  { flex: 1, fontSize: 14, fontWeight: 600, color: '#333', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  chevron:{ fontSize: 16, color: '#C5C5C5', flexShrink: 0 },

  editRow:    { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  gpsBtn:     { display: 'flex', alignItems: 'center', gap: 5, background: '#E8F5E9', color: '#1B5E20', border: 'none', borderRadius: 12, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0 },
  orDivider:  { fontSize: 12, color: '#CCC', flexShrink: 0 },
  zipRow:     { display: 'flex', flex: 1, gap: 6, minWidth: 160 },
  zipInput:   { flex: 1, border: '1.5px solid #E8E6E3', borderRadius: 12, padding: '9px 14px', fontSize: 14, outline: 'none', background: '#fff', minWidth: 0 },
  goBtn:      { background: '#1B5E20', color: '#fff', border: 'none', borderRadius: 12, padding: '9px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer', flexShrink: 0 },
  cancelBtn:  { background: 'none', border: 'none', fontSize: 18, color: '#CCC', cursor: 'pointer', padding: '0 4px', flexShrink: 0 },
  errorText:  { fontSize: 12, color: '#C62828', marginTop: 8, fontWeight: 500 },
}
